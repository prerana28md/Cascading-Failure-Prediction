"""
Cascading Failure Prediction — REST API
Serves live Prometheus metrics analysis + ML prediction to the Developer Dashboard.

Endpoints:
  GET  /health            — liveness check
  GET  /metrics/live      — scrape Prometheus + full analysis + prediction
  GET  /model/info        — model metadata
  POST /predict           — predict from posted metric JSON
  GET  /observability     — Grafana / Prometheus / Jaeger connectivity status
"""

import json
import os
import time
import warnings
from collections import deque

warnings.filterwarnings("ignore")
from datetime import datetime, timezone

import networkx as nx
FAULT_EVENT_LOG_PATH = os.getenv(
    "FAULT_EVENT_LOG_PATH",
    os.path.join(os.path.dirname(__file__), "fault_event_log.json"),
)

CRITICALITY_CONFIG = {
    "severity_weight": float(os.getenv("CRITICALITY_SEVERITY_WEIGHT", "0.30")),
    "frequency_weight": float(os.getenv("CRITICALITY_FREQUENCY_WEIGHT", "0.15")),
    "duration_weight": float(os.getenv("CRITICALITY_DURATION_WEIGHT", "0.15")),
    "impact_weight": float(os.getenv("CRITICALITY_IMPACT_WEIGHT", "0.20")),
    "recurrence_weight": float(os.getenv("CRITICALITY_RECURRENCE_WEIGHT", "0.10")),
    "dependency_weight": float(os.getenv("CRITICALITY_DEPENDENCY_WEIGHT", "0.10")),
    "min_percentage": 5.0,
    "critical_threshold": 75.0,
    "high_threshold": 50.0,
    "moderate_threshold": 25.0,
    "low_threshold": 10.0,
}
import numpy as np
import joblib
from flask import Flask, jsonify, request
FAULT_EVENTS   = deque(maxlen=500)  # synchronized fault lifecycle events
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

# ── Config ────────────────────────────────────────────────────────────────────
PROMETHEUS_URL = os.getenv("PROMETHEUS_URL", "http://localhost:9090")
GRAFANA_URL    = os.getenv("GRAFANA_URL",    "http://localhost:3001")
JAEGER_URL     = os.getenv("JAEGER_URL",     "http://localhost:16686")
MODEL_DIR      = os.getenv("MODEL_DIR", os.path.join(os.path.dirname(__file__), "model"))

SERVICES = ["order", "payment", "inventory", "shipping", "delivery", "notification"]

# Direct service ports — used for fault-aware health probing
# The ML API bypasses the gateway and hits each service directly so it can
# detect DOWN/ERROR/LATENCY faults that Prometheus's scrape target doesn't expose.
SERVICE_PORTS = {
    "order":        8081,
    "payment":      8082,
    "inventory":    8083,
    "shipping":     8084,
    "delivery":     8085,
    "notification": 8086,
}

SERVICE_LABELS = {
    "order":        "Order Service",
    "payment":      "Payment Service",
    "inventory":    "Inventory Service",
    "shipping":     "Shipping Service",
    "delivery":     "Delivery Service",
    "notification": "Notification Service",
}

# Architectural dependency edges
ARCH_EDGES = [
    ("order", "inventory"), ("order", "payment"),
    ("order", "shipping"),  ("order", "notification"),
    ("shipping", "delivery"), ("shipping", "notification"),
    ("payment", "notification"),
]

# Healthy baselines for Z-score computation
BASELINE = {
    "error_rate_5xx": {"mean": 0.0,  "std": 0.01},
    "p99_latency_s":  {"mean": 0.05, "std": 0.08},
    "request_rate":   {"mean": 1.0,  "std": 0.50},
    "active_threads": {"mean": 2.0,  "std": 1.50},
}

# SLA targets per service (uptime %, max p99 latency, max error rate)
SLA_TARGETS = {
    "order":        {"uptime_pct": 99.9, "max_p99_s": 0.5,  "max_error_rate": 0.01},
    "payment":      {"uptime_pct": 99.9, "max_p99_s": 0.8,  "max_error_rate": 0.005},
    "inventory":    {"uptime_pct": 99.5, "max_p99_s": 0.3,  "max_error_rate": 0.01},
    "shipping":     {"uptime_pct": 99.5, "max_p99_s": 1.0,  "max_error_rate": 0.02},
    "delivery":     {"uptime_pct": 99.0, "max_p99_s": 1.0,  "max_error_rate": 0.02},
    "notification": {"uptime_pct": 99.0, "max_p99_s": 0.5,  "max_error_rate": 0.02},
}

HISTORY        = deque(maxlen=30)   # keep 30 polls (~4 min at 8s interval)
INCIDENT_LOG   = deque(maxlen=200)  # rolling incident feed (persisted to disk)

# Path to persist incident log across restarts
INCIDENT_LOG_PATH = os.path.join(os.path.dirname(__file__), "incident_log.json")

# Track last recommendation fingerprint per service to suppress duplicates
_last_rec_fingerprint: dict = {}   # service -> (reason, category) last seen


def _load_incident_log():
    """Load persisted incident log from disk on startup."""
    global INCIDENT_LOG
    if os.path.exists(INCIDENT_LOG_PATH):
        try:
            with open(INCIDENT_LOG_PATH, "r") as f:
                saved = json.load(f)
            for entry in saved[-200:]:
                INCIDENT_LOG.append(entry)
            print(f"[INFO] Loaded {len(INCIDENT_LOG)} incidents from disk")
        except Exception as e:
            print(f"[WARN] Could not load incident log: {e}")


def _save_incident_log():
    """Persist incident log to disk."""
    try:
        with open(INCIDENT_LOG_PATH, "w") as f:
            json.dump(list(INCIDENT_LOG), f, indent=2)
    except Exception as e:
        print(f"[WARN] Could not save incident log: {e}")


def _load_fault_events():
    if not os.path.exists(FAULT_EVENT_LOG_PATH):
        return
    try:
        with open(FAULT_EVENT_LOG_PATH, "r") as f:
            for event in json.load(f)[-500:]:
                FAULT_EVENTS.append(event)
        print(f"[INFO] Loaded {len(FAULT_EVENTS)} fault events from disk")
    except Exception as e:
        print(f"[WARN] Could not load fault events: {e}")


def _save_fault_events():
    temp_path = f"{FAULT_EVENT_LOG_PATH}.tmp"
    try:
        with open(temp_path, "w") as f:
            json.dump(list(FAULT_EVENTS), f, indent=2)
        os.replace(temp_path, FAULT_EVENT_LOG_PATH)
    except Exception as e:
        print(f"[WARN] Could not save fault events: {e}")


def _utc_now():
    return datetime.now(timezone.utc)


def _parse_timestamp(value):
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return _utc_now()


_load_fault_events()

# ── Model (Random Forest Classifier on 71 Prometheus features) ────────────────
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


def predict_cascade(raw: dict) -> dict:
    """
    Feeds the 71 Prometheus-engineered features into the trained RandomForestClassifier.
    Returns prediction ("CASCADE_FAILURE" or "NORMAL"), cascade_risk (float 0.0 - 1.0),
    confidence (float), and risk_level ("LOW", "MEDIUM", "HIGH", "CRITICAL").
    """
    if _model is None or _scaler is None or _features is None:
        rl, cr = rule_based_risk(raw)
        return {
            "prediction": "CASCADE_FAILURE" if cr >= 0.5 else "NORMAL",
            "cascade_risk": cr,
            "confidence": round(max(cr, 1.0 - cr), 4),
            "risk_level": rl,
            "model_note": "Rule-based fallback (model not loaded)",
        }

    # Construct feature vector in exact order of _features
    vector = [float(raw.get(f, 0.0)) for f in _features]
    vector = [0.0 if (np.isnan(v) or np.isinf(v)) else v for v in vector]

    import pandas as pd
    X = pd.DataFrame([vector], columns=_features)
    X_scaled = _scaler.transform(X)
    proba = _model.predict_proba(X_scaled)[0]

    # Model classes are [0, 1]
    if len(_model.classes_) == 2:
        c1_idx = list(_model.classes_).index(1) if 1 in _model.classes_ else 1
        cascade_risk = round(float(proba[c1_idx]), 4)
        confidence = round(float(max(proba)), 4)
    else:
        pred = int(_model.predict(X_scaled)[0])
        cascade_risk = 1.0 if pred == 1 else 0.0
        confidence = 1.0

    system_max_err = float(raw.get("system_max_error_rate", max([raw.get(f"{s}_error_rate_5xx", 0.0) for s in SERVICES])))
    system_mean_err = float(raw.get("system_mean_error_rate", 0.0))
    down_count = int(raw.get("num_services_down", 0))

    # A single-digit error rate (<= 8%) with 0 services down is an isolated transient fluctuation, NOT a cascade failure
    prediction = "CASCADE_FAILURE" if (cascade_risk >= 0.5 and (system_max_err >= 0.08 or down_count >= 1)) else "NORMAL"

    # Percentage-scaled risk levels:
    # 0.0% - 8.0% error rate  => LOW (transient fluctuation / minor jitter)
    # 8.0% - 20.0% error rate => MEDIUM (elevated errors requiring monitoring)
    # 20.0% - 35.0% error rate => HIGH (major degradation impacting users)
    # > 35.0% error rate or >= 2 services down => CRITICAL (widespread cascade outage)
    if down_count >= 2 or system_mean_err >= 0.35 or (cascade_risk >= 0.80 and system_max_err >= 0.30):
        risk_level = "CRITICAL"
    elif down_count >= 1 or system_max_err >= 0.20 or (cascade_risk >= 0.65 and system_max_err >= 0.15):
        risk_level = "HIGH"
    elif (cascade_risk >= 0.50 and system_max_err >= 0.08) or system_max_err >= 0.08:
        risk_level = "MEDIUM"
    else:
        risk_level = "LOW"

    return {
        "prediction": prediction,
        "cascade_risk": cascade_risk,
        "confidence": confidence,
        "risk_level": risk_level,
        "model_note": "RandomForestClassifier (71 Prometheus features)",
    }


# Initialize model and incident log eagerly
_load_model()
_load_incident_log()


# ── Observability connectivity probes ─────────────────────────────────────────
def _probe(url: str, path: str = "", timeout: float = 1.5) -> dict:
    """Probe a URL and return status dict."""
    import requests as req
    target = url.rstrip("/") + (path or "")
    try:
        r = req.get(target, timeout=timeout)
        return {"connected": r.status_code < 500, "status_code": r.status_code, "latency_ms": round(r.elapsed.total_seconds() * 1000, 1)}
    except Exception as e:
        return {"connected": False, "status_code": None, "latency_ms": None, "error": str(e)[:80]}


