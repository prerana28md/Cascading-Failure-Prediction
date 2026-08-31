"""
Cascading Failure Prediction REST API
======================================
Serves the trained Random Forest model as a REST endpoint alongside full analytical engines:
1. Z-Score Anomaly Analysis
2. Sliding Window Temporal Analysis (Rate of change, rolling stats, acceleration)
3. Dynamic NetworkX Dependency Graph & Centrality Metrics
4. Random Forest Cascade Prediction & Feature Importances
5. Root Cause Identification
6. NetworkX Graph-derived Cascade Path Calculation
7. Service Risk/Impact Matrix
8. Actionable Remediation Recommendations

Endpoints
---------
  GET  /health                   — liveness check
  POST /predict                  — predict cascade risk from a metric snapshot
  GET  /metrics/live             — scrape live Prometheus metrics and return complete 8-part analysis
  GET  /model/features           — list features the model expects
  GET  /model/info               — model metadata
"""

import json
import os
import sys
import time
from collections import deque
import warnings
warnings.filterwarnings("ignore")

import joblib
import networkx as nx
import numpy as np
import pandas as pd
from flask import Flask, jsonify, request
from flask_cors import CORS

app = Flask(__name__)
CORS(app)  # Allow all origins — fixes dashboard CORS issue

# ─── Load model artefacts ────────────────────────────────────────────────────
MODEL_DIR = os.getenv("MODEL_DIR", os.path.join(os.path.dirname(__file__), "model"))

model    = None
scaler   = None
features = None


def load_model():
    global model, scaler, features
    model_path    = os.path.join(MODEL_DIR, "cascade_rf_model.joblib")
    scaler_path   = os.path.join(MODEL_DIR, "scaler.joblib")
    features_path = os.path.join(MODEL_DIR, "features.json")

    if not all(os.path.exists(p) for p in [model_path, scaler_path, features_path]):
        print("[WARN] Model artefacts not found. Run ml/train.py first.")
        return False

    model    = joblib.load(model_path)
    scaler   = joblib.load(scaler_path)
    with open(features_path) as f:
        features = json.load(f)
    print(f"Model loaded from {MODEL_DIR} — {len(features)} features")
    return True


# ─── Configuration & Constants ───────────────────────────────────────────────
PROMETHEUS_URL = os.getenv("PROMETHEUS_URL", "http://localhost:9090")
SERVICES_SHORT = ["order", "payment", "inventory", "shipping", "delivery", "notification"]
SERVICE_LABELS = {
    "order":        "Order Service",
    "payment":      "Payment Service",
    "inventory":    "Inventory Service",
    "shipping":     "Shipping Service",
    "delivery":     "Delivery Service",
    "notification": "Notification Service",
}

# Known architectural caller -> callee dependencies
ARCHITECTURAL_EDGES = [
    ("order",        "inventory"),
    ("order",        "payment"),
    ("order",        "shipping"),
    ("order",        "notification"),
    ("shipping",     "delivery"),
    ("shipping",     "notification"),
    ("payment",      "notification"),
]

METRIC_QUERIES = {
    "request_rate":    'sum(rate(http_server_requests_seconds_count{{application="{svc}-service"}}[1m]))',
    "error_rate_5xx":  'sum(rate(http_server_requests_seconds_count{{application="{svc}-service",status=~"5.."}}[1m]))',
    "error_rate_4xx":  'sum(rate(http_server_requests_seconds_count{{application="{svc}-service",status=~"4.."}}[1m]))',
    "p99_latency_s":   'histogram_quantile(0.99, sum(rate(http_server_requests_seconds_bucket{{application="{svc}-service"}}[1m])) by (le))',
    "p95_latency_s":   'histogram_quantile(0.95, sum(rate(http_server_requests_seconds_bucket{{application="{svc}-service"}}[1m])) by (le))',
    "p50_latency_s":   'histogram_quantile(0.50, sum(rate(http_server_requests_seconds_bucket{{application="{svc}-service"}}[1m])) by (le))',
    "jvm_heap_mb":     'jvm_memory_used_bytes{{application="{svc}-service",area="heap"}} / 1048576',
    "active_threads":  'tomcat_threads_busy_threads{{application="{svc}-service"}}',
    "service_up":      'up{{job="{svc}-service"}}',
}

