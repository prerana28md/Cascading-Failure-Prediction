"""
Cascading Failure Prediction — REST API
Serves live Prometheus metrics analysis + ML prediction to the Developer Dashboard.

Endpoints:
  GET  /health          — liveness check
  GET  /metrics/live    — scrape Prometheus + full analysis + prediction
  GET  /model/info      — model metadata
  POST /predict         — predict from posted metric JSON
"""

import json
import os
import time
import warnings
from collections import deque

warnings.filterwarnings("ignore")

import networkx as nx
import numpy as np
import joblib
from flask import Flask, jsonify, request
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

# ── Config ────────────────────────────────────────────────────────────────────
PROMETHEUS_URL = os.getenv("PROMETHEUS_URL", "http://localhost:9090")
MODEL_DIR      = os.getenv("MODEL_DIR", os.path.join(os.path.dirname(__file__), "model"))

SERVICES = ["order", "payment", "inventory", "shipping", "delivery", "notification"]

SERVICE_LABELS = {
    "order":        "Order Service",
    "payment":      "Payment Service",
    "inventory":    "Inventory Service",
    "shipping":     "Shipping Service",
    "delivery":     "Delivery Service",
    "notification": "Notification Service",
}

ARCH_EDGES = [
    ("order", "inventory"), ("order", "payment"),
    ("order", "shipping"),  ("order", "notification"),
    ("shipping", "delivery"), ("shipping", "notification"),
    ("payment", "notification"),
]

BASELINE = {
    "error_rate_5xx": {"mean": 0.0,  "std": 0.01},
    "p99_latency_s":  {"mean": 0.05, "std": 0.08},
    "request_rate":   {"mean": 1.0,  "std": 0.50},
    "active_threads": {"mean": 2.0,  "std": 1.50},
}

HISTORY = deque(maxlen=10)

# ── Model (loaded lazily) ─────────────────────────────────────────────────────
_model    = None
_scaler   = None
_features = None


def _load_model():
    global _model, _scaler, _features
    mp = os.path.join(MODEL_DIR, "cascade_rf_model.joblib")
    sp = os.path.join(MODEL_DIR, "scaler.joblib")
    fp = os.path.join(MODEL_DIR, "features.json")
    if os.path.exists(mp) and os.path.exists(sp) and os.path.exists(fp):
        _model  = joblib.load(mp)
        _scaler = joblib.load(sp)
        with open(fp) as f:
            _features = json.load(f)
        print(f"[INFO] Model loaded — {len(_features)} features")
    else:
        print("[WARN] No trained model found. Rule-based fallback active.")


# ── Prometheus scraper ────────────────────────────────────────────────────────
def _prom(query):
    try:
        import requests as req
        r = req.get(f"{PROMETHEUS_URL}/api/v1/query",
                    params={"query": query}, timeout=5)
        res = r.json().get("data", {}).get("result", [])
        return float(res[0]["value"][1]) if res else 0.0
    except Exception:
        return 0.0


def scrape() -> dict:
    queries = {
        "request_rate":   'sum(rate(http_server_requests_seconds_count{{application="{s}-service"}}[2m]))',
        "error_rate_5xx": 'sum(rate(http_server_requests_seconds_count{{application="{s}-service",status=~"5.."}}[2m]))',
        "p99_latency_s":  'histogram_quantile(0.99,sum(rate(http_server_requests_seconds_bucket{{application="{s}-service"}}[2m]))by(le))',
        "p50_latency_s":  'histogram_quantile(0.50,sum(rate(http_server_requests_seconds_bucket{{application="{s}-service"}}[2m]))by(le))',
        "jvm_heap_mb":    'jvm_memory_used_bytes{{application="{s}-service",area="heap"}}/1048576',
        "active_threads": 'tomcat_threads_busy_threads{{application="{s}-service"}}',
        "service_up":     'up{{job="{s}-service"}}',
    }
    raw = {}
    for svc in SERVICES:
        for k, q in queries.items():
            raw[f"{svc}_{k}"] = _prom(q.format(s=svc))

    err_vals = [raw.get(f"{s}_error_rate_5xx", 0.0) for s in SERVICES]
    p99_vals = [raw.get(f"{s}_p99_latency_s",  0.0) for s in SERVICES]
    up_vals  = [raw.get(f"{s}_service_up",      1.0) for s in SERVICES]

    raw["system_mean_error_rate"]  = float(np.mean(err_vals))
    raw["system_max_error_rate"]   = float(max(err_vals))
    raw["system_max_p99_latency"]  = float(max(p99_vals))
    raw["system_mean_p99_latency"] = float(np.mean(p99_vals))
    raw["num_services_down"]       = int(sum(1 for v in up_vals if v == 0))
    return raw