def observability_status() -> dict:
    prom   = _probe(PROMETHEUS_URL, "/-/healthy")
    graf   = _probe(GRAFANA_URL,    "/api/health")
    jaeger = _probe(JAEGER_URL,     "/")
    return {
        "prometheus": {**prom,   "url": PROMETHEUS_URL},
        "grafana":    {**graf,   "url": GRAFANA_URL},
        "jaeger":     {**jaeger, "url": JAEGER_URL},
        "all_connected": prom["connected"] and graf["connected"] and jaeger["connected"],
    }


def _is_prometheus_up() -> bool:
    try:
        import requests as req
        r = req.get(f"{PROMETHEUS_URL}/api/v1/query?query=up", timeout=1.0)
        return r.status_code == 200
    except Exception:
        return False


# ── Direct fault-aware service probe ─────────────────────────────────────────
# Probe the API Gateway fault status to track active injection metadata.
# Real traffic and actuator metrics in Prometheus reflect the actual fault impacts.
def _probe_service_faults() -> dict:
    """
    Queries fault status via gateway GET /fault/status or individual /fault/{svc}-service/status.
    Returns { svc: {"fault": "NONE"|"LATENCY"|"ERROR"|"DOWN", "delayMs": int} }
    """
    import requests as req
    gateway = os.getenv("GATEWAY_URL", "http://localhost:8080")
    result  = {}
    try:
        r = req.get(f"{gateway}/fault/status", timeout=1.5)
        if r.status_code == 200:
            data = r.json()
            s_map = {}
            if isinstance(data.get("services"), list):
                for item in data.get("services"):
                    raw = str(item.get("service") or item.get("name") or "")
                    s_map[raw] = item
                    s_map[raw.replace("-service", "")] = item
            for k, v in data.items():
                if k != "services" and isinstance(v, dict):
                    s_map[k] = v
                    s_map[k.replace("-service", "")] = v

            for svc in SERVICES:
                svc_data = s_map.get(svc) or s_map.get(f"{svc}-service") or {}
                result[svc] = {
                    "fault":   str(svc_data.get("fault", svc_data.get("faultType", "NONE"))).upper(),
                    "delayMs": int(svc_data.get("delayMs", svc_data.get("delay_ms", 0)) or 0),
                }
            return result
    except Exception:
        pass

    for svc in SERVICES:
        try:
            r = req.get(f"{gateway}/fault/{svc}-service/status", timeout=1.0)
            if r.status_code == 200:
                data = r.json()
                result[svc] = {
                    "fault":   str(data.get("fault", data.get("faultType", "NONE"))).upper(),
                    "delayMs": int(data.get("delayMs", data.get("delay_ms", 0)) or 0),
                }
            else:
                result[svc] = {"fault": "NONE", "delayMs": 0}
        except Exception:
            result[svc] = {"fault": "NONE", "delayMs": 0}
    return result


# ── Prometheus scraper ────────────────────────────────────────────────────────
def _prom(query):
    try:
        import requests as req
        import math
        r = req.get(f"{PROMETHEUS_URL}/api/v1/query",
                    params={"query": query}, timeout=1.5)
        if r.status_code == 200:
            res = r.json().get("data", {}).get("result", [])
            if res and len(res) > 0:
                val = float(res[0]["value"][1])
                return 0.0 if (math.isnan(val) or math.isinf(val)) else val
        return 0.0
    except Exception:
        return 0.0


def scrape() -> dict:
    # 1m window rates and histogram quantiles for real-time responsiveness
    queries = {
        "request_rate":   'sum(rate(http_server_requests_seconds_count{{application="{s}-service"}}[1m]))',
        "error_rate_5xx": 'sum(rate(http_server_requests_seconds_count{{application="{s}-service",status=~"5.."}}[1m]))',
        "error_rate_4xx": 'sum(rate(http_server_requests_seconds_count{{application="{s}-service",status=~"4.."}}[1m]))',
        "p99_latency_s":  'histogram_quantile(0.99,sum(rate(http_server_requests_seconds_bucket{{application="{s}-service"}}[1m]))by(le))',
        "p95_latency_s":  'histogram_quantile(0.95,sum(rate(http_server_requests_seconds_bucket{{application="{s}-service"}}[1m]))by(le))',
        "p50_latency_s":  'histogram_quantile(0.50,sum(rate(http_server_requests_seconds_bucket{{application="{s}-service"}}[1m]))by(le))',
        "jvm_heap_mb":    'jvm_memory_used_bytes{{application="{s}-service",area="heap"}}/1048576',
        "active_threads": 'tomcat_threads_busy_threads{{application="{s}-service"}}',
        "service_up":     'up{{job="{s}-service"}}',
    }
    raw = {}
    prom_up = _is_prometheus_up()

    if not prom_up:
        # Prometheus unreachable — mark all services up with zero metrics
        for svc in SERVICES:
            for k in queries:
                raw[f"{svc}_{k}"] = 1.0 if k == "service_up" else 0.0
    else:
        for svc in SERVICES:
            for k, q in queries.items():
                raw[f"{svc}_{k}"] = _prom(q.format(s=svc))

    # ── Fault-aware metadata & controlled DOWN detection ──────────────────────
    # Real metrics come directly from Prometheus above.
    # We record fault metadata, and if a service is in controlled DOWN state (503),
    # we reflect service_up = 0.0.
    try:
        fault_states = _probe_service_faults()
        for svc, fs in fault_states.items():
            fault = fs.get("fault", "NONE")
            delay = fs.get("delayMs", 0)
            raw[f"{svc}_fault"] = fault
            raw[f"{svc}_fault_delay_ms"] = delay

            if fault == "DOWN":
                raw[f"{svc}_service_up"] = 0.0

    except Exception as e:
        print(f"[WARN] Fault-aware probe failed: {e}")

    # Ensure defaults and compute per-service derived features for the 71-feature model
    for svc in SERVICES:
        raw.setdefault(f"{svc}_fault", "NONE")
        raw.setdefault(f"{svc}_fault_delay_ms", 0)
        req_rate = float(raw.get(f"{svc}_request_rate", 0.0))
        err_5xx  = float(raw.get(f"{svc}_error_rate_5xx", 0.0))
        p99      = float(raw.get(f"{svc}_p99_latency_s", 0.0))
        p50      = float(raw.get(f"{svc}_p50_latency_s", 0.0))
        raw[f"{svc}_error_ratio"]   = float(err_5xx / (req_rate + 1e-9))
        raw[f"{svc}_latency_spike"] = float(p99 / (p50 + 1e-9))

    # ── System-level aggregates ────────────────────────────────────────────────
    err_vals = [raw.get(f"{s}_error_rate_5xx", 0.0) for s in SERVICES]
    p99_vals = [raw.get(f"{s}_p99_latency_s",  0.0) for s in SERVICES]
    up_vals  = [raw.get(f"{s}_service_up",      1.0) for s in SERVICES]

    raw["system_mean_error_rate"]  = float(np.mean(err_vals))
    raw["system_max_error_rate"]   = float(max(err_vals))
    raw["system_max_p99_latency"]  = float(max(p99_vals))
    raw["system_mean_p99_latency"] = float(np.mean(p99_vals))
    raw["num_services_down"]       = int(sum(1 for v in up_vals if v == 0))
    raw["prometheus_connected"]    = prom_up
    return raw


# ── Analysis engines ──────────────────────────────────────────────────────────

def zscore_analysis(raw: dict) -> dict:
    svc_z    = {}
    flagged  = []
    max_z    = 0.0
    threshold = 3.0
    for svc in SERVICES:
        z_map = {}
        for metric, base in BASELINE.items():
            val = float(raw.get(f"{svc}_{metric}", 0.0))
            up  = float(raw.get(f"{svc}_service_up", 1.0))
            z   = 10.0 if (up == 0 and metric == "error_rate_5xx") else (val - base["mean"]) / base["std"]
            z   = round(float(z), 3)
            z_map[metric] = {
                "val":      round(val, 4),
                "z_score":  z,
                "anomalous": bool(abs(z) > threshold),
                "pct_of_baseline": round((val / max(base["mean"], 0.0001)) * 100, 1) if base["mean"] > 0 else None,
            }
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
            "delta_error_rate":     0.0,
            "delta_latency":        0.0,
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

    recent    = [h["raw"].get("system_mean_error_rate", 0) for h in list(HISTORY)[-3:]]
    roll_mean = float(np.mean(recent))
    roll_std  = float(np.std(recent))

    accel = 0.0
    if len(HISTORY) >= 3:
        dt2    = max(1.0, HISTORY[-2]["t"] - HISTORY[-3]["t"])
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
        "delta_error_rate":     round(float(d_err), 4),
        "delta_latency":        round(float(d_lat), 4),
        "rolling_3_mean_error": round(roll_mean, 4),
        "rolling_3_std_error":  round(roll_std, 4),
        "acceleration_error":   round(float(accel), 4),
        "propagation_onset":    onset,
        "history_length":       len(HISTORY),
    }


def sla_compliance(raw: dict) -> dict:
    """Compute SLA compliance status for each service."""
    results = {}
    overall_breaches = 0
    for svc in SERVICES:
        targets = SLA_TARGETS[svc]
        up      = float(raw.get(f"{svc}_service_up",      1.0))
        err     = float(raw.get(f"{svc}_error_rate_5xx",  0.0))
        p99     = float(raw.get(f"{svc}_p99_latency_s",   0.0))
        req_rt  = float(raw.get(f"{svc}_request_rate",    0.0))

        # Uptime % — instant window (1 = 100%, 0 = 0%)
        uptime_pct    = 100.0 if up == 1 else 0.0
        # Error budget: what % of allowed budget is consumed
        max_err       = targets["max_error_rate"]
        err_budget_pct = min(100.0, round((err / max(max_err, 1e-6)) * 100, 1))
        # Latency budget consumption
        max_p99        = targets["max_p99_s"]
        lat_budget_pct = min(100.0, round((p99 / max(max_p99, 1e-6)) * 100, 1))

        breaches = []
        if up == 0:
            breaches.append({"type": "DOWNTIME",      "message": f"{SERVICE_LABELS[svc]} is DOWN (SLA target: {targets['uptime_pct']}% uptime)"})
        if err > max_err and req_rt > 0:
            breaches.append({"type": "ERROR_BUDGET",  "message": f"Error rate {err:.4f}/s exceeds SLA limit of {max_err}/s ({err_budget_pct}% budget consumed)"})
        if p99 > max_p99:
            breaches.append({"type": "LATENCY_BUDGET","message": f"P99 latency {p99:.3f}s exceeds SLA limit of {max_p99}s ({lat_budget_pct}% budget consumed)"})

        overall_breaches += len(breaches)
        results[svc] = {
            "uptime_pct":       uptime_pct,
            "error_budget_pct": err_budget_pct,
            "latency_budget_pct": lat_budget_pct,
            "sla_compliant":    len(breaches) == 0,
            "breach_count":     len(breaches),
            "breaches":         breaches,
            "targets":          targets,
        }

    return {"services": results, "total_breaches": overall_breaches, "compliant_count": sum(1 for v in results.values() if v["sla_compliant"])}


