"""
Cascading Failure Prediction REST API
======================================
Serves the trained Random Forest model as a REST endpoint.
The Developer Dashboard calls this to get real-time cascade risk scores.

Endpoints
---------
  GET  /health                   — liveness check
  POST /predict                  — predict cascade risk from a metric snapshot
  GET  /metrics/live             — scrape live Prometheus metrics and predict
  GET  /model/features           — list features the model expects
  GET  /model/info               — model metadata

Usage
-----
  pip install flask requests joblib pandas numpy scikit-learn
  python predict_api.py

  # Or with a custom model path:
  MODEL_DIR=./model python predict_api.py --port 5001
"""

import json
import os
import sys
import warnings
warnings.filterwarnings("ignore")

import joblib
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


# ─── Prometheus scraper (for /metrics/live) ──────────────────────────────────

PROMETHEUS_URL = os.getenv("PROMETHEUS_URL", "http://localhost:9090")
SERVICES_SHORT = ["order", "payment", "inventory", "shipping", "delivery", "notification"]

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

    row["system_mean_error_rate"]  = np.mean([row.get(c, 0) for c in error_cols])
    row["system_max_error_rate"]   = max(row.get(c, 0) for c in error_cols)
    row["system_max_p99_latency"]  = max(row.get(c, 0) for c in p99_cols)
    row["system_mean_p99_latency"] = np.mean([row.get(c, 0) for c in p99_cols])
    row["num_services_down"]       = sum(1 for c in up_cols if row.get(c, 1) == 0)

    return row


def build_feature_vector(raw: dict) -> np.ndarray:
    """Align raw metrics to the model's expected feature vector."""
    if features is None:
        raise RuntimeError("Model not loaded")
    vec = np.array([float(raw.get(f, 0)) for f in features]).reshape(1, -1)
    return scaler.transform(vec)


def predict_risk(feature_vec: np.ndarray) -> dict:
    """Run the model and return prediction + confidence."""
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


def identify_root_cause(raw: dict) -> list:
    """
    Heuristic root-cause identification:
    Returns services whose error_rate or latency is abnormally high.
    """
    causes = []
    for svc in SERVICES_SHORT:
        err   = raw.get(f"{svc}_error_rate_5xx", 0)
        p99   = raw.get(f"{svc}_p99_latency_s",  0)
        up    = raw.get(f"{svc}_service_up",      1)
        if up == 0:
            causes.append({"service": svc, "reason": "SERVICE_DOWN",    "metric": "service_up",      "value": 0})
        elif err > 0.1:
            causes.append({"service": svc, "reason": "HIGH_ERROR_RATE", "metric": "error_rate_5xx",  "value": round(err, 4)})
        elif p99 > 2.0:
            causes.append({"service": svc, "reason": "HIGH_LATENCY",    "metric": "p99_latency_s",   "value": round(p99, 4)})
    causes.sort(key=lambda x: (x["reason"] == "SERVICE_DOWN", x.get("value", 0)), reverse=True)
    return causes[:3]


def build_cascade_path(root_causes: list) -> list:
    """Estimate cascade propagation path from the architectural dependency map."""
    CASCADE_PATHS = {
        "payment":      ["order"],
        "inventory":    ["order"],
        "shipping":     ["order"],
        "notification": ["order", "payment", "shipping"],
        "delivery":     ["shipping", "order"],
        "order":        [],
    }
    affected = set(c["service"] for c in root_causes)
    path = list(affected)
    for svc in list(affected):
        path.extend(CASCADE_PATHS.get(svc, []))
    return list(dict.fromkeys(path))  # deduplicate, preserve order


