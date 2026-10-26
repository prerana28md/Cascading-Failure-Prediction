import unittest
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

try:
    import predict_api as api
except ImportError:
    from ml import predict_api as api


class FaultIntelligenceTests(unittest.TestCase):
    def setUp(self):
        api.FAULT_EVENTS.clear()
        self.raw = {}
        for service in api.SERVICES:
            self.raw[f"{service}_service_up"] = 1.0
            self.raw[f"{service}_error_rate_5xx"] = 0.0
            self.raw[f"{service}_p99_latency_s"] = 0.0
            self.raw[f"{service}_fault"] = "NONE"
            self.raw[f"{service}_fault_delay_ms"] = 0

    def event(self, service, fault, minutes_ago=0, status="ACTIVE"):
        timestamp = datetime.now(timezone.utc).timestamp() - minutes_ago * 60
        iso_timestamp = datetime.fromtimestamp(timestamp, timezone.utc).isoformat()
        api.FAULT_EVENTS.append({
            "fault_id": f"{service}-{fault}-{minutes_ago}",
            "service": service,
            "fault": fault,
            "status": status,
            "timestamp": iso_timestamp,
        })

    def test_prometheus_scrape_batches_metrics_and_scopes_to_workload(self):
        def metric_series(query, label_name):
            if label_name == "application":
                self.assertIn("application=~", query)
            else:
                self.assertEqual(label_name, "job")
            if "http_server_requests_seconds_count" in query and 'status=~"5.."' not in query and 'status=~"4.."' not in query:
                return {"order-service": 3.5, "payment-service": 8.0}
            if label_name == "job":
                return {"order-service": 1.0, "payment-service": 1.0}
            return {"order-service": 0.0, "payment-service": 0.0}

        with (
            patch.object(api, "_is_prometheus_up", return_value=True),
            patch.object(api, "_prom_series", side_effect=metric_series) as query,
            patch.object(api, "_probe_service_faults", return_value={
                "order": {"fault": "NONE", "delayMs": 0, "probed": True},
                "payment": {"fault": "NONE", "delayMs": 0, "probed": True},
            }),
        ):
            raw = api.scrape("omnistore")

        self.assertEqual(query.call_count, 9)
        self.assertEqual(raw["order_request_rate"], 3.5)
        self.assertEqual(raw["payment_request_rate"], 8.0)
        self.assertNotIn("catalog_request_rate", raw)
        self.assertTrue(all("catalog-service" not in call.args[0] for call in query.call_args_list))

    def test_healthy_system_has_minimum_score(self):
        impact = api.impact_analysis(self.raw)
        score = api.criticality_analysis(self.raw, impact)
        self.assertEqual(score["percentage"], 5.0)
        self.assertEqual(score["severity"], "INFORMATIONAL")

    def test_different_faults_produce_different_deterministic_scores(self):
        self.raw["payment_fault"] = "LATENCY"
        self.raw["payment_fault_delay_ms"] = 200
        latency = api.criticality_analysis(self.raw, api.impact_analysis(self.raw))["percentage"]

        self.raw["payment_fault"] = "ERROR"
        error = api.criticality_analysis(self.raw, api.impact_analysis(self.raw))["percentage"]

        self.raw["payment_fault"] = "DOWN"
        self.raw["payment_service_up"] = 0.0
        down = api.criticality_analysis(self.raw, api.impact_analysis(self.raw))["percentage"]

        self.assertGreaterEqual(latency, 5)
        self.assertLess(latency, error)
        self.assertNotEqual(error, 90)
        self.assertNotEqual(down, error)
        self.assertEqual(down, api.criticality_analysis(self.raw, api.impact_analysis(self.raw))["percentage"])

    def test_recurrence_changes_score_and_recommendation(self):
        self.raw["payment_fault"] = "ERROR"
        for minutes_ago in (4, 3, 2):
            self.event("payment", "ERROR", minutes_ago)
        impact = api.impact_analysis(self.raw)
        criticality = api.criticality_analysis(self.raw, impact)
        recommendations = api.intelligent_recommendations(self.raw, [], impact, criticality, {"services": {}})
        self.assertTrue(any("recurring" in item["recommendation"].lower() for item in recommendations))
        self.assertGreater(criticality["components"]["recurrence"], 0)

    def test_dependency_recommendation_uses_current_affected_services(self):
        for service in ("order", "payment"):
            self.raw[f"{service}_fault"] = "ERROR"
            self.event(service, "ERROR")
        impact = api.impact_analysis(self.raw)
        criticality = api.criticality_analysis(self.raw, impact)
        recommendations = api.intelligent_recommendations(self.raw, [], impact, criticality, {"services": {}})
        self.assertTrue(any("upstream dependency" in item["recommendation"].lower() for item in recommendations))

    def test_ml_model_loaded_and_uses_71_features(self):
        self.assertIsNotNone(api._model, "Trained RandomForest model should be loaded")
        self.assertIsNotNone(api._scaler, "Trained StandardScaler should be loaded")
        self.assertIsNotNone(api._features, "Feature list should be loaded")
        self.assertEqual(len(api._features), 71, "Model must use exactly 71 features")

    def test_ml_predict_cascade_is_dynamic_not_hardcoded(self):
        # Baseline healthy metrics
        baseline_metrics = {}
        for s in api.SERVICES:
            baseline_metrics[f"{s}_request_rate"] = 1.0
            baseline_metrics[f"{s}_error_rate_5xx"] = 0.0
            baseline_metrics[f"{s}_error_rate_4xx"] = 0.0
            baseline_metrics[f"{s}_p99_latency_s"] = 0.05
            baseline_metrics[f"{s}_p95_latency_s"] = 0.03
            baseline_metrics[f"{s}_p50_latency_s"] = 0.01
            baseline_metrics[f"{s}_jvm_heap_mb"] = 256.0
            baseline_metrics[f"{s}_active_threads"] = 2.0
            baseline_metrics[f"{s}_service_up"] = 1.0
            baseline_metrics[f"{s}_error_ratio"] = 0.0
            baseline_metrics[f"{s}_latency_spike"] = 5.0
        baseline_metrics["system_mean_error_rate"] = 0.0
        baseline_metrics["system_max_error_rate"] = 0.0
        baseline_metrics["system_max_p99_latency"] = 0.05
        baseline_metrics["system_mean_p99_latency"] = 0.05
        baseline_metrics["num_services_down"] = 0

        res_healthy = api.predict_cascade(baseline_metrics)
        self.assertIn(res_healthy["prediction"], ("NORMAL", "CASCADE_FAILURE"))
        self.assertIsInstance(res_healthy["cascade_risk"], float)
        self.assertNotEqual(res_healthy["cascade_risk"], 0.90, "Risk must NOT be a hardcoded 0.90")

        # Cascading failure metrics (multiple services slow & failing)
        cascade_metrics = dict(baseline_metrics)
        for s in ("order", "payment", "inventory"):
            cascade_metrics[f"{s}_error_rate_5xx"] = 0.8
            cascade_metrics[f"{s}_p99_latency_s"] = 3.5
            cascade_metrics[f"{s}_error_ratio"] = 0.8
            cascade_metrics[f"{s}_latency_spike"] = 35.0
        cascade_metrics["system_mean_error_rate"] = 0.4
        cascade_metrics["system_max_error_rate"] = 0.8
        cascade_metrics["system_max_p99_latency"] = 3.5
        cascade_metrics["system_mean_p99_latency"] = 2.0

        res_cascade = api.predict_cascade(cascade_metrics)
        self.assertEqual(res_cascade["prediction"], "CASCADE_FAILURE")
        self.assertGreater(res_cascade["cascade_risk"], res_healthy["cascade_risk"])

    def test_full_pipeline_end_to_end(self):
        with patch.object(api, "_save_incident_log"), patch.object(api, "_save_fault_events"):
            pipeline_res = api.full_pipeline(self.raw)
        self.assertIn("prediction", pipeline_res)
        self.assertIn("cascade_risk", pipeline_res)
        self.assertIn("confidence", pipeline_res)
        self.assertIn("risk_level", pipeline_res)
        self.assertIn("networkx_graph", pipeline_res)
        self.assertIn("recommendations", pipeline_res)
        self.assertIn("incident_log", pipeline_res)
        self.assertEqual(len(pipeline_res["networkx_graph"]["nodes"]), 6)

    def test_full_pipeline_only_returns_current_workload_fault_events(self):
        timestamp = datetime.now(timezone.utc).isoformat()
        api.FAULT_EVENTS.extend([
            {"fault_id": "omni-event", "service": "order", "fault": "DOWN", "status": "ACTIVE", "timestamp": timestamp},
            {"fault_id": "movie-event", "service": "catalog", "fault": "DOWN", "status": "ACTIVE", "timestamp": timestamp},
        ])

        with patch.object(api, "_save_incident_log"), patch.object(api, "_save_fault_events"):
            pipeline_res = api.full_pipeline(self.raw, workload="omnistore")

        self.assertEqual({event["service"] for event in pipeline_res["fault_events"]}, {"order"})
        self.assertEqual(pipeline_res["fault_events"][0]["active_faults"], 1)

    def test_moviestream_pipeline_excludes_omnistore_model_factors(self):
        movie_raw = {}
        for service in api.WORKLOAD_SERVICES["moviestream"]:
            movie_raw[f"{service}_service_up"] = 1.0
            movie_raw[f"{service}_error_rate_5xx"] = 0.0
            movie_raw[f"{service}_error_rate_4xx"] = 0.0
            movie_raw[f"{service}_request_rate"] = 1.0
            movie_raw[f"{service}_p99_latency_s"] = 0.05
            movie_raw[f"{service}_p50_latency_s"] = 0.01
            movie_raw[f"{service}_fault"] = "NONE"
            movie_raw[f"{service}_fault_delay_ms"] = 0

        with patch.object(api, "_save_incident_log"), patch.object(api, "_save_fault_events"):
            result = api.full_pipeline(movie_raw, workload="moviestream")

        self.assertEqual(result["feature_importances"], [])
        self.assertEqual(
            {node["id"] for node in result["networkx_graph"]["nodes"]},
            set(api.WORKLOAD_SERVICES["moviestream"]),
        )
        self.assertTrue(all("cascade_effect_pct" not in node for node in result["networkx_graph"]["nodes"]))

    def test_incident_history_is_scoped_by_workload(self):
        previous_entries = api._incident_snapshot()
        try:
            with api.INCIDENT_LOG_LOCK:
                api.INCIDENT_LOG.clear()
            with patch.object(api, "_save_incident_log"):
                api._append_incident({}, [{"service": "order", "reason": "SERVICE_DOWN"}], "HIGH", "omnistore")
                api._append_incident({}, [{"service": "catalog", "reason": "SERVICE_DOWN"}], "HIGH", "moviestream")

            self.assertEqual(
                {entry["service"] for entry in api._incident_snapshot("omnistore")},
                {"order"},
            )
            self.assertEqual(
                {entry["service"] for entry in api._incident_snapshot("moviestream")},
                {"catalog"},
            )
        finally:
            with api.INCIDENT_LOG_LOCK:
                api.INCIDENT_LOG.clear()
                api.INCIDENT_LOG.extend(previous_entries)

    def test_5_percent_error_rate_evaluates_to_degraded_not_critical(self):
        """Verify that a 5% error rate produces MODERATE/DEGRADED and NOT CRITICAL."""
        # Configure a 5% error rate on payment-service
        test_raw = dict(self.raw)
        test_raw["payment_error_rate_5xx"] = 0.05
        test_raw["payment_request_rate"] = 1.0
        test_raw["payment_service_up"] = 1.0
        test_raw["system_max_error_rate"] = 0.05
        test_raw["system_mean_error_rate"] = 0.05 / 6.0

        impact = api.impact_analysis(test_raw)
        # 5% error rate impact should be around 25%, not 100%
        self.assertLessEqual(impact["services"]["payment"], 30.0)

        criticality = api.criticality_analysis(test_raw, impact)
        # Severity for 5% error rate should be MODERATE or MINOR, NOT CRITICAL
        self.assertNotEqual(criticality["severity"], "CRITICAL")

        with patch.object(api, "_save_incident_log"), patch.object(api, "_save_fault_events"), patch.object(api, "_append_incident"):
            pipeline_res = api.full_pipeline(test_raw)
        # Risk level should NOT be CRITICAL for a 5% error rate
        self.assertNotEqual(pipeline_res["risk_level"], "CRITICAL")
        self.assertIn(pipeline_res["risk_level"], ("LOW", "MEDIUM", "MODERATE", "DEGRADED"))

    def test_error_impact_uses_error_ratio_not_absolute_error_rate(self):
        low_traffic = dict(self.raw, payment_request_rate=1.0, payment_error_rate_5xx=0.02)
        high_traffic = dict(self.raw, payment_request_rate=100.0, payment_error_rate_5xx=2.0)

        low_impact = api.impact_analysis(low_traffic)
        high_impact = api.impact_analysis(high_traffic)

        self.assertEqual(low_impact["services"]["payment"], high_impact["services"]["payment"])

    def test_dashboard_percentage_reports_share_of_affected_services(self):
        test_raw = dict(self.raw, payment_request_rate=1.0, payment_error_rate_5xx=0.05)
        with patch.object(api, "_save_incident_log"), patch.object(api, "_save_fault_events"), patch.object(api, "_append_incident"):
            result = api.full_pipeline(test_raw)

        self.assertEqual(result["affected_services"], 1)
        self.assertAlmostEqual(result["affected_service_percentage"], 100 / len(api.SERVICES), places=1)
        self.assertEqual(result["live_metrics"]["payment"]["error_rate_pct"], 5.0)

    def test_unavailable_prometheus_does_not_report_healthy_metrics(self):
        test_raw = dict(self.raw, prometheus_connected=False)
        with patch.object(api, "_save_incident_log"), patch.object(api, "_save_fault_events"), patch.object(api, "_append_incident"):
            result = api.full_pipeline(test_raw)

        self.assertIsNone(result["live_metrics"]["order"]["service_up"])
        self.assertFalse(result["sla_compliance"]["services"]["order"]["metrics_available"])
        self.assertTrue(any("Prometheus metrics are unavailable" == item["title"] for item in result["recommendations"]))

    def test_moviestream_service_logs_are_read_from_local_files(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            Path(temp_dir, "catalog-service.log").write_text(
                "INFO catalog ready\nERROR catalog query failed\n",
                encoding="utf-8",
            )
            with patch.object(api, "MOVIESTREAM_LOG_DIR", temp_dir):
                response = api.app.test_client().get(
                    "/api/service-logs?workload=moviestream&service=catalog&limit=1"
                )

        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertEqual(payload["source"], "local-file")
        self.assertEqual(payload["count"], 1)
        self.assertIn("ERROR", payload["logs"][0]["line"])

    def test_service_logs_reject_services_outside_the_workload(self):
        response = api.app.test_client().get(
            "/api/service-logs?workload=moviestream&service=order"
        )

        self.assertEqual(response.status_code, 400)


if __name__ == "__main__":
    unittest.main()