def dependency_graph(raw: dict, root_causes: list) -> dict:
    G        = nx.DiGraph()
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
        G.add_node(svc, label=SERVICE_LABELS.get(svc, svc), status=status, err=err, p99=p99, up=up)

    for src, dst in ARCH_EDGES:
        G.add_edge(src, dst, type="architectural", weight=1.0, correlation=0.85)

    for i, s1 in enumerate(SERVICES):
        for s2 in SERVICES[i+1:]:
            err1  = float(raw.get(f"{s1}_error_rate_5xx", 0))
            err2  = float(raw.get(f"{s2}_error_rate_5xx", 0))
            p99_1 = float(raw.get(f"{s1}_p99_latency_s",  0))
            p99_2 = float(raw.get(f"{s2}_p99_latency_s",  0))
            up1   = float(raw.get(f"{s1}_service_up", 1))
            up2   = float(raw.get(f"{s2}_service_up", 1))
            if err1 > 0 or err2 > 0 or p99_1 > 0.5 or p99_2 > 0.5 or up1 == 0 or up2 == 0:
                diff = abs(err1 - err2) + abs(p99_1 - p99_2) / 5.0
                corr = max(0.45, min(0.98, round(1.0 - diff, 2)))
                if not G.has_edge(s1, s2):
                    G.add_edge(s1, s2, type="data_driven", weight=round(corr, 2), correlation=corr)

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
        status = d.get("status", "NORMAL")
        err    = d.get("err", 0)
        p99    = d.get("p99", 0)
        up     = d.get("up",  1)

        if status == "ROOT_CAUSE" or up == 0:
            effect_pct = 100.0
        elif n in cascade_path:
            base_effect = 85.0 if cascade_path.index(n) == 1 else 65.0
            add_err = min(15.0, (err / 0.1) * 15.0) if err > 0 else 0.0
            add_lat = min(15.0, (p99 / 2.0) * 15.0) if p99 > 0 else 0.0
            effect_pct = min(99.0, round(base_effect + add_err + add_lat, 1))
        elif err > 0.01 or p99 > 0.5:
            effect_pct = min(80.0, round((err / 0.1) * 50.0 + (p99 / 2.0) * 30.0 + 20.0, 1))
        else:
            effect_pct = 0.0

        nodes.append({
            "id":                 n,
            "label":              d.get("label", n),
            "status":             status,
            "in_degree":          int(G.in_degree(n)),
            "out_degree":         int(G.out_degree(n)),
            "pagerank":           round(float(pr.get(n, 0)), 4),
            "betweenness":        round(float(bc.get(n, 0)), 4),
            "error_rate":         round(float(err), 4),
            "p99_latency":        round(float(p99), 4),
            "cascade_effect_pct": effect_pct,
        })

    edges = []
    for u, v, d in G.edges(data=True):
        edges.append({
            "source":      u,
            "target":      v,
            "type":        d.get("type", "architectural"),
            "weight":      float(d.get("weight", 1.0)),
            "correlation": float(d.get("correlation", 0.85)),
        })

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
            {"feature": "order_error_rate_5xx",     "importance": 0.089},
            {"feature": "delivery_p99_latency_s",   "importance": 0.072},
            {"feature": "notification_service_up",  "importance": 0.058},
            {"feature": "system_mean_error_rate",   "importance": 0.053},
            {"feature": "shipping_p99_latency_s",   "importance": 0.049},
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
        fault = str(raw.get(f"{svc}_fault", "NONE")).upper()
        if up == 0 or fault == "DOWN":
            causes.append({"service": svc, "reason": "SERVICE_DOWN",    "metric": "service_up",     "value": 0})
        elif err > 0.08 or fault == "ERROR":
            causes.append({"service": svc, "reason": "HIGH_ERROR_RATE", "metric": "error_rate_5xx", "value": round(err, 4)})
        elif err > 0.01:
            causes.append({"service": svc, "reason": "ELEVATED_ERROR_RATE", "metric": "error_rate_5xx", "value": round(err, 4)})
        elif p99 > 0.8 or fault == "LATENCY":
            causes.append({"service": svc, "reason": "HIGH_LATENCY",    "metric": "p99_latency_s",  "value": round(p99, 4)})
    causes.sort(key=lambda x: (x["reason"] == "SERVICE_DOWN", x.get("value", 0)), reverse=True)
    return causes[:3]


def structured_recommendations(causes: list, raw: dict, risk_level: str, sla: dict) -> list:
    """
    Returns structured recommendation objects. Deduplicates: same recommendation
    is not repeated on consecutive polls while the same fault is still active.
    A '_repeat' flag is set so the frontend can dim/hide already-seen recs.
    """
    global _last_rec_fingerprint
    recs     = []
    priority = 1
    new_fps  = {}

    def _add(severity, category, service, title, description, command=None):
        nonlocal priority
        fp_key = (service, title[:50])
        new_fps[fp_key] = True
        rec = {
            "priority":    priority,
            "severity":    severity,
            "category":    category,
            "service":     service,
            "title":       title,
            "description": description,
            "command":     command,
            "_repeat":     bool(_last_rec_fingerprint.get(fp_key)),
        }
        recs.append(rec)
        priority += 1

    # ── Per root-cause recommendations ────────────────────────────────────────
    for c in causes:
        svc   = c["service"]
        label = SERVICE_LABELS.get(svc, svc)

        if c["reason"] == "SERVICE_DOWN":
            _add(
                "CRITICAL", "IMMEDIATE", svc,
                f"Restart {label} — returning HTTP 503",
                f"{label} is completely DOWN (service_up=0). All upstream callers are "
                f"accumulating errors. Immediate restart required.",
                f"docker restart {svc}-service",
            )
            _add(
                "CRITICAL", "IMMEDIATE", svc,
                f"Inspect {label} crash logs",
                f"Check recent logs for crash reason (OOM, DB timeout, port conflict). "
                f"Look for FATAL/ERROR lines in the last 100 lines.",
                f"docker logs {svc}-service --tail 100",
            )

        elif c["reason"] == "HIGH_ERROR_RATE":
            sla_max         = SLA_TARGETS[svc]["max_error_rate"]
            budget_consumed = round((c["value"] / max(sla_max, 1e-6)) * 100, 1)
            _add(
                "HIGH", "IMMEDIATE", svc,
                f"{label} error rate exceeds SLA threshold",
                f"Current error rate: {c['value']:.4f} req/s ({budget_consumed}% of SLA error "
                f"budget consumed). SLA limit: {sla_max} req/s. Check MongoDB Atlas connectivity "
                f"and review recent deployments for breaking changes.",
                f"docker logs {svc}-service --tail 50",
            )
            _add(
                "HIGH", "SHORT_TERM", svc,
                f"Add circuit breaker for {label}",
                f"Prevent cascading failures by wrapping {label} calls with a Resilience4j "
                f"circuit breaker. Open the circuit when error rate exceeds {sla_max * 100:.1f}% "
                f"to stop propagation to upstream services.",
                None,
            )

        elif c["reason"] == "HIGH_LATENCY":
            sla_max         = SLA_TARGETS[svc]["max_p99_s"]
            budget_consumed = round((c["value"] / max(sla_max, 1e-6)) * 100, 1)
            _add(
                "MEDIUM", "IMMEDIATE", svc,
                f"{label} P99 latency exceeds SLA budget",
                f"P99 latency: {c['value']:.3f}s — {budget_consumed}% of the {sla_max}s SLA "
                f"budget consumed. Primary causes: missing DB indexes, N+1 query patterns, or "
                f"JVM GC pressure. Check active thread count and MongoDB slow query logs.",
                f"docker exec {svc}-service jcmd 1 Thread.print",
            )

    # ── SLA breach recommendations (services not already in root causes) ──────
    cause_svcs   = {c["service"] for c in causes}
    sla_services = sla.get("services", {})
    for svc, sla_info in sla_services.items():
        if not sla_info["sla_compliant"] and svc not in cause_svcs:
            label = SERVICE_LABELS.get(svc, svc)
            for breach in sla_info["breaches"]:
                _add(
                    "MEDIUM", "SHORT_TERM", svc,
                    f"SLA breach: {label} — {breach['type'].replace('_', ' ').title()}",
                    breach["message"],
                    None,
                )

    # ── System-level recommendations for HIGH / CRITICAL ─────────────────────
    if risk_level in ("HIGH", "CRITICAL"):
        _add(
            "HIGH", "IMMEDIATE", "system",
            "Activate upstream circuit breakers across call chain",
            f"System risk is {risk_level}. Cascade propagation is in progress. Activate "
            f"Resilience4j circuit breakers on all services calling into failing services. "
            f"Call chain: Order → Inventory → Payment → Shipping → Delivery → Notification.",
            "curl -X POST http://localhost:8080/actuator/circuitbreakers/open",
        )

    if risk_level == "CRITICAL":
        _add(
            "CRITICAL", "IMMEDIATE", "system",
            "Initiate disaster recovery runbook",
            "CRITICAL cascade failure detected. Escalate to on-call engineer immediately. "
            "Consider enabling read-only mode on the frontend to prevent new orders until "
            "services stabilise. Check MongoDB Atlas cluster health dashboard.",
            None,
        )

    # ── Preventive recommendations when system is healthy ────────────────────
    if not causes:
        _add(
            "LOW", "PREVENTIVE", "system",
            "All services operating within normal thresholds",
            "No anomalies detected. Consider running a chaos experiment to validate resilience: "
            "inject a latency spike on inventory-service and observe propagation detection time.",
            "curl -X POST http://localhost:8080/fault/inventory-service/configure "
            "-H \"Content-Type: application/json\" -d '{\"fault\":\"LATENCY\",\"delayMs\":2000}'",
        )
        _add(
            "LOW", "PREVENTIVE", "system",
            "Review and tighten SLA targets",
            "System is healthy. Review current SLA targets against the last 7 days of Grafana "
            "dashboard data. Consider tightening P99 latency budgets for earlier warning detection.",
            None,
        )

    # Update fingerprint for next cycle
    _last_rec_fingerprint = new_fps
    return recs