def build_recommendations(root_causes: list, risk_level: str) -> list:
    recs = []
    for cause in root_causes:
        svc    = cause["service"]
        reason = cause["reason"]
        if reason == "SERVICE_DOWN":
            recs.append(f"Restart {svc} — it is currently returning 503.")
            recs.append(f"Check {svc} container logs: docker logs {svc}-service")
        elif reason == "HIGH_ERROR_RATE":
            recs.append(f"Investigate {svc} errors — error rate is {cause['value']:.3f} req/s.")
            recs.append(f"Check {svc} MongoDB connectivity and recent deployments.")
        elif reason == "HIGH_LATENCY":
            recs.append(f"{svc} p99 latency is {cause['value']:.2f}s — check DB query performance.")
            recs.append(f"Consider adding a circuit breaker timeout on {svc} callers.")
    if risk_level in ("HIGH", "CRITICAL"):
        recs.append("Consider activating fallback mode in the API Gateway.")
    return recs


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
        "type":             "RandomForestClassifier",
        "n_estimators":     model.n_estimators,
        "n_features":       len(features),
        "classes":          list(model.classes_.tolist()),
        "feature_count":    len(features),
    })


@app.route("/predict", methods=["POST"])
def predict():
    """
    Accepts a JSON body with metric values keyed by feature name.
    Returns prediction, cascade risk, root cause, cascade path, recommendations.
    """
    if model is None:
        return jsonify({"error": "Model not loaded. Run ml/train.py first."}), 503

    raw = request.get_json(force=True) or {}

    try:
        vec    = build_feature_vector(raw)
        result = predict_risk(vec)
        causes = identify_root_cause(raw)
        path   = build_cascade_path(causes)
        recs   = build_recommendations(causes, result["risk_level"])
    except Exception as e:
        return jsonify({"error": str(e)}), 500

    return jsonify({
        **result,
        "root_cause":       causes,
        "cascade_path":     path,
        "recommendations":  recs,
        "raw_metrics":      {k: round(v, 4) for k, v in raw.items() if isinstance(v, (int, float))},
    })


@app.route("/metrics/live")
def metrics_live():
    """
    Scrapes live Prometheus data, runs prediction, and returns full analysis.
    This is the endpoint the Developer Dashboard polls.
    """
    raw    = scrape_live_metrics()
    causes = identify_root_cause(raw)
    path   = build_cascade_path(causes)

    # If model not loaded, return live metrics with rule-based risk assessment
    if model is None:
        # Rule-based risk when model not available
        num_down  = int(raw.get("num_services_down", 0))
        err_rate  = float(raw.get("system_mean_error_rate", 0))
        p99       = float(raw.get("system_max_p99_latency", 0))

        if num_down >= 2 or err_rate > 0.5:
            risk_level = "CRITICAL"; cascade_risk = 0.90
        elif num_down == 1 or err_rate > 0.1:
            risk_level = "HIGH";     cascade_risk = 0.70
        elif err_rate > 0.05 or p99 > 2.0:
            risk_level = "MEDIUM";   cascade_risk = 0.40
        else:
            risk_level = "LOW";      cascade_risk = 0.05

        recs = build_recommendations(causes, risk_level)
        return jsonify({
            "prediction":      "CASCADE_FAILURE" if cascade_risk > 0.5 else "NORMAL",
            "cascade_risk":    round(cascade_risk, 4),
            "risk_level":      risk_level,
            "confidence":      0.75,
            "model_note":      "Rule-based assessment (ML model not trained yet)",
            "root_cause":      causes,
            "cascade_path":    path,
            "recommendations": recs,
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
        "root_cause":       causes,
        "cascade_path":     path,
        "recommendations":  recs,
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
            "mean_error_rate":  round(raw.get("system_mean_error_rate",  0), 4),
            "max_p99_latency":  round(raw.get("system_max_p99_latency",  0), 4),
            "num_services_down": int(raw.get("num_services_down", 0)),
        },
    })


# ─── Entry point ──────────────────────────────────────────────────────────────

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
    print("  GET  /metrics/live  — auto-scrapes Prometheus + predicts")
    print("  GET  /model/info")
    app.run(host=args.host, port=args.port, debug=False)
