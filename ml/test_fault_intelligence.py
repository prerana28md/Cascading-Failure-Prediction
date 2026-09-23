import unittest
from datetime import datetime, timezone

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
        pipeline_res = api.full_pipeline(self.raw)
        self.assertIn("prediction", pipeline_res)
        self.assertIn("cascade_risk", pipeline_res)
        self.assertIn("confidence", pipeline_res)
        self.assertIn("risk_level", pipeline_res)
        self.assertIn("networkx_graph", pipeline_res)
        self.assertIn("recommendations", pipeline_res)
        self.assertIn("incident_log", pipeline_res)
        self.assertEqual(len(pipeline_res["networkx_graph"]["nodes"]), 6)

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

        pipeline_res = api.full_pipeline(test_raw)
        # Risk level should NOT be CRITICAL for a 5% error rate
        self.assertNotEqual(pipeline_res["risk_level"], "CRITICAL")
        self.assertIn(pipeline_res["risk_level"], ("LOW", "MEDIUM", "MODERATE", "DEGRADED"))


if __name__ == "__main__":
    unittest.main()