def _append_incident(raw: dict, causes: list, risk_level: str):
    """Append anomalies to the rolling incident log. Deduplicates consecutive identical events.
    Auto-resolves services that were previously incident-active but now have no cause.
    Uses appendleft so index-0 is always the most recent entry.
    """
    now = time.localtime()
    ts  = time.strftime("%Y-%m-%d %H:%M:%S", now)
    day = time.strftime("%Y-%m-%d", now)

    cause_svcs = {c["service"] for c in causes}

    # ── Append new / changed incidents ────────────────────────────────────────
    for c in causes:
        svc    = c["service"]
        reason = c["reason"]

        # Find the most recent (index-0 first) entry for this service
        last_for_svc = next((e for e in INCIDENT_LOG if e["service"] == svc), None)

        # Skip if most recent entry for this service already has the same reason
        if last_for_svc and last_for_svc.get("reason") == reason:
            continue

        INCIDENT_LOG.appendleft({
            "ts":         ts,
            "date":       day,
            "service":    svc,
            "label":      SERVICE_LABELS.get(svc, svc),
            "reason":     reason,
            "value":      c.get("value"),
            "metric":     c.get("metric"),
            "risk_level": risk_level,
            "id":         int(time.time() * 1000),
        })

    # ── Auto-resolve ──────────────────────────────────────────────────────────
    # For every service that has a non-RESOLVED entry as its LATEST log entry,
    # but is NOT in the current cause set → append a RESOLVED entry.
    for svc in SERVICES:
        if svc in cause_svcs:
            continue   # still has an active cause — do not resolve

        # Find the most recent entry for this service
        last_for_svc = next((e for e in INCIDENT_LOG if e["service"] == svc), None)

        # Only resolve if the latest entry is an active (non-RESOLVED) incident
        if last_for_svc and last_for_svc.get("reason") not in (None, "RESOLVED"):
            INCIDENT_LOG.appendleft({
                "ts":         ts,
                "date":       day,
                "service":    svc,
                "label":      SERVICE_LABELS.get(svc, svc),
                "reason":     "RESOLVED",
                "value":      None,
                "metric":     None,
                "risk_level": "LOW",
                "id":         int(time.time() * 1000) + SERVICES.index(svc),
            })

    _save_incident_log()


def rule_based_risk(raw: dict) -> tuple:
    impact = impact_analysis(raw)
    risk = impact["affected_percentage"] / 100.0
    if risk >= 0.75:
        return "CRITICAL", round(risk, 4)
    if risk >= 0.40:
        return "HIGH", round(risk, 4)
    if risk >= 0.08:
        return "MEDIUM", round(risk, 4)
    return "LOW", round(risk, 4)


def impact_analysis(raw: dict) -> dict:
    """Calculate impact from the observed service state with graduated thresholds."""
    impacts = {}
    for svc in SERVICES:
        fault = str(raw.get(f"{svc}_fault", "NONE")).upper()
        up = float(raw.get(f"{svc}_service_up", 1.0))
        err = float(raw.get(f"{svc}_error_rate_5xx", 0.0))
        p99 = float(raw.get(f"{svc}_p99_latency_s", 0.0))
        delay = float(raw.get(f"{svc}_fault_delay_ms", 0.0)) / 1000.0
        target = SLA_TARGETS[svc]

        # Graduated error impact:
        # err <= max_error_rate: 0.0%
        # 0.01 < err <= 0.08 (up to 8%): 5% to 15% (minor transient jitter)
        # 0.08 < err <= 0.20 (8% to 20%): 15% to 40% (moderate degradation)
        # 0.20 < err <= 0.35 (20% to 35%): 40% to 70% (high degradation)
        # err > 0.35 (> 35%): 70% to 100% (critical failure)
        if err <= target["max_error_rate"]:
            error_impact = 0.0
        elif err <= 0.08:
            fraction = (err - target["max_error_rate"]) / max(0.08 - target["max_error_rate"], 0.001)
            error_impact = 5.0 + fraction * 10.0
        elif err <= 0.20:
            fraction = (err - 0.08) / 0.12
            error_impact = 15.0 + fraction * 25.0
        elif err <= 0.35:
            fraction = (err - 0.20) / 0.15
            error_impact = 40.0 + fraction * 30.0
        else:
            fraction = min(1.0, (err - 0.35) / 0.25)
            error_impact = 70.0 + fraction * 30.0

        # Graduated latency impact
        effective_delay = max(p99, delay)
        if effective_delay <= target["max_p99_s"] and delay <= 0:
            latency_impact = 0.0
        elif effective_delay <= 1.0:
            latency_impact = 10.0 + (effective_delay / 1.0) * 15.0
        elif effective_delay <= 3.0:
            latency_impact = 25.0 + ((effective_delay - 1.0) / 2.0) * 25.0
        else:
            latency_impact = min(90.0, 50.0 + ((effective_delay - 3.0) / 3.0) * 35.0)

        if fault == "DOWN" or up == 0:
            impact = 100.0
        elif fault == "ERROR":
            impact = max(50.0, error_impact)
        else:
            impact = max(latency_impact, error_impact)

        impacts[svc] = round(min(100.0, max(0.0, impact)), 1)

    affected = [value for value in impacts.values() if value > 0]
    return {
        "services": impacts,
        "affected_services": len(affected),
        "affected_percentage": round(float(np.mean(list(impacts.values()))), 1),
    }


def _severity_for_fault(fault: str, impact: float) -> str:
    if fault == "DOWN" or impact >= 75:
        return "CRITICAL"
    if fault == "ERROR" or impact >= 45:
        return "MAJOR"
    if fault == "LATENCY" or impact >= 20:
        return "MODERATE"
    return "MINOR"


def _active_fault_events():
    latest = {}
    for event in reversed(FAULT_EVENTS):
        service = event.get("service")
        if service and service not in latest:
            latest[service] = event
    return [event for event in latest.values() if event.get("status") in ("ACTIVE", "INJECTED")]


def criticality_analysis(raw: dict, impact: dict) -> dict:
    """Return a deterministic, explainable system criticality score."""
    active_events = _active_fault_events()
    active_services = {event.get("service") for event in active_events}
    current_faults = {
        svc: str(raw.get(f"{svc}_fault", "NONE")).upper()
        for svc in SERVICES
    }
    active_services.update(svc for svc, fault in current_faults.items() if fault != "NONE")

    if not active_services and impact["affected_percentage"] == 0:
        return {
            "percentage": CRITICALITY_CONFIG["min_percentage"],
            "severity": "INFORMATIONAL",
            "reasons": ["No active fault or threshold breach detected"],
            "components": {"severity": 0, "frequency": 0, "duration": 0, "impact": 0, "recurrence": 0, "dependency": 0},
        }

    severity_values = []
    frequency_values = []
    duration_values = []
    recurrence_values = []
    reasons = []
    now = _utc_now()
    recent_window = [
        event for event in FAULT_EVENTS
        if event.get("status") in ("ACTIVE", "INJECTED") and (now - _parse_timestamp(event.get("timestamp"))).total_seconds() <= 600
    ]

    for svc in active_services:
        fault = current_faults.get(svc, "NONE")
        service_impact = impact["services"].get(svc, 0.0)
        severity_values.append({"MINOR": 20, "MODERATE": 50, "MAJOR": 75, "CRITICAL": 100}[_severity_for_fault(fault, service_impact)])
        service_events = [event for event in recent_window if event.get("service") == svc]
        frequency_values.append(min(100.0, len(service_events) * 25.0))
        same_faults = [event for event in recent_window if event.get("service") == svc and event.get("fault") == fault]
        recurrence_values.append(min(100.0, max(0, len(same_faults) - 1) * 35.0))

        latest = next((event for event in active_events if event.get("service") == svc), None)
        if latest:
            duration_s = max(0.0, (now - _parse_timestamp(latest.get("timestamp"))).total_seconds())
            duration_values.append(min(100.0, duration_s / 300.0 * 100.0))
            if duration_s >= 60:
                reasons.append(f"{svc} fault has remained active for {round(duration_s / 60, 1)} minutes")
        else:
            duration_values.append(0.0)

        if service_impact > 0:
            reasons.append(f"{svc} impact is {service_impact:.1f}% from its observed fault and metrics")

    affected = set(svc for svc, value in impact["services"].items() if value > 0)
    dependency_targets = {dst for src, dst in ARCH_EDGES if src in active_services}
    dependency_score = min(100.0, (len(affected & dependency_targets) / max(1, len(SERVICES))) * 100.0)
    if dependency_targets & affected:
        reasons.append(f"{len(dependency_targets & affected)} dependent service(s) are also affected")
    if len(active_services) > 1:
        reasons.append(f"{len(active_services)} active faults are being evaluated together")
    if len(recent_window) >= 3:
        reasons.append(f"{len(recent_window)} fault event(s) occurred in the last 10 minutes")

    components = {
        "severity": max(severity_values or [0]),
        "frequency": max(frequency_values or [0]),
        "duration": max(duration_values or [0]),
        "impact": min(100.0, impact["affected_percentage"]),
        "recurrence": max(recurrence_values or [0]),
        "dependency": dependency_score,
    }
    score = sum(components[key] * CRITICALITY_CONFIG[f"{key}_weight"] for key in components)
    percentage = round(min(100.0, max(CRITICALITY_CONFIG["min_percentage"], score)), 1)
    if percentage >= CRITICALITY_CONFIG["critical_threshold"]:
        severity = "CRITICAL"
    elif percentage >= CRITICALITY_CONFIG["high_threshold"]:
        severity = "HIGH"
    elif percentage >= CRITICALITY_CONFIG["moderate_threshold"]:
        severity = "MODERATE"
    elif percentage >= CRITICALITY_CONFIG["low_threshold"]:
        severity = "LOW"
    else:
        severity = "INFORMATIONAL"

    return {"percentage": percentage, "severity": severity, "reasons": reasons, "components": components}