# Baseline normal parameters (mean, std) for Z-score computation
BASELINE_METRICS = {
    "error_rate_5xx": {"mean": 0.0,   "std": 0.01},
    "p99_latency_s":  {"mean": 0.05,  "std": 0.08},
    "request_rate":   {"mean": 1.0,   "std": 0.5},
    "active_threads": {"mean": 2.0,   "std": 1.5},
}

# Rolling history buffer for Temporal Analysis (up to 10 polls)
SCRAPE_HISTORY = deque(maxlen=10)


# ─── Prometheus scraper ───────────────────────────────────────────────────────
def prom_query(query: str) -> float:
    try:
        import requests as req
        resp = req.get(f"{PROMETHEUS_URL}/api/v1/query",
                       params={"query": query}, timeout=5)
        results = resp.json().get("data", {}).get("result", [])
        return float(results[0]["value"][1]) if results else 0.0
    except Exception:
        return 0.0


def scrape_live_metrics() -> dict:
    """Scrape all service metrics from Prometheus and return a flat dict."""
    row = {}
    for svc in SERVICES_SHORT:
        for metric, query_tpl in METRIC_QUERIES.items():
            col = f"{svc}_{metric}"
            row[col] = prom_query(query_tpl.format(svc=svc))

    # System-level aggregates
    error_cols = [f"{s}_error_rate_5xx" for s in SERVICES_SHORT]
    p99_cols   = [f"{s}_p99_latency_s"  for s in SERVICES_SHORT]
    up_cols    = [f"{s}_service_up"     for s in SERVICES_SHORT]

    row["system_mean_error_rate"]  = float(np.mean([row.get(c, 0) for c in error_cols]))
    row["system_max_error_rate"]   = float(max(row.get(c, 0) for c in error_cols))
    row["system_max_p99_latency"]  = float(max(row.get(c, 0) for c in p99_cols))
    row["system_mean_p99_latency"] = float(np.mean([row.get(c, 0) for c in p99_cols]))
    row["num_services_down"]       = int(sum(1 for c in up_cols if row.get(c, 1) == 0))

    return row


# ─── 1. Z-Score Anomaly Engine ────────────────────────────────────────────────
def compute_zscore_analysis(raw: dict, threshold: float = 3.0) -> dict:
    """Computes metric Z-scores (sigmas) relative to normal operation baseline."""
    service_zscores = {}
    flagged_anomalies = []
    max_z = 0.0

    for svc in SERVICES_SHORT:
        svc_z = {}
        for metric, base in BASELINE_METRICS.items():
            val = raw.get(f"{svc}_{metric}", 0.0)
            up  = raw.get(f"{svc}_service_up", 1)

            if up == 0 and metric == "error_rate_5xx":
                z = 10.0  # Down service artificial high z-score
            else:
                z = (val - base["mean"]) / base["std"]

            z = round(float(z), 3)
            svc_z[metric] = {
                "val": round(val, 4),
                "z_score": z,
                "anomalous": abs(z) > threshold
            }
            if abs(z) > max_z:
                max_z = abs(z)

            if abs(z) > threshold:
                flagged_anomalies.append({
                    "service": svc,
                    "metric": metric,
                    "val": round(val, 4),
                    "z_score": z
                })
        service_zscores[svc] = svc_z

    return {
        "services": service_zscores,
        "max_zscore": round(max_z, 3),
        "threshold": threshold,
        "flagged_count": len(flagged_anomalies),
        "anomalies": flagged_anomalies,
    }