# ── Analysis engines ──────────────────────────────────────────────────────────

def zscore_analysis(raw: dict) -> dict:
    svc_z = {}
    flagged = []
    max_z = 0.0
    threshold = 3.0
    for svc in SERVICES:
        z_map = {}
        for metric, base in BASELINE.items():
            val = float(raw.get(f"{svc}_{metric}", 0.0))
            up  = float(raw.get(f"{svc}_service_up", 1.0))
            z   = 10.0 if (up == 0 and metric == "error_rate_5xx") else (val - base["mean"]) / base["std"]
            z   = round(float(z), 3)
            z_map[metric] = {"val": round(val, 4), "z_score": z, "anomalous": bool(abs(z) > threshold)}
            if abs(z) > max_z:
                max_z = abs(z)
            if abs(z) > threshold:
                flagged.append({"service": svc, "metric": metric, "val": round(val, 4), "z_score": z})
        svc_z[svc] = z_map
    return {
        "services":      svc_z,
        "max_zscore":    round(max_z, 3),
        "threshold":     threshold,
        "flagged_count": len(flagged),
        "anomalies":     flagged,
    }


def temporal_analysis(raw: dict) -> dict:
    now = time.time()
    HISTORY.append({"t": now, "raw": raw})
    if len(HISTORY) < 2:
        return {
            "delta_error_rate":    0.0,
            "delta_latency":       0.0,
            "rolling_3_mean_error": round(raw.get("system_mean_error_rate", 0), 4),
            "rolling_3_std_error":  0.0,
            "acceleration_error":   0.0,
            "propagation_onset":    [],
            "history_length":       1,
        }
    curr = HISTORY[-1]["raw"]
    prev = HISTORY[-2]["raw"]
    dt   = max(1.0, now - HISTORY[-2]["t"])

    d_err = (curr.get("system_mean_error_rate", 0) - prev.get("system_mean_error_rate", 0)) / dt
    d_lat = (curr.get("system_max_p99_latency", 0) - prev.get("system_max_p99_latency", 0)) / dt

    recent = [h["raw"].get("system_mean_error_rate", 0) for h in list(HISTORY)[-3:]]
    roll_mean = float(np.mean(recent))
    roll_std  = float(np.std(recent))

    accel = 0.0
    if len(HISTORY) >= 3:
        dt2 = max(1.0, HISTORY[-2]["t"] - HISTORY[-3]["t"])
        d_err2 = (prev.get("system_mean_error_rate", 0) - HISTORY[-3]["raw"].get("system_mean_error_rate", 0)) / dt2
        accel  = (d_err - d_err2) / dt

    onset = []
    seen  = set()
    for h in HISTORY:
        for svc in SERVICES:
            if svc in seen:
                continue
            if (h["raw"].get(f"{svc}_service_up", 1) == 0
                    or h["raw"].get(f"{svc}_error_rate_5xx", 0) > 0.05
                    or h["raw"].get(f"{svc}_p99_latency_s", 0) > 1.5):
                onset.append({"service": svc, "time": time.strftime("%H:%M:%S", time.localtime(h["t"]))})
                seen.add(svc)

    return {
        "delta_error_rate":    round(float(d_err), 4),
        "delta_latency":       round(float(d_lat), 4),
        "rolling_3_mean_error": round(roll_mean, 4),
        "rolling_3_std_error":  round(roll_std, 4),
        "acceleration_error":   round(float(accel), 4),
        "propagation_onset":    onset,
        "history_length":       len(HISTORY),
    }