SERVICE_DIAGNOSTICS = {
    "payment": {
        "label": "Payment Service",
        "port": 8082,
        "down": {
            "title": "Payment Service Outage (:8082) — Transaction Authorization Offline",
            "what_is_happening": "Payment Service (:8082) is completely DOWN (service_up=0, returning HTTP 503). All incoming payment authorization calls are failing.",
            "cause": "Injected service outage or container termination. Order Service checkout transactions cannot process payments, forcing orders into PAYMENT_FAILED status.",
            "measures": [
                "Restart the payment microservice container: docker restart payment-service",
                "Verify payment actuator health: curl -s http://localhost:8082/actuator/health",
                "Inspect payment container logs for fatal exceptions: docker logs payment-service --tail 100",
                "Reset active fault in Fault Lab (:4001) or via POST /fault/reset",
            ],
            "why": "Payment Service (:8082) is completely down (HTTP 503 / connection refused). Customer checkouts cannot authorize credit card or wallet transactions; orders will abort at payment capture.",
            "action": "docker restart payment-service && curl -s http://localhost:8082/actuator/health",
            "command": "docker restart payment-service",
            "priority": "P1",
        },
        "high_error": {
            "title": "Payment Authorization Rejection Spike on :8082 ({err_pct}%)",
            "what_is_happening": "Payment Service is generating HTTP 5xx responses on {err_pct}% of transaction capture attempts.",
            "cause": "Payment gateway connector exceptions or database transaction lock timeouts are aborting payment validation during order checkout.",
            "measures": [
                "Inspect payment error logs: docker logs payment-service --tail 100 | grep -E 'PaymentException|TransactionSystemException|Timeout'",
                "Verify database connection pool status in Payment Service",
                "Restart payment service if error storm continues: docker restart payment-service",
                "Ensure Order Service payment circuit breaker gracefully handles transient payment failures",
            ],
            "why": "Payment Service is returning HTTP 5xx errors during transaction capture. Customer orders are rejected and transition to PAYMENT_FAILED state. Check mock payment gateway connector and database transaction locks.",
            "action": "docker logs payment-service --tail 100 | grep -E 'PaymentException|TransactionSystemException|Timeout'",
            "command": "docker logs payment-service --tail 100",
            "priority": "P1",
        },
        "low_error": {
            "title": "Transient Payment Gateway Jitter ({err_pct}%)",
            "what_is_happening": "Minor intermittent errors detected on Payment Service ({err_pct}%). Over 95% of customer payments succeed.",
            "cause": "Transient network jitter, sporadic 3DS authorization timeouts, or client retry lag. System is healthy; not a cascading outage.",
            "measures": [
                "Monitor error rate burn down for 2 minutes before taking disruptive action",
                "Inspect recent payment log warnings: docker logs payment-service --tail 50",
                "Do NOT restart container unless error rate exceeds 8%",
            ],
            "why": "Observed payment error rate is only {err_pct}%. Core transaction pipeline is 95%+ operational. Typically caused by isolated card authorization timeouts or client-side retry lag.",
            "action": "docker logs payment-service --tail 50 | grep -i 'failed'",
            "command": "docker logs payment-service --tail 50",
            "priority": "P3",
        },
        "latency": {
            "title": "Payment Provider Gateway Latency ({p99_s}s)",
            "what_is_happening": "Payment Service P99 latency ({p99_s}s) exceeds the 0.800s SLA budget. Injected delay or connection stall active.",
            "cause": "Slow payment processing causes worker threads in Order Service (:8081) to wait synchronously, risking upstream connection pool starvation.",
            "measures": [
                "Inspect active artificial latency in Fault Lab (:4001) and reset if needed",
                "Check payment service thread pool: docker logs payment-service --tail 50",
                "Verify Order Service RestTemplate timeout is configured (recommended 3000ms max)",
                "Reset latency fault: POST http://localhost:8080/fault/reset",
            ],
            "why": "Payment P99 latency ({p99_s}s) exceeds the 0.800s SLA budget. Delays in payment gateway authorization risk exhausting upstream Order Service thread pools.",
            "action": "docker logs payment-service --tail 50",
            "command": "docker logs payment-service --tail 50",
            "priority": "P2",
        },
    },
    "inventory": {
        "label": "Inventory Service",
        "port": 8083,
        "down": {
            "title": "Inventory Service Outage (:8083) — Stock Allocation Offline",
            "what_is_happening": "Inventory Service (:8083) is unreachable (service_up=0, HTTP 503). Live catalog queries and stock reservations are failing.",
            "cause": "Injected outage or container stoppage. Order Service cannot execute /inventory/deduct; checkout pipeline aborts at Step 2.",
            "measures": [
                "Restart inventory microservice container: docker restart inventory-service",
                "Verify inventory actuator health and MongoDB connectivity: curl -s http://localhost:8083/inventory",
                "Check inventory crash logs: docker logs inventory-service --tail 100",
                "Ensure /inventory/deduct security allows authenticated order orchestration",
            ],
            "why": "Inventory Service (:8083) is unreachable. Order Service cannot check stock or deduct items (/inventory/deduct); all checkout transactions abort at Step 2.",
            "action": "docker restart inventory-service && curl -s http://localhost:8083/inventory",
            "command": "docker restart inventory-service",
            "priority": "P1",
        },
        "high_error": {
            "title": "Inventory Deduction Failure on :8083 ({err_pct}%)",
            "what_is_happening": "Inventory Service is returning HTTP 500/403 errors on {err_pct}% of stock check and deduction calls.",
            "cause": "Stock deduction requests are throwing exceptions (insufficient quantity, concurrency lock conflict, or endpoint security failure).",
            "measures": [
                "Inspect inventory logs for deduction and database errors: docker logs inventory-service --tail 100 | grep -E 'Stock|deduct|OptimisticLockingFailureException'",
                "Check stock levels for affected SKUs in MongoDB Atlas via /inventory",
                "Verify @Version optimistic locking retries handle concurrent stock reservations",
                "Restart inventory service if thread pool is locked: docker restart inventory-service",
            ],
            "why": "Inventory Service is returning HTTP 500/403 errors during stock deduction. Verify /inventory/deduct endpoint security permissions and MongoDB stock availability.",
            "action": "docker logs inventory-service --tail 100",
            "command": "docker logs inventory-service --tail 100",
            "priority": "P1",
        },
        "low_error": {
            "title": "Stock Reservation Concurrency Contention ({err_pct}%)",
            "what_is_happening": "Inventory Service is experiencing a low error rate ({err_pct}%). Over 95% of catalog browsing and stock deductions succeed.",
            "cause": "Isolated concurrency contention on high-demand SKUs (e.g. Product 105) or single product stock depletion. Not a systemic cascade failure.",
            "measures": [
                "Check stock levels of low-inventory products via curl -s http://localhost:8083/inventory",
                "Observe error burn rate; allow optimistic lock retries to resolve naturally",
                "Restock items with 0 available quantity to eliminate customer checkout rejections",
            ],
            "why": "Inventory error rate is only {err_pct}%. Over 95% of catalog browsing and stock deductions succeed. Indicates isolated SKU lock contention or low stock on specific items (e.g. Product 105).",
            "action": "curl -s http://localhost:8083/inventory",
            "command": "curl -s http://localhost:8083/inventory",
            "priority": "P3",
        },
        "latency": {
            "title": "Inventory Database Query Lock Contention — P99 {p99_s}s",
            "what_is_happening": "Inventory P99 latency ({p99_s}s) exceeds the 0.300s SLA budget. Injected delay or slow MongoDB query execution active.",
            "cause": "Slow inventory lookups delay storefront product discovery and lengthen synchronous Order Service checkout execution.",
            "measures": [
                "Check active artificial delay in Fault Lab (:4001) and reset if needed",
                "Inspect MongoDB query performance and indexing on product collections",
                "Inspect inventory service logs: docker logs inventory-service --tail 50 | grep -i 'mongo'",
                "Reset latency fault: POST http://localhost:8080/fault/reset",
            ],
            "why": "Inventory P99 latency ({p99_s}s) exceeds the 0.300s SLA budget. Slow MongoDB queries on product catalog delay storefront browsing and checkout validation.",
            "action": "docker logs inventory-service --tail 50",
            "command": "docker logs inventory-service --tail 50",
            "priority": "P2",
        },
    },
    "order": {
        "label": "Order Service",
        "port": 8081,
        "down": {
            "title": "Order Service Outage (:8081) — Storefront Checkout Severed",
            "what_is_happening": "Order Service (:8081) is completely DOWN (service_up=0, HTTP 503). Core order orchestration is offline.",
            "cause": "API Gateway cannot forward POST /orders or order queries. Customer checkout and order management are completely blocked.",
            "measures": [
                "Restart order microservice container: docker restart order-service",
                "Verify order service health and database connection: curl -s http://localhost:8081/actuator/health",
                "Inspect container crash logs: docker logs order-service --tail 100",
                "Verify downstream microservices (Inventory, Payment, Shipping) are healthy",
            ],
            "why": "Order Service (:8081) is completely unavailable. Customer cart checkout and order placement endpoints are returning HTTP 503.",
            "action": "docker restart order-service && curl -s http://localhost:8081/actuator/health",
            "command": "docker restart order-service",
            "priority": "P1",
        },
        "high_error": {
            "title": "Order Orchestration Cascade Failure on :8081 ({err_pct}%)",
            "what_is_happening": "Order Service is failing {err_pct}% of order submissions, returning HTTP 5xx responses to API Gateway.",
            "cause": "Downstream dependency failure: Inventory (:8083) or Payment (:8082) rejected calls. Order Service is a caller victim in a cascading failure.",
            "measures": [
                "DO NOT restart Order Service first; diagnose the underlying callee service (Inventory or Payment)",
                "Inspect order cascade trace: docker logs order-service --tail 100 | grep -E 'RestClientException|ResourceAccessException|500'",
                "Recover the failing downstream microservice; Order Service will heal automatically",
                "Enable circuit breaker fallbacks in Order Service to prevent thread exhaustion",
            ],
            "why": "Order Service is failing order requests (error rate: {err_pct}%). Check downstream dependencies (Inventory :8083, Payment :8082) before restarting Order Service.",
            "action": "docker logs order-service --tail 100 | grep -E 'RestClientException|ResourceAccessException|500'",
            "command": "docker logs order-service --tail 100",
            "priority": "P1",
        },
        "low_error": {
            "title": "Order Service Transient Socket Drops ({err_pct}%)",
            "what_is_happening": "Order Service shows low error rate of {err_pct}%. Core order pipeline is functioning normally for >92% of requests.",
            "cause": "Isolated client socket timeout, malformed payload validation rejection, or transient downstream hiccup.",
            "measures": [
                "Monitor error rate trend before taking disruptive action",
                "Inspect order service logs for validation errors: docker logs order-service --tail 50",
                "Verify client request format from storefront",
            ],
            "why": "Order error rate is only {err_pct}%. Core order pipeline is functioning normally for >92% of requests. Likely minor client socket reset or transient downstream hiccup.",
            "action": "docker logs order-service --tail 50",
            "command": "docker logs order-service --tail 50",
            "priority": "P3",
        },
        "latency": {
            "title": "Order Orchestration Thread Exhaustion — P99 {p99_s}s",
            "what_is_happening": "Order Service P99 latency ({p99_s}s) exceeds the 0.500s SLA budget. Orders are taking excessive time to process.",
            "cause": "Order Service worker threads are synchronously blocked waiting for slow downstream microservices (Payment or Inventory).",
            "measures": [
                "Inspect Jaeger distributed traces to identify the exact slow downstream hop: http://localhost:16686",
                "Check thread dump for TIMED_WAITING threads: docker logs order-service --tail 50",
                "Tune RestTemplate socket timeout (recommended 3000ms max) to prevent unbounded caller thread blocking",
                "Reset active latency faults across dependencies: POST http://localhost:8080/fault/reset",
            ],
            "why": "Order Service P99 latency ({p99_s}s) exceeds the 0.500s SLA budget. Tomcat worker threads are blocked awaiting responses from downstream microservices.",
            "action": "docker logs order-service --tail 50",
            "command": "docker logs order-service --tail 50",
            "priority": "P2",
        },
    },
    "shipping": {
        "label": "Shipping Service",
        "port": 8084,
        "down": {
            "title": "Shipping Service Outage (:8084) — Fulfillment Label Generation Halted",
            "what_is_happening": "Shipping Service (:8084) is completely DOWN (service_up=0, HTTP 503). Dispatch label generation is halted.",
            "cause": "Injected fault or container failure. New orders cannot generate tracking numbers. Customer checkout completes, but order status remains PROCESSING.",
            "measures": [
                "Restart shipping-service container: docker restart shipping-service",
                "Verify shipping health: curl -s http://localhost:8084/actuator/health",
                "Inspect container logs for startup failures: docker logs shipping-service --tail 100",
                "Clear active fault state in Fault Lab (:4001)",
            ],
            "why": "Shipping Service (:8084) is DOWN. New orders cannot generate shipping labels or carrier tracking IDs. Customer checkout can proceed if decoupled asynchronously.",
            "action": "docker restart shipping-service && curl -s http://localhost:8084/actuator/health",
            "command": "docker restart shipping-service",
            "priority": "P1",
        },
        "high_error": {
            "title": "Carrier Dispatch API Rejection Spike on :8084 ({err_pct}%)",
            "what_is_happening": "Shipping Service is returning HTTP 5xx errors on {err_pct}% of shipment creation requests.",
            "cause": "Carrier webhook integration failure or database serialization conflict during shipment ID generation.",
            "measures": [
                "Inspect shipping container logs: docker logs shipping-service --tail 50 | grep -i 'carrier'",
                "Decouple shipping label generation from checkout via asynchronous queues",
                "Restart shipping service if error loop persists: docker restart shipping-service",
            ],
            "why": "Shipping Service is returning 5xx errors (error rate: {err_pct}%). Decouple shipping label generation from checkout via asynchronous queues.",
            "action": "docker logs shipping-service --tail 50",
            "command": "docker logs shipping-service --tail 50",
            "priority": "P2",
        },
        "low_error": {
            "title": "Shipping Carrier API Intermittent Jitter ({err_pct}%)",
            "what_is_happening": "Shipping Service error rate is {err_pct}%. Minor carrier API timeout during background dispatch creation.",
            "cause": "Transient carrier webhook timeout. Primary checkout and order persistence are 100% unaffected.",
            "measures": [
                "Check carrier webhook queue: docker logs shipping-service --tail 30",
                "Allow background retry scheduler to dispatch pending labels",
            ],
            "why": "Shipping error rate is {err_pct}%. Post-checkout background fulfillment task experiencing minor transient carrier webhook delay.",
            "action": "docker logs shipping-service --tail 30",
            "command": "docker logs shipping-service --tail 30",
            "priority": "P3",
        },
        "latency": {
            "title": "Carrier Dispatch API Latency ({p99_s}s)",
            "what_is_happening": "Shipping latency ({p99_s}s) exceeds the 1.000s SLA budget. Outbound carrier dispatch calls are lagging.",
            "cause": "External carrier rate limiting or artificial latency fault in shipping microservice.",
            "measures": [
                "Check active artificial delay in Fault Lab (:4001) and reset if needed",
                "Inspect outbound carrier dispatch response times: docker logs shipping-service --tail 30",
                "Ensure shipping dispatch is processed via @Async background worker",
            ],
            "why": "Shipping latency ({p99_s}s) exceeds the 1.000s SLA budget. Outbound carrier dispatch calls are taking longer than normal.",
            "action": "docker logs shipping-service --tail 30",
            "command": "docker logs shipping-service --tail 30",
            "priority": "P2",
        },
    },
    "delivery": {
        "label": "Delivery Service",
        "port": 8085,
        "down": {
            "title": "Delivery Tracking Service Outage (:8085)",
            "what_is_happening": "Delivery Service (:8085) is DOWN (service_up=0, HTTP 503). Live GPS tracking updates are paused.",
            "cause": "Delivery container offline. Storefront checkout, inventory deduction, and payment capture are unaffected.",
            "measures": [
                "Restart delivery container: docker restart delivery-service",
                "Verify actuator health: curl -s http://localhost:8085/actuator/health",
                "Inspect delivery logs: docker logs delivery-service --tail 50",
            ],
            "why": "Delivery Service (:8085) is down. Live order GPS tracking is unavailable, but customer cart checkout and order placement are unaffected.",
            "action": "docker restart delivery-service && curl -s http://localhost:8085/actuator/health",
            "command": "docker restart delivery-service",
            "priority": "P2",
        },
        "high_error": {
            "title": "Courier Telemetry Failures on :8085 ({err_pct}%)",
            "what_is_happening": "Delivery Service is reporting HTTP 5xx errors on {err_pct}% of tracking requests.",
            "cause": "Courier webhook payload parser exception or GPS telemetry buffer overflow.",
            "measures": [
                "Inspect courier webhook ingestion buffer: docker logs delivery-service --tail 50 | grep -i 'courier'",
                "Isolate delivery errors from upstream shipping pipeline",
                "Restart delivery service if telemetry queue is stalled: docker restart delivery-service",
            ],
            "why": "Delivery Service is reporting errors (error rate: {err_pct}%). Inspect courier webhook ingestion buffer; isolate delivery errors from upstream shipping.",
            "action": "docker logs delivery-service --tail 50",
            "command": "docker logs delivery-service --tail 50",
            "priority": "P2",
        },
        "low_error": {
            "title": "Delivery Telemetry Sync Latency ({err_pct}%)",
            "what_is_happening": "Minor error rate of {err_pct}% on delivery tracking.",
            "cause": "Transient courier GPS packet drop. Storefront operations are 100% unaffected.",
            "measures": [
                "Check delivery log tail: docker logs delivery-service --tail 30",
                "No immediate intervention required; monitor telemetry stream",
            ],
            "why": "Minor error rate of {err_pct}% on delivery tracking. Storefront checkout is 100% operational.",
            "action": "docker logs delivery-service --tail 30",
            "command": "docker logs delivery-service --tail 30",
            "priority": "P3",
        },
        "latency": {
            "title": "Delivery Service Latency ({p99_s}s)",
            "what_is_happening": "Delivery P99 latency ({p99_s}s) exceeds the 1.000s SLA budget.",
            "cause": "Slow courier API responses or artificial latency fault in delivery microservice.",
            "measures": [
                "Inspect delivery logs: docker logs delivery-service --tail 30",
                "Reset active latency faults in Fault Lab (:4001)",
            ],
            "why": "Delivery P99 latency ({p99_s}s) exceeds the 1.000s SLA budget.",
            "action": "docker logs delivery-service --tail 30",
            "command": "docker logs delivery-service --tail 30",
            "priority": "P3",
        },
    },
    "notification": {
        "label": "Notification Service",
        "port": 8086,
        "down": {
            "title": "Notification Service Outage (:8086) — Customer Email/SMS Disconnected",
            "what_is_happening": "Notification Service (:8086) is DOWN (service_up=0, HTTP 503). Automated order confirmation emails cannot be dispatched.",
            "cause": "Injected outage or container stoppage. Upstream Order Service notifications are dropped or queued.",
            "measures": [
                "Restart notification container: docker restart notification-service",
                "Verify actuator health: curl -s http://localhost:8086/actuator/health",
                "Ensure upstream services fire notifications via @Async fire-and-forget so checkout never blocks",
                "Clear active fault state in Fault Lab (:4001)",
            ],
            "why": "Notification Service (:8086) is DOWN. Order confirmations cannot be dispatched. Verify upstream services fire notifications via @Async fire-and-forget so checkout never blocks.",
            "action": "docker restart notification-service && curl -s http://localhost:8086/actuator/health",
            "command": "docker restart notification-service",
            "priority": "P2",
        },
        "high_error": {
            "title": "Notification Relay Failure on :8086 ({err_pct}%)",
            "what_is_happening": "Notification Service is encountering delivery errors on {err_pct}% of outgoing alerts.",
            "cause": "SMTP provider authentication failure or SMS gateway rate limit rejection.",
            "measures": [
                "Inspect notification container logs: docker logs notification-service --tail 50 | grep -E 'MailException|SmsException'",
                "Verify SMTP relay credentials and SMS provider balance",
                "Ensure ThreadPoolTaskExecutor DiscardOldestPolicy is active to prevent memory leaks",
            ],
            "why": "Notification Service is encountering delivery errors (error rate: {err_pct}%). Verify SMTP relay and SMS provider credentials; ensure ThreadPoolTaskExecutor DiscardOldestPolicy is active.",
            "action": "docker logs notification-service --tail 50",
            "command": "docker logs notification-service --tail 50",
            "priority": "P2",
        },
        "low_error": {
            "title": "Notification Provider Rate Limit ({err_pct}%)",
            "what_is_happening": "Low error rate of {err_pct}% on notification delivery.",
            "cause": "Transient provider rate-limit or email formatting rejection. Checkout is completely unaffected.",
            "measures": [
                "Monitor email dispatch queue: docker logs notification-service --tail 30",
                "Allow exponential backoff retry mechanism to deliver queued messages",
            ],
            "why": "Low error rate of {err_pct}%. Transient provider rate-limit or email formatting error. Checkout is completely unaffected.",
            "action": "docker logs notification-service --tail 30",
            "command": "docker logs notification-service --tail 30",
            "priority": "P3",
        },
        "latency": {
            "title": "Notification Delivery Latency ({p99_s}s)",
            "what_is_happening": "Notification P99 latency ({p99_s}s) exceeds the 0.500s SLA budget.",
            "cause": "Slow SMTP connection handshake or artificial latency fault in notification service.",
            "measures": [
                "Check active artificial delay in Fault Lab (:4001) and reset if needed",
                "Ensure email sending is executed on dedicated async daemon threads",
            ],
            "why": "Notification P99 latency ({p99_s}s) exceeds 0.500s SLA budget. Ensure thread pool decoupling.",
            "action": "docker logs notification-service --tail 30",
            "command": "docker logs notification-service --tail 30",
            "priority": "P3",
        },
    },
}