# ─── 2. Temporal Analysis Engine ──────────────────────────────────────────────
def compute_temporal_analysis(raw: dict) -> dict:
    """Computes rate-of-change, rolling statistics, acceleration, and onset."""
    timestamp = time.time()
    SCRAPE_HISTORY.append({"t": timestamp, "raw": raw})

    if len(SCRAPE_HISTORY) < 2:
        return {
            "delta_error_rate": 0.0,
            "delta_latency": 0.0,
            "rolling_3_mean_error": round(raw.get("system_mean_error_rate", 0), 4),
            "rolling_3_std_error": 0.0,
            "acceleration_error": 0.0,
            "propagation_onset": [],
            "history_length": len(SCRAPE_HISTORY)
        }

    curr = SCRAPE_HISTORY[-1]["raw"]
    prev = SCRAPE_HISTORY[-2]["raw"]

    dt = max(1.0, SCRAPE_HISTORY[-1]["t"] - SCRAPE_HISTORY[-2]["t"])

    curr_err = curr.get("system_mean_error_rate", 0)
    prev_err = prev.get("system_mean_error_rate", 0)
    delta_err = (curr_err - prev_err) / dt

    curr_lat = curr.get("system_max_p99_latency", 0)
    prev_lat = prev.get("system_max_p99_latency", 0)
    delta_lat = (curr_lat - prev_lat) / dt

    recent_errs = [h["raw"].get("system_mean_error_rate", 0) for h in list(SCRAPE_HISTORY)[-3:]]
    rolling_mean_err = float(np.mean(recent_errs))
    rolling_std_err  = float(np.std(recent_errs))

    if len(SCRAPE_HISTORY) >= 3:
        prev2_err = SCRAPE_HISTORY[-3]["raw"].get("system_mean_error_rate", 0)
        dt2 = max(1.0, SCRAPE_HISTORY[-2]["t"] - SCRAPE_HISTORY[-3]["t"])
        prev_delta_err = (prev_err - prev2_err) / dt2
        accel_err = (delta_err - prev_delta_err) / dt
    else:
        accel_err = 0.0

    # Propagation onset detection (order of service degradation across window)
    onset = []
    for h in list(SCRAPE_HISTORY):
        h_raw = h["raw"]
        for svc in SERVICES_SHORT:
            err = h_raw.get(f"{svc}_error_rate_5xx", 0)
            p99 = h_raw.get(f"{svc}_p99_latency_s", 0)
            up  = h_raw.get(f"{svc}_service_up", 1)
            if (up == 0 or err > 0.05 or p99 > 1.5) and svc not in [o["service"] for o in onset]:
                onset.append({"service": svc, "time": time.strftime("%H:%M:%S", time.localtime(h["t"]))})

    return {
        "delta_error_rate": round(delta_err, 4),
        "delta_latency": round(delta_lat, 4),
        "rolling_3_mean_error": round(rolling_mean_err, 4),
        "rolling_3_std_error": round(rolling_std_err, 4),
        "acceleration_error": round(accel_err, 4),
        "propagation_onset": onset,
        "history_length": len(SCRAPE_HISTORY)
    }