def dependency_graph(raw: dict, root_causes: list) -> dict:
    G = nx.DiGraph()
    root_set = {c["service"] for c in root_causes}

    for svc in SERVICES:
        err = float(raw.get(f"{svc}_error_rate_5xx", 0))
        p99 = float(raw.get(f"{svc}_p99_latency_s",  0))
        up  = float(raw.get(f"{svc}_service_up",      1))
        if svc in root_set or up == 0:
            status = "ROOT_CAUSE"
        elif err > 0.05 or p99 > 1.5:
            status = "ANOMALOUS"
        else:
            status = "NORMAL"
        G.add_node(svc, label=SERVICE_LABELS.get(svc, svc), status=status, err=err, p99=p99)

    for src, dst in ARCH_EDGES:
        G.add_edge(src, dst, type="architectural", weight=1.0)

    try:
        pr = nx.pagerank(G, weight="weight")
    except Exception:
        pr = {s: round(1.0 / len(SERVICES), 4) for s in SERVICES}

    try:
        bc = nx.betweenness_centrality(G, weight="weight")
    except Exception:
        bc = {s: 0.0 for s in SERVICES}

    nodes = []
    for n, d in G.nodes(data=True):
        nodes.append({
            "id":         n,
            "label":      d.get("label", n),
            "status":     d.get("status", "NORMAL"),
            "in_degree":  int(G.in_degree(n)),
            "out_degree": int(G.out_degree(n)),
            "pagerank":   round(float(pr.get(n, 0)), 4),
            "betweenness": round(float(bc.get(n, 0)), 4),
            "error_rate": round(float(d.get("err", 0)), 4),
            "p99_latency": round(float(d.get("p99", 0)), 4),
        })

    edges = []
    for u, v, d in G.edges(data=True):
        edges.append({"source": u, "target": v, "type": d.get("type", "architectural"), "weight": float(d.get("weight", 1.0))})

    # BFS cascade path from root causes
    cascade_path = []
    for c in root_causes:
        svc = c["service"]
        if svc not in cascade_path:
            cascade_path.append(svc)
        if svc in G:
            for _, succs in nx.bfs_successors(G, svc):
                for s in succs:
                    if s not in cascade_path:
                        cascade_path.append(s)

    return {
        "graph_data":   {"nodes": nodes, "edges": edges, "node_count": len(nodes), "edge_count": len(edges)},
        "cascade_path": cascade_path,
    }


def feature_importances() -> list:
    if _model is None or _features is None:
        return [
            {"feature": "payment_error_rate_5xx",   "importance": 0.182},
            {"feature": "inventory_error_rate_5xx", "importance": 0.154},
            {"feature": "order_p99_latency_s",      "importance": 0.128},
            {"feature": "shipping_error_rate_5xx",  "importance": 0.110},
            {"feature": "system_max_error_rate",    "importance": 0.095},
        ]
    imps = _model.feature_importances_
    top  = np.argsort(imps)[::-1][:10]
    return [{"feature": _features[i], "importance": round(float(imps[i]), 4)} for i in top]


def root_cause(raw: dict) -> list:
    causes = []
    for svc in SERVICES:
        err = float(raw.get(f"{svc}_error_rate_5xx", 0))
        p99 = float(raw.get(f"{svc}_p99_latency_s",  0))
        up  = float(raw.get(f"{svc}_service_up",      1))
        if up == 0:
            causes.append({"service": svc, "reason": "SERVICE_DOWN",    "metric": "service_up",     "value": 0})
        elif err > 0.01:
            causes.append({"service": svc, "reason": "HIGH_ERROR_RATE", "metric": "error_rate_5xx", "value": round(err, 4)})
        elif p99 > 1.5:
            causes.append({"service": svc, "reason": "HIGH_LATENCY",    "metric": "p99_latency_s",  "value": round(p99, 4)})
    causes.sort(key=lambda x: (x["reason"] == "SERVICE_DOWN", x.get("value", 0)), reverse=True)
    return causes[:3]


def recommendations(causes: list, risk_level: str) -> list:
    recs = []
    for c in causes:
        svc   = c["service"]
        label = SERVICE_LABELS.get(svc, svc)
        if c["reason"] == "SERVICE_DOWN":
            recs.append(f"Restart {label} — returning HTTP 503. Run: docker restart {svc}-service")
            recs.append(f"Check logs: docker logs {svc}-service --tail 50")
        elif c["reason"] == "HIGH_ERROR_RATE":
            recs.append(f"{label} error rate is {c['value']:.3f} req/s — check DB connectivity.")
        elif c["reason"] == "HIGH_LATENCY":
            recs.append(f"{label} P99 latency is {c['value']:.2f}s — add DB query indexes.")
    if risk_level in ("HIGH", "CRITICAL"):
        recs.append("Consider activating circuit breakers on upstream callers.")
    if not recs:
        recs.append("All services operating within normal thresholds.")
    return recs