def intelligent_recommendations(raw: dict, causes: list, impact: dict, criticality: dict, sla: dict) -> list:
    """Create particular, microservice-specific recommendations from current evidence, state, and fault history."""
    active = _active_fault_events()
    recommendations = []

    def add(service, recommendation, why, evidence, action, priority, command=None, what_is_happening=None, cause=None, measures=None):
        m_list = measures if isinstance(measures, list) else ([measures] if measures else [action])
        recommendations.append({
            "service": service,
            "recommendation": recommendation,
            "title": recommendation,
            "what_is_happening": what_is_happening or why,
            "cause": cause or why,
            "measures": m_list,
            "why": why,
            "evidence": evidence,
            "suggested_action": action,
            "command": command or action,
            "priority": priority,
            "severity": criticality["severity"],
            "criticality": criticality["percentage"],
        })

    affected_services = [svc for svc, value in impact["services"].items() if value > 0]
    repeated = {
        svc: sum(1 for event in FAULT_EVENTS if event.get("service") == svc and event.get("status") in ("ACTIVE", "INJECTED"))
        for svc in affected_services
    }
    cascading = len(affected_services) > 1 or len({dst for src, dst in ARCH_EDGES if src in affected_services} & set(affected_services)) > 0

    if cascading:
        def _dep_score(svc):
            # Prioritize services that are down or faulted, and callee dependencies over orchestrator callers
            is_down = 10 if raw.get(f"{svc}_service_up", 1.0) == 0 else 0
            has_fault = 5 if raw.get(f"{svc}_fault", "NONE") != "NONE" else 0
            callers = sum(1 for src, dst in ARCH_EDGES if dst == svc and src in affected_services)
            calls_others = sum(1 for src, dst in ARCH_EDGES if src == svc and dst in affected_services)
            return is_down + has_fault + (callers * 2) - calls_others

        sorted_candidates = sorted(affected_services, key=_dep_score, reverse=True)
        root_svc = sorted_candidates[0] if sorted_candidates else affected_services[0]
        downstream = [s for s in affected_services if s != root_svc]
        root_label = SERVICE_LABELS.get(root_svc, root_svc)
        downstream_labels = ", ".join(SERVICE_LABELS.get(s, s) for s in downstream) if downstream else "downstream services"
        port = SERVICE_PORTS.get(root_svc, 8080)
        add(root_svc,
            f"Cascade Root Cause: Investigate the upstream dependency ({root_label}) before restarting downstream services.",
            f"Multiple related services ({', '.join(affected_services)}) are affected. The failure originated in {root_label} and propagated to {downstream_labels}. Restarting {downstream_labels} will not fix the cascade.",
            f"Affected services: {', '.join(affected_services)}; upstream root: {root_label} (:{port}); dependency impact: {criticality['components']['dependency']:.1f}%.",
            f"docker restart {root_svc}-service",
            "P1",
            command=f"docker restart {root_svc}-service",
            what_is_happening=f"Cascading failure detected across {len(affected_services)} services ({', '.join(affected_services)}). Downstream callers are failing because upstream dependency {root_label} is offline or rejecting calls.",
            cause=f"Architectural cascade propagation: {root_label} is the callee dependency root cause. Synchronous calls from {downstream_labels} timed out or failed, propagating errors through the dependency graph.",
            measures=[
                f"Prioritize recovering the upstream root cause dependency ({root_label}) first: docker restart {root_svc}-service",
                f"Do NOT restart caller services ({downstream_labels}) yet; they will self-heal automatically once {root_label} recovers",
                f"Verify health of the root dependency: curl -s http://localhost:{port}/actuator/health",
                f"Inspect Jaeger distributed trace for propagation timing: http://localhost:16686",
            ])

    for svc in affected_services:
        fault = str(raw.get(f"{svc}_fault", "NONE")).upper()
        up = float(raw.get(f"{svc}_service_up", 1.0))
        err = float(raw.get(f"{svc}_error_rate_5xx", 0.0))
        rr = float(raw.get(f"{svc}_request_rate", 0.0))
        p99 = float(raw.get(f"{svc}_p99_latency_s", 0.0))
        delay = float(raw.get(f"{svc}_fault_delay_ms", 0.0))
        label = SERVICE_LABELS.get(svc, svc)
        diag = SERVICE_DIAGNOSTICS.get(svc, {})
        err_pct = round((err / max(rr, 0.001)) * 100, 1) if rr > 0 else round(err * 100.0, 1)
        sla_target = SLA_TARGETS.get(svc, {"max_error_rate": 0.01, "max_p99_s": 0.5})
        budget_pct = round((err / max(sla_target["max_error_rate"], 1e-6)) * 100, 1)

        if repeated.get(svc, 0) >= 3:
            add(svc,
                f"Investigate recurring failure pattern on {label} instead of repeating restarts.",
                f"{label} has {repeated[svc]} recorded fault events in recent window, indicating recurrence. Repetitive restarts do not address root cause resource leaks.",
                f"Fault type: {fault}; recent event count: {repeated[svc]}; current impact: {impact['services'][svc]:.1f}%.",
                f"docker logs {svc}-service --tail 200",
                "P1",
                command=f"docker logs {svc}-service --tail 100",
                what_is_happening=f"{label} has failed {repeated[svc]} times in the recent observation window. Repeated container restarts have failed to permanently stabilize the service.",
                cause="Chronic resource exhaustion, database connection pool leak, or memory leak causing recurring process crashes.",
                measures=[
                    f"Check heap dump and memory leak traces: docker logs {svc}-service --tail 200 | grep -E 'OutOfMemoryError|ConnectionPoolTimeoutException|Deadlock'",
                    "Profile JVM memory footprint and active thread count",
                    "Inspect MongoDB Atlas connection limits and slow query logs",
                ])
        elif fault == "DOWN" or up == 0:
            cfg = diag.get("down", {})
            add(svc,
                cfg.get("title", f"Restart {label} — Service Down"),
                cfg.get("why", f"{label} is completely offline (service_up=0)."),
                f"Status: DOWN (service_up=0); port: {SERVICE_PORTS.get(svc)}; impact: {impact['services'][svc]:.1f}%.",
                cfg.get("action", f"docker restart {svc}-service"),
                cfg.get("priority", "P1"),
                command=cfg.get("command", f"docker restart {svc}-service"),
                what_is_happening=cfg.get("what_is_happening", f"{label} is completely offline (service_up=0)."),
                cause=cfg.get("cause", f"{label} process is terminated or injected DOWN fault is active."),
                measures=cfg.get("measures", [f"docker restart {svc}-service"]))
        elif fault == "ERROR" or err > 0.08:
            cfg = diag.get("high_error", {})
            title = cfg.get("title", f"Remediate {label} Error Rate").format(err_pct=err_pct)
            why = cfg.get("why", f"{label} is returning high error rates.").format(err_pct=err_pct)
            what_is_happening = cfg.get("what_is_happening", f"{label} is returning high error rates.").format(err_pct=err_pct)
            cause = cfg.get("cause", f"{label} is failing internal transactions.").format(err_pct=err_pct)
            add(svc,
                title,
                why,
                f"Fault: {fault}; error rate: {err:.4f}/s ({err_pct}% of traffic); SLA error budget consumed: {budget_pct}%; impact: {impact['services'][svc]:.1f}%.",
                cfg.get("action", f"docker logs {svc}-service --tail 100"),
                cfg.get("priority", "P1"),
                command=cfg.get("command", f"docker logs {svc}-service --tail 100"),
                what_is_happening=what_is_happening,
                cause=cause,
                measures=cfg.get("measures", [f"docker logs {svc}-service --tail 100"]))
        elif err > 0.005 or (err > 0 and err <= 0.08):
            cfg = diag.get("low_error", {})
            title = cfg.get("title", f"Monitor {label} Transient Fluctuation").format(err_pct=err_pct)
            why = cfg.get("why", f"{label} error rate is low ({err_pct}%).").format(err_pct=err_pct)
            what_is_happening = cfg.get("what_is_happening", f"{label} error rate is low ({err_pct}%).").format(err_pct=err_pct)
            cause = cfg.get("cause", f"{label} has transient jitter.").format(err_pct=err_pct)
            add(svc,
                title,
                why,
                f"Minor error rate: {err:.4f}/s ({err_pct}%); impact: {impact['services'][svc]:.1f}%; core operations unaffected.",
                cfg.get("action", f"docker logs {svc}-service --tail 50"),
                cfg.get("priority", "P3"),
                command=cfg.get("command", f"docker logs {svc}-service --tail 50"),
                what_is_happening=what_is_happening,
                cause=cause,
                measures=cfg.get("measures", [f"docker logs {svc}-service --tail 50"]))
        elif fault == "LATENCY" or p99 > sla_target["max_p99_s"]:
            cfg = diag.get("latency", {})
            p99_val = round(p99, 3)
            title = cfg.get("title", f"Check {label} Dependency Latency").format(p99_s=p99_val)
            why = cfg.get("why", f"{label} is slow.").format(p99_s=p99_val)
            what_is_happening = cfg.get("what_is_happening", f"{label} is slow.").format(p99_s=p99_val)
            cause = cfg.get("cause", f"{label} latency is elevated.").format(p99_s=p99_val)
            add(svc,
                title,
                why,
                f"P99 latency: {p99:.3f}s; injected delay: {delay:.0f}ms; SLA limit: {sla_target['max_p99_s']}s; impact: {impact['services'][svc]:.1f}%.",
                cfg.get("action", f"docker logs {svc}-service --tail 50"),
                cfg.get("priority", "P2"),
                command=cfg.get("command", f"docker logs {svc}-service --tail 50"),
                what_is_happening=what_is_happening,
                cause=cause,
                measures=cfg.get("measures", [f"docker logs {svc}-service --tail 50"]))

    if not recommendations and not causes:
        add("system",
            "All OmniStore Microservices Operational — Normal Telemetry",
            "All 6 microservices (Order, Payment, Inventory, Shipping, Delivery, Notification) are healthy with zero active faults and zero SLA breaches.",
            f"Criticality: {criticality['percentage']:.1f}%; system error rate: 0.00%; active incidents: 0.",
            "System is operating normally. To test cascade prediction resilience, inject faults via Fault Lab (:4001).",
            "P3",
            command="curl -s http://localhost:8080/actuator/health",
            what_is_happening="All 6 OmniStore microservices (Order, Payment, Inventory, Shipping, Delivery, Notification) are healthy with zero active faults and zero SLA breaches.",
            cause="System is operating within healthy baseline tolerances. Error rate is 0.00% and P99 latency is below all SLA thresholds.",
            measures=[
                "System is fully operational; no remediation required",
                "To test cascade prediction resilience, inject faults via Fault Lab (:4001)",
                "Monitor live metrics and Prometheus health status in Grafana",
            ])

    return recommendations