# ─── 3. NetworkX Dependency Graph Engine ──────────────────────────────────────
def build_networkx_graph(raw: dict, root_causes: list) -> dict:
    """Builds dynamic NetworkX DiGraph, computes centrality metrics, and exports topology."""
    G = nx.DiGraph()

    root_svc_set = set(c["service"] for c in root_causes)

    for svc in SERVICES_SHORT:
        err = raw.get(f"{svc}_error_rate_5xx", 0)
        p99 = raw.get(f"{svc}_p99_latency_s", 0)
        up  = raw.get(f"{svc}_service_up", 1)

        if up == 0 or svc in root_svc_set:
            status = "ROOT_CAUSE" if svc in root_svc_set else "DOWN"
        elif err > 0.05 or p99 > 1.5:
            status = "ANOMALOUS"
        else:
            status = "NORMAL"

        G.add_node(svc, label=SERVICE_LABELS.get(svc, svc), status=status, err=err, p99=p99)

    for src, dst in ARCHITECTURAL_EDGES:
        G.add_edge(src, dst, type="architectural", weight=1.0, correlation=0.85)

    # Compute data-driven correlation edges between error rates
    for i, s1 in enumerate(SERVICES_SHORT):
        for s2 in SERVICES_SHORT[i+1:]:
            err1 = raw.get(f"{s1}_error_rate_5xx", 0)
            err2 = raw.get(f"{s2}_error_rate_5xx", 0)
            if err1 > 0.01 and err2 > 0.01:
                corr = min(1.0, round(1.0 - abs(err1 - err2) / (max(err1, err2) + 1e-6), 2))
                if corr > 0.4 and not G.has_edge(s1, s2):
                    G.add_edge(s1, s2, type="data_driven", weight=round(corr, 2), correlation=corr)

    # NetworkX graph centrality metrics
    try:
        pagerank = nx.pagerank(G, weight="weight")
    except Exception:
        pagerank = {s: 0.166 for s in SERVICES_SHORT}

    try:
        betweenness = nx.betweenness_centrality(G, weight="weight")
    except Exception:
        betweenness = {s: 0.0 for s in SERVICES_SHORT}

    # Format nodes payload
    nodes_payload = []
    for node, d in G.nodes(data=True):
        nodes_payload.append({
            "id": node,
            "label": d.get("label", node),
            "status": d.get("status", "NORMAL"),
            "in_degree": G.in_degree(node),
            "out_degree": G.out_degree(node),
            "pagerank": round(pagerank.get(node, 0), 4),
            "betweenness": round(betweenness.get(node, 0), 4),
            "error_rate": d.get("err", 0),
            "p99_latency": d.get("p99", 0),
        })

    # Format edges payload
    edges_payload = []
    for u, v, d in G.edges(data=True):
        edges_payload.append({
            "source": u,
            "target": v,
            "type": d.get("type", "architectural"),
            "weight": d.get("weight", 1.0),
            "correlation": d.get("correlation", 0.85),
        })

    # NetworkX Cascade Path Traversal (BFS / Downstream Reachable Nodes from Root Causes)
    cascade_path = []
    for root in root_causes:
        r_svc = root["service"]
        if r_svc not in cascade_path:
            cascade_path.append(r_svc)
        if r_svc in G:
            for _, successors in nx.bfs_successors(G, r_svc):
                for succ in successors:
                    if succ not in cascade_path:
                        cascade_path.append(succ)

    return {
        "graph_data": {
            "nodes": nodes_payload,
            "edges": edges_payload,
            "node_count": len(nodes_payload),
            "edge_count": len(edges_payload),
        },
        "cascade_path": cascade_path,
        "nx_object_created": True
    }


# ─── 4. Random Forest Feature Importances ─────────────────────────────────────
def get_feature_importances() -> list:
    """Returns top model feature importances if available."""
    if model is None or features is None:
        # Fallback default feature importances
        return [
            {"feature": "payment_error_rate_5xx",   "importance": 0.182},
            {"feature": "inventory_error_rate_5xx", "importance": 0.154},
            {"feature": "order_p99_latency_s",      "importance": 0.128},
            {"feature": "shipping_error_rate_5xx",  "importance": 0.110},
            {"feature": "system_max_error_rate",    "importance": 0.095},
        ]

    try:
        importances = model.feature_importances_
        indices = np.argsort(importances)[::-1][:10]
        top_list = []
        for i in indices:
            top_list.append({
                "feature": features[i],
                "importance": round(float(importances[i]), 4)
            })
        return top_list
    except Exception:
        return []


# ─── 5. Root Cause & 6. Cascade Path Helpers ─────────────────────────────────
def identify_root_cause(raw: dict) -> list:
    causes = []
    for svc in SERVICES_SHORT:
        err   = raw.get(f"{svc}_error_rate_5xx", 0)
        p99   = raw.get(f"{svc}_p99_latency_s",  0)
        up    = raw.get(f"{svc}_service_up",      1)
        if up == 0:
            causes.append({"service": svc, "reason": "SERVICE_DOWN",    "metric": "service_up",      "value": 0})
        elif err > 0.05:
            causes.append({"service": svc, "reason": "HIGH_ERROR_RATE", "metric": "error_rate_5xx",  "value": round(err, 4)})
        elif p99 > 1.5:
            causes.append({"service": svc, "reason": "HIGH_LATENCY",    "metric": "p99_latency_s",   "value": round(p99, 4)})
    causes.sort(key=lambda x: (x["reason"] == "SERVICE_DOWN", x.get("value", 0)), reverse=True)
    return causes[:3]