def rule_based_risk(raw: dict) -> tuple:
    """Returns (risk_level, cascade_risk) using simple rules when model not trained."""
    n_down   = int(raw.get("num_services_down", 0))
    err_rate = float(raw.get("system_mean_error_rate", 0))
    max_err  = float(raw.get("system_max_error_rate", 0))
    p99      = float(raw.get("system_max_p99_latency", 0))
    if n_down >= 2 or max_err > 0.3:
        return "CRITICAL", 0.90
    if n_down == 1 or max_err > 0.05 or err_rate > 0.05:
        return "HIGH", 0.75
    if max_err > 0.01 or p99 > 1.5:
        return "MEDIUM", 0.45
    return "LOW", 0.05


def full_pipeline(raw: dict) -> dict:
    """Run all analysis engines and return combined result dict."""
    causes  = root_cause(raw)
    z       = zscore_analysis(raw)
    t       = temporal_analysis(raw)
    nx_data = dependency_graph(raw, causes)
    fi      = feature_importances()

    if _model is not None and _scaler is not None and _features is not None:
        try:
            vec   = np.array([float(raw.get(f, 0)) for f in _features]).reshape(1, -1)
            vec   = _scaler.transform(vec)
            pred  = int(_model.predict(vec)[0])
            proba = _model.predict_proba(vec)[0]
            cr    = round(float(proba[1]) if len(proba) > 1 else float(proba[0]), 4)
            if cr >= 0.8:   rl = "CRITICAL"
            elif cr >= 0.6: rl = "HIGH"
            elif cr >= 0.4: rl = "MEDIUM"
            else:           rl = "LOW"
            prediction = "CASCADE_FAILURE" if pred == 1 else "NORMAL"
            confidence = round(float(max(proba)), 4)
            model_note = "Random Forest Classifier"
        except Exception as e:
            rl, cr = rule_based_risk(raw)
            prediction = "CASCADE_FAILURE" if cr > 0.5 else "NORMAL"
            confidence = 0.75
            model_note = f"Rule-based fallback (model error: {e})"
    else:
        rl, cr = rule_based_risk(raw)
        prediction = "CASCADE_FAILURE" if cr > 0.5 else "NORMAL"
        confidence = 0.75
        model_note = "Rule-based assessment (model not trained yet)"

    recs = recommendations(causes, rl)

    return {
        "prediction":          prediction,
        "cascade_risk":        cr,
        "risk_level":          rl,
        "confidence":          confidence,
        "model_note":          model_note,
        "root_cause":          causes,
        "cascade_path":        nx_data["cascade_path"],
        "recommendations":     recs,
        "z_score_analysis":    z,
        "temporal_analysis":   t,
        "networkx_graph":      nx_data["graph_data"],
        "feature_importances": fi,
        "live_metrics": {
            svc: {
                "error_rate_5xx": round(float(raw.get(f"{svc}_error_rate_5xx", 0)), 4),
                "p99_latency_s":  round(float(raw.get(f"{svc}_p99_latency_s",  0)), 4),
                "service_up":     int(raw.get(f"{svc}_service_up", 1)),
                "request_rate":   round(float(raw.get(f"{svc}_request_rate",   0)), 4),
            }
            for svc in SERVICES
        },
        "system": {
            "mean_error_rate":   round(float(raw.get("system_mean_error_rate",  0)), 4),
            "max_p99_latency":   round(float(raw.get("system_max_p99_latency",  0)), 4),
            "num_services_down": int(raw.get("num_services_down", 0)),
        },
    }


# ── Routes ────────────────────────────────────────────────────────────────────

@app.route("/health")
def health():
    return jsonify({"status": "UP", "model_loaded": _model is not None})


@app.route("/metrics/live")
def metrics_live():
    try:
        raw    = scrape()
        result = full_pipeline(raw)
        return jsonify(result)
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


@app.route("/predict", methods=["POST"])
def predict():
    try:
        raw    = request.get_json(force=True) or {}
        result = full_pipeline(raw)
        return jsonify(result)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/model/info")
def model_info():
    if _model is None:
        return jsonify({"model_loaded": False, "note": "Run ml/train.py to train the model"})
    return jsonify({
        "model_loaded":  True,
        "type":          "RandomForestClassifier",
        "n_estimators":  int(_model.n_estimators),
        "n_features":    len(_features),
        "classes":       [int(c) for c in _model.classes_],
    })


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=5001)
    parser.add_argument("--host", default="0.0.0.0")
    args = parser.parse_args()

    _load_model()

    print(f"\nPrediction API running on http://{args.host}:{args.port}")
    print("  GET  /health")
    print("  GET  /metrics/live   <-- Developer Dashboard polls this")
    print("  POST /predict")
    print("  GET  /model/info\n")

    app.run(host=args.host, port=args.port, debug=False)