def enrich_fault_events(raw: dict, impact: dict, criticality: dict, recommendations: list):
    """Persist current metrics and recommendation evidence back onto synchronized events."""
    by_service = {item.get("service"): item for item in recommendations}
    changed = False
    for event in FAULT_EVENTS:
        service = event.get("service")
        if service not in impact["services"]:
            continue
        event["criticality_percentage"] = criticality["percentage"]
        event["severity"] = criticality["severity"]
        event["criticality_reasons"] = criticality["reasons"]
        event["affected_component"] = service
        event["active_faults"] = len(_active_fault_events())
        recommendation = by_service.get(service) or by_service.get("system")
        if recommendation:
            event["recommendation"] = recommendation["recommendation"]
            event["recommendation_reason"] = recommendation["why"]
            event["recommendation_evidence"] = recommendation["evidence"]
        changed = True
    if changed:
        _save_fault_events()


def full_pipeline(raw: dict) -> dict:
    causes   = root_cause(raw)
    z        = zscore_analysis(raw)
    t        = temporal_analysis(raw)
    nx_data  = dependency_graph(raw, causes)
    fi       = feature_importances()
    sla      = sla_compliance(raw)
    obs      = observability_status()
    impact   = impact_analysis(raw)
    criticality = criticality_analysis(raw, impact)

    # ML Cascade Failure Prediction driven by Random Forest model (71 features)
    ml_result  = predict_cascade(raw)
    prediction = ml_result["prediction"]
    cr         = ml_result["cascade_risk"]
    confidence = ml_result["confidence"]
    rl         = ml_result["risk_level"]
    model_note = ml_result["model_note"]

    # Percentage-scaled risk level escalation:
    # CRITICAL requires widespread failure: >= 2 services down, system mean error >= 35%,
    # or high cascade risk with significant error rate (>= 30%).
    if rl == "CRITICAL":
        if raw.get("num_services_down", 0) < 2 and raw.get("system_mean_error_rate", 0) < 0.35 and cr < 0.80:
            rl = "HIGH" if (raw.get("num_services_down", 0) >= 1 or raw.get("system_max_error_rate", 0) >= 0.20) else ("MEDIUM" if raw.get("system_max_error_rate", 0) >= 0.08 else "LOW")
    elif criticality["severity"] == "CRITICAL":
        if raw.get("num_services_down", 0) >= 2 or raw.get("system_mean_error_rate", 0) >= 0.35 or cr >= 0.80:
            rl = "CRITICAL"
        else:
            rl = "HIGH"
    elif criticality["severity"] == "HIGH" and rl == "LOW":
        rl = "MEDIUM" if raw.get("system_max_error_rate", 0) <= 0.15 else "HIGH"

    recs = intelligent_recommendations(raw, causes, impact, criticality, sla)
    enrich_fault_events(raw, impact, criticality, recs)
    _append_incident(raw, causes, rl)

    # Compute observability percentages for each service
    obs_pct = {}
    for svc in SERVICES:
        up  = float(raw.get(f"{svc}_service_up",      1.0))
        err = float(raw.get(f"{svc}_error_rate_5xx",  0.0))
        p99 = float(raw.get(f"{svc}_p99_latency_s",   0.0))
        rr  = float(raw.get(f"{svc}_request_rate",    0.0))
        sla_t = SLA_TARGETS[svc]

        # Error rate as % of requests
        err_pct  = round((err / max(rr, 0.001)) * 100, 2) if rr > 0 else 0.0
        # Latency budget %
        lat_pct  = round(min(100.0, (p99 / max(sla_t["max_p99_s"], 0.001)) * 100), 1)
        # Uptime %
        up_pct   = 100.0 if up == 1 else 0.0
        # Error budget %
        err_bud  = round(min(100.0, (err / max(sla_t["max_error_rate"], 1e-9)) * 100), 1)

        obs_pct[svc] = {
            "uptime_pct":           up_pct,
            "error_rate_pct":       err_pct,
            "latency_budget_pct":   lat_pct,
            "error_budget_pct":     err_bud,
            "request_rate":         round(rr, 4),
            "p99_latency_s":        round(p99, 4),
            "error_rate_raw":       round(err, 4),
        }

    return {
        "prediction":            prediction,
        "cascade_risk":          cr,
        "risk_level":            rl,
        "confidence":            confidence,
        "affected_percentage":   impact["affected_percentage"],
        "affected_services":     impact["affected_services"],
        "service_impact_pct":     impact["services"],
        "criticality_percentage": criticality["percentage"],
        "criticality_severity":   criticality["severity"],
        "criticality_reasons":    criticality["reasons"],
        "criticality_components": criticality["components"],
        "model_note":            model_note,
        "root_cause":            causes,
        "cascade_path":          nx_data["cascade_path"],
        "recommendations":       recs,
        "z_score_analysis":      z,
        "temporal_analysis":     t,
        "networkx_graph":        nx_data["graph_data"],
        "feature_importances":   fi,
        "sla_compliance":        sla,
        "observability_status":  obs,
        "observability_pct":     obs_pct,
        "fault_events":          [
            {**event, "criticality_percentage": criticality["percentage"], "criticality_severity": criticality["severity"]}
            for event in list(FAULT_EVENTS)[-50:]
        ],
        "incident_log":          list(INCIDENT_LOG),
        "live_metrics": {
            svc: {
                "error_rate_5xx": round(float(raw.get(f"{svc}_error_rate_5xx", 0)), 4),
                "p99_latency_s":  round(float(raw.get(f"{svc}_p99_latency_s",  0)), 4),
                "service_up":     int(raw.get(f"{svc}_service_up", 1)),
                "request_rate":   round(float(raw.get(f"{svc}_request_rate",   0)), 4),
                "jvm_heap_mb":    round(float(raw.get(f"{svc}_jvm_heap_mb",    0)), 1),
                "active_threads": int(raw.get(f"{svc}_active_threads", 0)),
            }
            for svc in SERVICES
        },
        "system": {
            "mean_error_rate":    round(float(raw.get("system_mean_error_rate",  0)), 4),
            "max_p99_latency":    round(float(raw.get("system_max_p99_latency",  0)), 4),
            "num_services_down":  int(raw.get("num_services_down", 0)),
            "prometheus_connected": bool(raw.get("prometheus_connected", False)),
        },
    }