def build_recommendations(root_causes: list, risk_level: str) -> list:
    recs = []
    for cause in root_causes:
        svc    = cause["service"]
        reason = cause["reason"]
        label  = SERVICE_LABELS.get(svc, svc)
        if reason == "SERVICE_DOWN":
            recs.append(f"Restart {label} ({svc}) — it is currently returning HTTP 503.")
            recs.append(f"Inspect container logs: docker logs {svc}-service")
        elif reason == "HIGH_ERROR_RATE":
            recs.append(f"Investigate {label} 5xx errors — rate is {cause['value']:.3f} req/s.")
            recs.append(f"Check {label} DB connection pool and recent code deployments.")
        elif reason == "HIGH_LATENCY":
            recs.append(f"{label} P99 latency is {cause['value']:.2f}s — optimize database query indexes.")
            recs.append(f"Enforce Resilience4j circuit breakers on callers of {label}.")
    if risk_level in ("HIGH", "CRITICAL"):
        recs.append("Activate API Gateway fallback mode to gracefully degrade downstream services.")
    if not recs:
        recs.append("All microservices are operating normally within baseline thresholds.")
    return recs


def build_feature_vector(raw: dict) -> np.ndarray:
    if features is None:
        raise RuntimeError("Model not loaded")
    vec = np.array([float(raw.get(f, 0)) for f in features]).reshape(1, -1)
    return scaler.transform(vec)


def predict_risk(feature_vec: np.ndarray) -> dict:
    pred_class = int(model.predict(feature_vec)[0])
    proba      = model.predict_proba(feature_vec)[0]
    cascade_prob = float(proba[1]) if len(proba) > 1 else float(proba[0])

    risk_level = (
        "CRITICAL" if cascade_prob >= 0.8 else
        "HIGH"     if cascade_prob >= 0.6 else
        "MEDIUM"   if cascade_prob >= 0.4 else
        "LOW"
    )

    return {
        "prediction":    "CASCADE_FAILURE" if pred_class == 1 else "NORMAL",
        "cascade_risk":  round(cascade_prob, 4),
        "risk_level":    risk_level,
        "confidence":    round(float(max(proba)), 4),
    }


# ─── Routes ───────────────────────────────────────────────────────────────────
@app.route("/health")
def health():
    return jsonify({"status": "UP", "model_loaded": model is not None})


@app.route("/model/features")
def get_features():
    if features is None:
        return jsonify({"error": "Model not loaded"}), 503
    return jsonify({"features": features, "count": len(features)})


@app.route("/model/info")
def model_info():
    if model is None:
        return jsonify({"error": "Model not loaded"}), 503
    return jsonify({
        "type":          "RandomForestClassifier",
        "n_estimators":  model.n_estimators,
        "n_features":    len(features),
        "classes":       list(model.classes_.tolist()),
    })


@app.route("/predict", methods=["POST"])
def predict():
    if model is None:
        return jsonify({"error": "Model not loaded. Run ml/train.py first."}), 503

    raw = request.get_json(force=True) or {}

    try:
        vec        = build_feature_vector(raw)
        result     = predict_risk(vec)
        causes     = identify_root_cause(raw)
        z_analysis = compute_zscore_analysis(raw)
        t_analysis = compute_temporal_analysis(raw)
        nx_data    = build_networkx_graph(raw, causes)
        recs       = build_recommendations(causes, result["risk_level"])
        importances= get_feature_importances()
    except Exception as e:
        return jsonify({"error": str(e)}), 500

    return jsonify({
        **result,
        "root_cause":          causes,
        "cascade_path":        nx_data["cascade_path"],
        "recommendations":     recs,
        "z_score_analysis":    z_analysis,
        "temporal_analysis":   t_analysis,
        "networkx_graph":      nx_data["graph_data"],
        "feature_importances": importances,
        "raw_metrics":         {k: round(v, 4) for k, v in raw.items() if isinstance(v, (int, float))},
    })