# ── Routes ────────────────────────────────────────────────────────────────────

@app.route("/health")
def health():
    return jsonify({"status": "UP", "model_loaded": _model is not None})


@app.route("/metrics/live")
@app.route("/api/metrics/live")
def metrics_live():
    try:
        raw    = scrape()
        result = full_pipeline(raw)
        return jsonify(result)
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


@app.route("/observability")
def obs_status():
    """Live connectivity check for Grafana, Prometheus, and Jaeger."""
    return jsonify(observability_status())


@app.route("/incidents")
@app.route("/api/incidents")
def incidents():
    return jsonify({"incidents": list(INCIDENT_LOG), "count": len(INCIDENT_LOG)})


@app.route("/api/fault-events", methods=["POST"])
def fault_events_ingest():
    """Ingest an idempotent fault lifecycle event from the gateway outbox."""
    body = request.get_json(silent=True) or {}
    required = ("fault_id", "service", "fault", "status", "timestamp")
    if any(not body.get(field) for field in required):
        return jsonify({"error": "fault_id, service, fault, status and timestamp are required"}), 400
    if body["service"] not in SERVICES or str(body["fault"]).upper() not in ("NONE", "LATENCY", "ERROR", "DOWN"):
        return jsonify({"error": "invalid service or fault type"}), 400
    if any(event.get("fault_id") == body["fault_id"] for event in FAULT_EVENTS):
        return jsonify({"status": "duplicate", "fault_id": body["fault_id"]}), 200
    event = {
        "fault_id": str(body["fault_id"]),
        "service": body["service"],
        "microservice": body.get("microservice", f"{body['service']}-service"),
        "fault": str(body["fault"]).upper(),
        "description": body.get("description", "Fault injection event"),
        "timestamp": body["timestamp"],
        "duration_ms": int(body.get("duration_ms", body.get("delayMs", 0)) or 0),
        "status": str(body["status"]).upper(),
        "recovery_status": body.get("recovery_status", "PENDING"),
        "dependencies": body.get("dependencies", []),
        "recommendation": body.get("recommendation"),
        "recommendation_reason": body.get("recommendation_reason"),
    }
    FAULT_EVENTS.append(event)
    _save_fault_events()
    return jsonify({"status": "recorded", "fault_id": event["fault_id"]}), 201


@app.route("/api/fault-events", methods=["GET"])
def fault_events():
    return jsonify({"events": list(FAULT_EVENTS), "count": len(FAULT_EVENTS)})


@app.route("/incidents/clear", methods=["POST"])
@app.route("/api/incidents/clear", methods=["POST"])
def clear_incidents():
    """Clear the incident log (useful for demo resets)."""
    INCIDENT_LOG.clear()
    _last_rec_fingerprint.clear()
    _save_incident_log()
    return jsonify({"status": "cleared"})


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
    _load_incident_log()

    print(f"\nPrediction API running on http://{args.host}:{args.port}")
    print("  GET  /health")
    print("  GET  /metrics/live        <-- Developer Dashboard polls this")
    print("  GET  /observability       <-- Grafana/Prometheus/Jaeger status")
    print("  GET  /incidents           <-- Rolling incident log")
    print("  POST /predict")
    print("  GET  /model/info\n")

    app.run(host=args.host, port=args.port, debug=False)