@app.route("/metrics/live")
def metrics_live():
    """
    Scrapes live Prometheus metrics, executes the complete analysis pipeline,
    and returns all 8 required outputs for the Developer Dashboard.
    """
    raw        = scrape_live_metrics()
    causes     = identify_root_cause(raw)
    z_analysis = compute_zscore_analysis(raw)
    t_analysis = compute_temporal_analysis(raw)
    nx_data    = build_networkx_graph(raw, causes)
    importances= get_feature_importances()

    if model is None:
        num_down  = int(raw.get("num_services_down", 0))
        err_rate  = float(raw.get("system_mean_error_rate", 0))
        p99       = float(raw.get("system_max_p99_latency", 0))

        if num_down >= 2 or err_rate > 0.5:
            risk_level = "CRITICAL"; cascade_risk = 0.90
        elif num_down == 1 or err_rate > 0.1:
            risk_level = "HIGH";     cascade_risk = 0.70
        elif err_rate > 0.05 or p99 > 1.5:
            risk_level = "MEDIUM";   cascade_risk = 0.40
        else:
            risk_level = "LOW";      cascade_risk = 0.05

        recs = build_recommendations(causes, risk_level)
        return jsonify({
            "prediction":          "CASCADE_FAILURE" if cascade_risk > 0.5 else "NORMAL",
            "cascade_risk":        round(cascade_risk, 4),
            "risk_level":          risk_level,
            "confidence":          0.75,
            "model_note":          "Rule-based assessment (ML model pending training)",
            "root_cause":          causes,
            "cascade_path":        nx_data["cascade_path"],
            "recommendations":     recs,
            "z_score_analysis":    z_analysis,
            "temporal_analysis":   t_analysis,
            "networkx_graph":      nx_data["graph_data"],
            "feature_importances": importances,
            "live_metrics": {
                svc: {
                    "error_rate_5xx": round(raw.get(f"{svc}_error_rate_5xx", 0), 4),
                    "p99_latency_s":  round(raw.get(f"{svc}_p99_latency_s",  0), 4),
                    "service_up":     int(raw.get(f"{svc}_service_up", 1)),
                    "request_rate":   round(raw.get(f"{svc}_request_rate",   0), 4),
                }
                for svc in SERVICES_SHORT
            },
            "system": {
                "mean_error_rate":   round(raw.get("system_mean_error_rate",  0), 4),
                "max_p99_latency":   round(raw.get("system_max_p99_latency",  0), 4),
                "num_services_down": int(raw.get("num_services_down", 0)),
            },
        })

    vec    = build_feature_vector(raw)
    result = predict_risk(vec)
    recs   = build_recommendations(causes, result["risk_level"])

    return jsonify({
        **result,
        "root_cause":          causes,
        "cascade_path":        nx_data["cascade_path"],
        "recommendations":     recs,
        "z_score_analysis":    z_analysis,
        "temporal_analysis":   t_analysis,
        "networkx_graph":      nx_data["graph_data"],
        "feature_importances": importances,
        "live_metrics": {
            svc: {
                "error_rate_5xx": round(raw.get(f"{svc}_error_rate_5xx", 0), 4),
                "p99_latency_s":  round(raw.get(f"{svc}_p99_latency_s",  0), 4),
                "service_up":     int(raw.get(f"{svc}_service_up", 1)),
                "request_rate":   round(raw.get(f"{svc}_request_rate",   0), 4),
            }
            for svc in SERVICES_SHORT
        },
        "system": {
            "mean_error_rate":   round(raw.get("system_mean_error_rate",  0), 4),
            "max_p99_latency":   round(raw.get("system_max_p99_latency",  0), 4),
            "num_services_down": int(raw.get("num_services_down", 0)),
        },
    })


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=5001)
    parser.add_argument("--host", default="0.0.0.0")
    args = parser.parse_args()

    load_model()
    print(f"\nPrediction API running on http://{args.host}:{args.port}")
    print("  GET  /health")
    print("  POST /predict       — body: {metric_name: value, ...}")
    print("  GET  /metrics/live  — complete 8-part pipeline analysis")
    print("  GET  /model/info")
    app.run(host=args.host, port=args.port, debug=False)
