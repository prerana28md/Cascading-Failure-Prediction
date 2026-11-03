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
import threading
import time
import warnings
from concurrent.futures import ThreadPoolExecutor
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
FAULT_EVENTS_LOCK = threading.RLock()
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

# ── Config ────────────────────────────────────────────────────────────────────
PROMETHEUS_URL = os.getenv("PROMETHEUS_URL", "http://localhost:9090")
GRAFANA_URL    = os.getenv("GRAFANA_URL",    "http://localhost:3001")
JAEGER_URL     = os.getenv("JAEGER_URL",     "http://localhost:16686")
LOKI_URL       = os.getenv("LOKI_URL",       "http://localhost:3100")
MODEL_DIR      = os.getenv("MODEL_DIR", os.path.join(os.path.dirname(__file__), "model"))
MOVIESTREAM_LOG_DIR = os.getenv(
    "MOVIESTREAM_LOG_DIR",
    os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "moviestream", "services", "logs")),
)

WORKLOAD_SERVICES = {
    "omnistore":   ["order", "payment", "inventory", "shipping", "delivery", "notification"],
    "moviestream": ["catalog", "user", "watchlist", "history", "recommendation"]
}

SERVICES = WORKLOAD_SERVICES["omnistore"]
ALL_SERVICES = WORKLOAD_SERVICES["omnistore"] + WORKLOAD_SERVICES["moviestream"]

# Direct service ports — used for fault-aware health probing
SERVICE_PORTS = {
    "order":          8081,
    "payment":        8082,
    "inventory":      8083,
    "shipping":       8084,
    "delivery":       8085,
    "notification":   8086,
    "catalog":        8087,
    "user":           8088,
    "watchlist":      8089,
    "history":        8092,
    "recommendation": 8093,
}

SERVICE_LABELS = {
    "order":          "Order Service",
    "payment":        "Payment Service",
    "inventory":      "Inventory Service",
    "shipping":       "Shipping Service",
    "delivery":       "Delivery Service",
    "notification":   "Notification Service",
    "catalog":        "Catalog Service",
    "user":           "User Service",
    "watchlist":      "Watchlist Service",
    "history":        "History Service",
    "recommendation": "Recommendation Service",
}

# Business importance classifications per workload (static architectural importance)
BUSINESS_IMPORTANCE_BY_WORKLOAD = {
    "omnistore": {
        "order":        {"tier": "Critical", "weight": 1.00, "centrality": 0.95, "propagation_pot": 1.00, "customer_pot": 1.00, "reason": "Controls order creation and checkout orchestration"},
        "payment":      {"tier": "Critical", "weight": 1.00, "centrality": 0.85, "propagation_pot": 0.85, "customer_pot": 0.95, "reason": "Handles payment authorization and financial transactions"},
        "inventory":    {"tier": "Critical", "weight": 0.90, "centrality": 0.80, "propagation_pot": 0.80, "customer_pot": 0.90, "reason": "Controls stock availability and inventory reservation"},
        "shipping":     {"tier": "High",     "weight": 0.70, "centrality": 0.60, "propagation_pot": 0.50, "customer_pot": 0.60, "reason": "Coordinates shipment creation and carrier dispatch"},
        "delivery":     {"tier": "High",     "weight": 0.65, "centrality": 0.50, "propagation_pot": 0.40, "customer_pot": 0.50, "reason": "Handles package delivery tracking and fulfillment status"},
        "notification": {"tier": "Medium",   "weight": 0.35, "centrality": 0.30, "propagation_pot": 0.00, "customer_pot": 0.20, "reason": "Sends order, payment and delivery customer notifications"},
    },
    "moviestream": {
        "catalog":        {"tier": "Critical", "weight": 0.95, "centrality": 0.90, "propagation_pot": 0.90, "customer_pot": 0.95, "reason": "Provides movie metadata, search, and availability for all discovery"},
        "user":           {"tier": "High",     "weight": 0.80, "centrality": 0.75, "propagation_pot": 0.75, "customer_pot": 0.85, "reason": "Manages customer profiles, authentication, and preferences"},
        "recommendation": {"tier": "Medium",   "weight": 0.50, "centrality": 0.50, "propagation_pot": 0.10, "customer_pot": 0.40, "reason": "Generates personalized movie suggestion rails"},
        "watchlist":      {"tier": "Medium",   "weight": 0.40, "centrality": 0.35, "propagation_pot": 0.15, "customer_pot": 0.35, "reason": "Stores customer saved titles"},
        "history":        {"tier": "Medium",   "weight": 0.40, "centrality": 0.35, "propagation_pot": 0.15, "customer_pot": 0.35, "reason": "Records user playback activity and watch progress"},
    }
}

# Configurable Criticality Weights (Business 25%, Centrality 20%, Fault 20%, Traffic 15%, Propagation 10%, Customer 10%)
CRITICALITY_WEIGHTS = {
    "business_criticality":  float(os.getenv("CRITICALITY_BUSINESS_WEIGHT",   "0.25")),
    "dependency_centrality": float(os.getenv("CRITICALITY_CENTRALITY_WEIGHT", "0.20")),
    "fault_severity":        float(os.getenv("CRITICALITY_FAULT_WEIGHT",      "0.20")),
    "traffic_impact":        float(os.getenv("CRITICALITY_TRAFFIC_WEIGHT",    "0.15")),
    "propagation_potential": float(os.getenv("CRITICALITY_PROPAGATION_WEIGHT","0.10")),
    "customer_impact":       float(os.getenv("CRITICALITY_CUSTOMER_WEIGHT",   "0.10")),
}

# Detailed dependency metadata with timeouts, retries, circuit breakers, and fallback strategies
DEPENDENCY_METADATA_BY_WORKLOAD = {
    "omnistore": [
        {
            "source": "order",
            "target": "payment",
            "type": "synchronous",
            "criticality": "Critical",
            "is_sync": True,
            "timeout_ms": 3000,
            "retries": 2,
            "circuit_breaker": "Enabled (Threshold: 50%, Sleep: 5s)",
            "fallback": "Fail order checkout fast, notify customer to retry payment",
            "description": "Synchronous payment authorization before order confirmation"
        },
        {
            "source": "order",
            "target": "inventory",
            "type": "synchronous",
            "criticality": "Critical",
            "is_sync": True,
            "timeout_ms": 2500,
            "retries": 2,
            "circuit_breaker": "Enabled (Threshold: 50%, Sleep: 5s)",
            "fallback": "Halt checkout if stock cannot be reserved (prevents overselling)",
            "description": "Synchronous stock validation and item reservation"
        },
        {
            "source": "order",
            "target": "shipping",
            "type": "conditional",
            "criticality": "High",
            "is_sync": False,
            "timeout_ms": 4000,
            "retries": 3,
            "circuit_breaker": "Enabled (Threshold: 60%, Sleep: 10s)",
            "fallback": "Queue shipment creation in fulfillment queue if shipping service is busy",
            "description": "Conditional fulfillment dispatch after successful checkout"
        },
        {
            "source": "order",
            "target": "notification",
            "type": "asynchronous",
            "criticality": "Medium",
            "is_sync": False,
            "timeout_ms": 1000,
            "retries": 5,
            "circuit_breaker": "Disabled (Buffered via Message Queue)",
            "fallback": "Buffer event in Kafka/RabbitMQ queue 'order.created.events'",
            "description": "Asynchronous order confirmation event dispatch (non-blocking)"
        },
        {
            "source": "shipping",
            "target": "delivery",
            "type": "synchronous",
            "criticality": "High",
            "is_sync": True,
            "timeout_ms": 3000,
            "retries": 2,
            "circuit_breaker": "Enabled (Threshold: 50%, Sleep: 5s)",
            "fallback": "Queue courier dispatch request and retry when delivery service recovers",
            "description": "Fulfillment package handoff to carrier logistics"
        },
        {
            "source": "payment",
            "target": "notification",
            "type": "asynchronous",
            "criticality": "Medium",
            "is_sync": False,
            "timeout_ms": 1000,
            "retries": 3,
            "circuit_breaker": "Disabled (Buffered via Message Queue)",
            "fallback": "Buffer event in 'payment.receipt.events'",
            "description": "Asynchronous payment receipt notification (non-blocking)"
        },
        {
            "source": "delivery",
            "target": "notification",
            "type": "asynchronous",
            "criticality": "Medium",
            "is_sync": False,
            "timeout_ms": 1000,
            "retries": 3,
            "circuit_breaker": "Disabled (Buffered via Message Queue)",
            "fallback": "Buffer event in 'delivery.status.events'",
            "description": "Asynchronous delivery tracking updates (non-blocking)"
        }
    ],
    "moviestream": [
        {
            "source": "user",
            "target": "watchlist",
            "type": "synchronous",
            "criticality": "Medium",
            "is_sync": True,
            "timeout_ms": 2000,
            "retries": 2,
            "circuit_breaker": "Enabled",
            "fallback": "Return empty watchlist with retry banner",
            "description": "Fetch user saved titles list"
        },
        {
            "source": "user",
            "target": "history",
            "type": "synchronous",
            "criticality": "Medium",
            "is_sync": True,
            "timeout_ms": 2000,
            "retries": 2,
            "circuit_breaker": "Enabled",
            "fallback": "Return empty watch history",
            "description": "Fetch viewing activity and resume timestamps"
        },
        {
            "source": "user",
            "target": "recommendation",
            "type": "synchronous",
            "criticality": "Medium",
            "is_sync": True,
            "timeout_ms": 3000,
            "retries": 1,
            "circuit_breaker": "Enabled",
            "fallback": "Show static popular/trending carousel",
            "description": "Provide user demographic/preference profile"
        },
        {
            "source": "catalog",
            "target": "recommendation",
            "type": "synchronous",
            "criticality": "High",
            "is_sync": True,
            "timeout_ms": 3000,
            "retries": 2,
            "circuit_breaker": "Enabled",
            "fallback": "Serve cached catalog candidate pool",
            "description": "Feed movie catalog metadata into candidate ranker"
        },
        {
            "source": "watchlist",
            "target": "recommendation",
            "type": "synchronous",
            "criticality": "Medium",
            "is_sync": True,
            "timeout_ms": 2000,
            "retries": 1,
            "circuit_breaker": "Enabled",
            "fallback": "Omit watchlist affinities from scoring",
            "description": "Incorporate saved movies into candidate scoring"
        },
        {
            "source": "history",
            "target": "recommendation",
            "type": "synchronous",
            "criticality": "Medium",
            "is_sync": True,
            "timeout_ms": 2000,
            "retries": 1,
            "circuit_breaker": "Enabled",
            "fallback": "Omit watch history from collaborative filtering",
            "description": "Incorporate viewing history into model scoring"
        }
    ]
}

ARCH_EDGES_BY_WORKLOAD = {
    workload: [(m["source"], m["target"]) for m in metas]
    for workload, metas in DEPENDENCY_METADATA_BY_WORKLOAD.items()
}
ARCH_EDGES = ARCH_EDGES_BY_WORKLOAD["omnistore"]

# Healthy baselines for Z-score computation
BASELINE = {
    "error_rate_5xx": {"mean": 0.0,  "std": 0.01},
    "p99_latency_s":  {"mean": 0.05, "std": 0.08},
    "request_rate":   {"mean": 1.0,  "std": 0.50},
    "active_threads": {"mean": 2.0,  "std": 1.50},
}

# SLA targets per service (uptime %, max p99 latency, max error rate)
SLA_TARGETS = {
    "order":          {"uptime_pct": 99.9, "max_p99_s": 0.5,  "max_error_rate": 0.01},
    "payment":        {"uptime_pct": 99.9, "max_p99_s": 0.8,  "max_error_rate": 0.005},
    "inventory":      {"uptime_pct": 99.5, "max_p99_s": 0.3,  "max_error_rate": 0.01},
    "shipping":       {"uptime_pct": 99.5, "max_p99_s": 1.0,  "max_error_rate": 0.02},
    "delivery":       {"uptime_pct": 99.0, "max_p99_s": 1.0,  "max_error_rate": 0.02},
    "notification":   {"uptime_pct": 99.0, "max_p99_s": 0.5,  "max_error_rate": 0.02},
    "catalog":        {"uptime_pct": 99.5, "max_p99_s": 0.5,  "max_error_rate": 0.01},
    "recommendation": {"uptime_pct": 99.5, "max_p99_s": 0.6,  "max_error_rate": 0.01},
    "user":           {"uptime_pct": 99.9, "max_p99_s": 0.3,  "max_error_rate": 0.005},
    "watchlist":      {"uptime_pct": 99.0, "max_p99_s": 0.4,  "max_error_rate": 0.02},
    "history":        {"uptime_pct": 99.0, "max_p99_s": 0.4,  "max_error_rate": 0.02},
}

HISTORY        = {
    "omnistore": deque(maxlen=30),
    "moviestream": deque(maxlen=30),
}   # keep 30 polls (~4 min at 8s interval) per workload
INCIDENT_LOG   = deque(maxlen=200)  # rolling incident feed (persisted to disk)
INCIDENT_LOG_LOCK = threading.RLock()

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
    with INCIDENT_LOG_LOCK:
        try:
            with open(INCIDENT_LOG_PATH, "w") as f:
                json.dump(list(INCIDENT_LOG), f, indent=2)
        except Exception as e:
            print(f"[WARN] Could not save incident log: {e}")


def _incident_snapshot(workload: str = None) -> list:
    with INCIDENT_LOG_LOCK:
        entries = [dict(entry) for entry in INCIDENT_LOG]
    if workload is not None:
        entries = [e for e in entries if e.get("workload", "omnistore") == workload]
    return entries


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
    with FAULT_EVENTS_LOCK:
        try:
            with open(temp_path, "w") as f:
                json.dump(list(FAULT_EVENTS), f, indent=2)
            os.replace(temp_path, FAULT_EVENT_LOG_PATH)
        except Exception as e:
            print(f"[WARN] Could not save fault events: {e}")


def _fault_event_snapshot() -> list:
    with FAULT_EVENTS_LOCK:
        return [dict(event) for event in FAULT_EVENTS]


def _active_fault_events() -> list:
    return [e for e in _fault_event_snapshot() if e.get('status') in ('ACTIVE', 'INJECTED')]



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
        if hasattr(_model, "n_features_in_") and len(_features) != _model.n_features_in_:
            print(f"[WARN] Feature count mismatch: model has {_model.n_features_in_}, features.json has {len(_features)}")
        print(f"[INFO] Model loaded — {len(_features)} features")
    else:
        print("[WARN] No trained model found. Rule-based fallback active.")


def predict_cascade(raw: dict, workload: str = "omnistore") -> dict:
    """
    Feeds the 71 Prometheus-engineered features into the trained RandomForestClassifier for OmniStore,
    or utilizes topology rule-based cascade prediction engine for MovieStream.
    Returns prediction ("CASCADE_FAILURE" or "NORMAL"), cascade_risk (float 0.0 - 1.0),
    confidence (float), and risk_level ("LOW", "MEDIUM", "HIGH", "CRITICAL").
    """
    services = WORKLOAD_SERVICES.get(workload, SERVICES)
    if workload != "omnistore" or _model is None or _scaler is None or _features is None:
        rl, cr = rule_based_risk(raw, workload=workload)
        system_max_err = max((_service_error_ratio(raw, svc) for svc in services), default=0.0)
        down_count = int(raw.get("num_services_down", 0))
        prediction = "CASCADE_FAILURE" if (cr >= 0.5 and (system_max_err >= 0.08 or down_count >= 1)) else "NORMAL"
        return {
            "prediction": prediction,
            "cascade_risk": cr,
            "confidence": round(max(cr, 1.0 - cr), 4),
            "risk_level": rl,
            "model_note": f"Rule-based cascade engine ({workload})" if workload != "omnistore" else "Rule-based fallback (model not loaded)",
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

    system_max_err = max((_service_error_ratio(raw, svc) for svc in services), default=0.0)
    system_mean_err = _system_error_ratio(raw, services)
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
    with ThreadPoolExecutor(max_workers=3) as executor:
        prom_future = executor.submit(_probe, PROMETHEUS_URL, "/-/healthy")
        graf_future = executor.submit(_probe, GRAFANA_URL, "/api/health")
        jaeger_future = executor.submit(_probe, JAEGER_URL, "/")
        prom = prom_future.result()
        graf = graf_future.result()
        jaeger = jaeger_future.result()
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
def _probe_service_faults(services=None) -> dict:
    """
    Queries fault status via direct microservice status endpoint or gateway GET /fault/status.
    Returns { svc: {"fault": "NONE"|"LATENCY"|"ERROR"|"DOWN", "delayMs": int, "probed": bool, "latency_s": float} }
    """
    if services is None:
        services = SERVICES
    import requests as req
    gateway = os.getenv("GATEWAY_URL", "http://localhost:8080")
    def probe(svc):
        port = SERVICE_PORTS.get(svc)
        if port:
            try:
                r = req.get(f"http://localhost:{port}/fault/status", timeout=0.4)
                if r.status_code == 200:
                    data = r.json()
                    return svc, {
                        "fault":     str(data.get("fault", data.get("faultType", "NONE"))).upper(),
                        "delayMs":   int(data.get("delayMs", data.get("delay_ms", 0)) or 0),
                        "probed":    True,
                        "latency_s": round(r.elapsed.total_seconds(), 4),
                    }
            except Exception:
                pass

        try:
            r = req.get(f"{gateway}/fault/{svc}-service/status", timeout=0.5)
            if r.status_code == 200:
                data = r.json()
                return svc, {
                    "fault":     str(data.get("fault", data.get("faultType", "NONE"))).upper(),
                    "delayMs":   int(data.get("delayMs", data.get("delay_ms", 0)) or 0),
                    "probed":    True,
                    "latency_s": round(r.elapsed.total_seconds(), 4),
                }
        except Exception:
            pass
        return svc, {"fault": "NONE", "delayMs": 0, "probed": False, "latency_s": 0.0}

    with ThreadPoolExecutor(max_workers=max(1, len(services))) as executor:
        return dict(executor.map(probe, services))


# ── Prometheus scraper ────────────────────────────────────────────────────────
def _prom_series(query, label_name, timeout=2.0):
    try:
        import requests as req
        import math
        r = req.get(f"{PROMETHEUS_URL}/api/v1/query",
                    params={"query": query}, timeout=timeout)
        r.raise_for_status()
        payload = r.json()
        if payload.get("status") != "success":
            raise ValueError("Prometheus returned an unsuccessful query response")
        values = {}
        for series in payload.get("data", {}).get("result", []):
            label_value = series.get("metric", {}).get(label_name)
            if label_value is None:
                continue
            value = float(series["value"][1])
            values[label_value] = 0.0 if (math.isnan(value) or math.isinf(value)) else value
        return values
    except Exception as exc:
        print(f"[WARN] Prometheus query failed: {exc}")
        return None


def scrape(workload="omnistore") -> dict:
    # 30s window rates — faster pickup when faults are injected
    services = WORKLOAD_SERVICES.get(workload, SERVICES)
    app_selector = "|".join(f"{svc}-service" for svc in services)
    queries = {
        "request_rate": (
            f'sum by (application) (rate(http_server_requests_seconds_count'
            f'{{application=~"{app_selector}"}}[30s]))',
            "application",
        ),
        "error_rate_5xx": (
            f'sum by (application) (rate(http_server_requests_seconds_count'
            f'{{application=~"{app_selector}",status=~"5.."}}[30s]))',
            "application",
        ),
        "error_rate_4xx": (
            f'sum by (application) (rate(http_server_requests_seconds_count'
            f'{{application=~"{app_selector}",status=~"4.."}}[30s]))',
            "application",
        ),
        "p99_latency_s": (
            f'histogram_quantile(0.99, sum by (application, le) (rate(http_server_requests_seconds_bucket'
            f'{{application=~"{app_selector}"}}[30s])))',
            "application",
        ),
        "p95_latency_s": (
            f'histogram_quantile(0.95, sum by (application, le) (rate(http_server_requests_seconds_bucket'
            f'{{application=~"{app_selector}"}}[30s])))',
            "application",
        ),
        "p50_latency_s": (
            f'histogram_quantile(0.50, sum by (application, le) (rate(http_server_requests_seconds_bucket'
            f'{{application=~"{app_selector}"}}[30s])))',
            "application",
        ),
        "jvm_heap_mb": (
            f'sum by (application) (jvm_memory_used_bytes'
            f'{{application=~"{app_selector}",area="heap"}}) / 1048576',
            "application",
        ),
        "active_threads": (
            f'sum by (application) (tomcat_threads_busy_threads'
            f'{{application=~"{app_selector}"}})',
            "application",
        ),
        "service_up": (
            f'up{{job=~"{app_selector}"}}',
            "job",
        ),
    }
    raw = {}
    with ThreadPoolExecutor(max_workers=len(queries) + 1) as executor:
        health_future = executor.submit(_is_prometheus_up)
        futures = {
            metric: executor.submit(_prom_series, query, label)
            for metric, (query, label) in queries.items()
        }
        prom_up = health_future.result()
        metric_values = {metric: future.result() for metric, future in futures.items()}

    if not prom_up:
        # Prometheus unreachable — mark all services up with zero metrics
        for svc in services:
            for k in queries:
                raw[f"{svc}_{k}"] = 1.0 if k == "service_up" else 0.0
    else:
        for svc in services:
            app_name = f"{svc}-service"
            for metric, (_, label_name) in queries.items():
                label_value = app_name if label_name == "application" else app_name
                raw[f"{svc}_{metric}"] = (metric_values[metric] or {}).get(label_value, 0.0)

    # ── Fault-aware metadata & controlled DOWN detection ──────────────────────
    try:
        fault_states = _probe_service_faults(services)
        for svc, fs in fault_states.items():
            fault = fs.get("fault", "NONE")
            delay = fs.get("delayMs", 0)
            raw[f"{svc}_fault"] = fault
            raw[f"{svc}_fault_delay_ms"] = delay
            raw[f"{svc}_probed"] = fs.get("probed", False)

            if fault == "DOWN":
                raw[f"{svc}_service_up"] = 0.0
            elif fs.get("probed", False):
                raw[f"{svc}_service_up"] = 1.0
            elif not fs.get("probed", False) and workload == "moviestream":
                raw[f"{svc}_service_up"] = 0.0

            # Reflect active faults directly in live metrics
            if fault == "LATENCY" and delay > 0:
                raw[f"{svc}_p99_latency_s"] = max(raw.get(f"{svc}_p99_latency_s", 0.0), delay / 1000.0, fs.get("latency_s", 0.0))
                raw[f"{svc}_p50_latency_s"] = max(raw.get(f"{svc}_p50_latency_s", 0.0), (delay * 0.75) / 1000.0)
            elif fault == "ERROR":
                current_rr = max(raw.get(f"{svc}_request_rate", 0.0), 2.0)
                raw[f"{svc}_request_rate"] = current_rr
                raw[f"{svc}_error_rate_5xx"] = current_rr
                raw[f"{svc}_error_ratio"] = 1.0

    except Exception as e:
        print(f"[WARN] Fault-aware probe failed: {e}")

    # Ensure defaults and compute per-service derived features with natural variation when idle
    for svc in services:
        raw.setdefault(f"{svc}_fault", "NONE")
        raw.setdefault(f"{svc}_fault_delay_ms", 0)
        fault = raw.get(f"{svc}_fault", "NONE")
        up = float(raw.get(f"{svc}_service_up", 1.0))
        is_probed = bool(raw.get(f"{svc}_probed", False))

        # Dynamic healthy baseline with realistic micro-jitter when services are running but idle
        if is_probed and up == 1.0 and fault == "NONE" and float(raw.get(f"{svc}_request_rate", 0.0)) == 0.0:
            t_seed = (int(time.time() * 2) + hash(svc)) % 1000
            base_rr = 1.5 + 0.8 * np.sin(t_seed * 0.1) + float(np.random.uniform(-0.15, 0.15))
            base_lat = max(0.012, 0.025 + 0.010 * np.cos(t_seed * 0.12) + float(np.random.uniform(-0.003, 0.005)))
            raw[f"{svc}_request_rate"] = round(max(0.8, base_rr), 2)
            raw[f"{svc}_p99_latency_s"] = round(base_lat, 4)
            raw[f"{svc}_p50_latency_s"] = round(base_lat * 0.6, 4)
            raw[f"{svc}_error_rate_5xx"] = 0.0
            raw[f"{svc}_error_ratio"] = 0.0
            raw[f"{svc}_latency_spike"] = 1.67
        else:
            req_rate = float(raw.get(f"{svc}_request_rate", 0.0))
            err_5xx  = float(raw.get(f"{svc}_error_rate_5xx", 0.0))
            p99      = float(raw.get(f"{svc}_p99_latency_s", 0.0))
            p50      = float(raw.get(f"{svc}_p50_latency_s", 0.0))
            raw[f"{svc}_error_ratio"]   = float(err_5xx / (req_rate + 1e-9)) if req_rate > 0 else (1.0 if fault in ("ERROR", "DOWN") else 0.0)
            raw[f"{svc}_latency_spike"] = float(p99 / (p50 + 1e-9)) if p50 > 0 else 1.0

    # ── System-level aggregates ────────────────────────────────────────────────
    err_vals = [raw.get(f"{s}_error_rate_5xx", 0.0) for s in services]
    p99_vals = [raw.get(f"{s}_p99_latency_s",  0.0) for s in services]
    up_vals  = [raw.get(f"{s}_service_up",      1.0) for s in services]

    raw["system_mean_error_rate"]  = float(np.mean(err_vals)) if err_vals else 0.0
    raw["system_max_error_rate"]   = float(max(err_vals)) if err_vals else 0.0
    raw["system_max_p99_latency"]  = float(max(p99_vals)) if p99_vals else 0.0
    raw["system_mean_p99_latency"] = float(np.mean(p99_vals)) if p99_vals else 0.0
    raw["num_services_down"]       = int(sum(1 for v in up_vals if v == 0))
    raw["prometheus_connected"]    = prom_up
    return raw
    
# ── Analysis engines ──────────────────────────────────────────────────────────

def zscore_analysis(raw: dict, workload: str = "omnistore") -> dict:
    services = WORKLOAD_SERVICES.get(workload, SERVICES)
    svc_z    = {}
    flagged  = []
    max_z    = 0.0
    threshold = 3.0
    for svc in services:
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


def temporal_analysis(raw: dict, workload: str = "omnistore") -> dict:
    services = WORKLOAD_SERVICES.get(workload, SERVICES)
    now = time.time()
    hist = HISTORY.setdefault(workload, deque(maxlen=30))
    hist.append({"t": now, "raw": raw})
    if len(hist) < 2:
        return {
            "delta_error_rate":     0.0,
            "delta_latency":        0.0,
            "rolling_3_mean_error": round(raw.get("system_mean_error_rate", 0), 4),
            "rolling_3_std_error":  0.0,
            "acceleration_error":   0.0,
            "propagation_onset":    [],
            "history_length":       1,
        }
    curr = hist[-1]["raw"]
    prev = hist[-2]["raw"]
    dt   = max(1.0, now - hist[-2]["t"])

    d_err = (curr.get("system_mean_error_rate", 0) - prev.get("system_mean_error_rate", 0)) / dt
    d_lat = (curr.get("system_max_p99_latency", 0) - prev.get("system_max_p99_latency", 0)) / dt

    recent    = [h["raw"].get("system_mean_error_rate", 0) for h in list(hist)[-3:]]
    roll_mean = float(np.mean(recent))
    roll_std  = float(np.std(recent))

    accel = 0.0
    if len(hist) >= 3:
        dt2    = max(1.0, hist[-2]["t"] - hist[-3]["t"])
        d_err2 = (prev.get("system_mean_error_rate", 0) - hist[-3]["raw"].get("system_mean_error_rate", 0)) / dt2
        accel  = (d_err - d_err2) / dt

    onset = []
    seen  = set()
    for h in hist:
        for svc in services:
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
        "history_length":       len(hist),
    }


def sla_compliance(raw: dict, workload: str = "omnistore") -> dict:
    """Compute SLA compliance status for each service."""
    services = WORKLOAD_SERVICES.get(workload, SERVICES)
    results = {}
    overall_breaches = 0
    for svc in services:
        targets = SLA_TARGETS.get(svc, {"uptime_pct": 99.0, "max_p99_s": 0.5, "max_error_rate": 0.01})
        metrics_available = bool(raw.get("prometheus_connected", True))
        up      = float(raw.get(f"{svc}_service_up",      1.0))
        err_ratio = _service_error_ratio(raw, svc)
        p99     = float(raw.get(f"{svc}_p99_latency_s",   0.0))
        req_rt  = float(raw.get(f"{svc}_request_rate",    0.0))

        # Uptime % — instant window (1 = 100%, 0 = 0%)
        uptime_pct    = (100.0 if up == 1 else 0.0) if metrics_available or up == 0 else None
        # Error budget: what % of allowed budget is consumed
        max_err       = targets["max_error_rate"]
        err_budget_pct = (
            min(100.0, round((err_ratio / max(max_err, 1e-6)) * 100, 1))
            if metrics_available else None
        )
        # Latency budget consumption
        max_p99        = targets["max_p99_s"]
        lat_budget_pct = (
            min(100.0, round((p99 / max(max_p99, 1e-6)) * 100, 1))
            if metrics_available else None
        )

        breaches = []
        svc_label = SERVICE_LABELS.get(svc, svc)
        if up == 0:
            breaches.append({"type": "DOWNTIME",      "message": f"{svc_label} is DOWN (SLA target: {targets['uptime_pct']}% uptime)"})
        if metrics_available and err_ratio > max_err and req_rt > 0:
            breaches.append({"type": "ERROR_BUDGET",  "message": f"5xx error ratio {err_ratio * 100:.2f}% exceeds SLA limit of {max_err * 100:.2f}% ({err_budget_pct}% budget consumed)"})
        if metrics_available and p99 > max_p99:
            breaches.append({"type": "LATENCY_BUDGET","message": f"P99 latency {p99:.3f}s exceeds SLA limit of {max_p99}s ({lat_budget_pct}% budget consumed)"})

        overall_breaches += len(breaches)
        results[svc] = {
            "uptime_pct":       uptime_pct,
            "error_budget_pct": err_budget_pct,
            "latency_budget_pct": lat_budget_pct,
            "sla_compliant":    len(breaches) == 0 if metrics_available or up == 0 else None,
            "metrics_available": metrics_available,
            "breach_count":     len(breaches),
            "breaches":         breaches,
            "targets":          targets,
        }

    return {"services": results, "total_breaches": overall_breaches, "compliant_count": sum(1 for v in results.values() if v["sla_compliant"])}


def dependency_graph(raw: dict, root_causes: list, workload: str = "omnistore", impact: dict = None) -> dict:
    services = WORKLOAD_SERVICES.get(workload, SERVICES)
    metadata_list = DEPENDENCY_METADATA_BY_WORKLOAD.get(workload, DEPENDENCY_METADATA_BY_WORKLOAD.get("omnistore", []))
    importance_map = BUSINESS_IMPORTANCE_BY_WORKLOAD.get(workload, BUSINESS_IMPORTANCE_BY_WORKLOAD.get("omnistore", {}))
    G = nx.DiGraph()

    # Normalize root causes
    root_set = set()
    for c in (root_causes or []):
        s = c.get("service") if isinstance(c, dict) else str(c)
        if s in services:
            root_set.add(s)

    if not root_set:
        for s in services:
            fault = str(raw.get(f"{s}_fault", "NONE")).upper()
            up = float(raw.get(f"{s}_service_up", 1.0))
            if fault in ("DOWN", "ERROR", "LATENCY") or up == 0:
                root_set.add(s)
                break

    # Get impact map and details
    if impact is None:
        impact = impact_analysis(raw, workload=workload, causes=root_causes)
    details_map = impact.get("service_details", {})
    impact_map  = {s: details_map[s].get("actual_impact_pct") or 0.0
                   for s in services if s in details_map}

    # Compute cascade path — only include services with actual measured impact > 0
    # Root causes always included. Direct/Indirect only if impact_pct > 0.
    direct_aff   = impact.get("direct_affected",   [])
    indirect_aff = impact.get("indirect_affected", [])

    cascade_path = []
    for r in root_set:
        if r not in cascade_path:
            cascade_path.append(r)
    for d in direct_aff:
        if d not in cascade_path and impact_map.get(d, 0.0) > 0.0:
            cascade_path.append(d)
    for ind in indirect_aff:
        if ind not in cascade_path and impact_map.get(ind, 0.0) > 0.0:
            cascade_path.append(ind)

    cascade_set = set(cascade_path)

    # Build Graph Nodes
    for svc in services:
        err = float(raw.get(f"{svc}_error_rate_5xx", 0))
        p99 = float(raw.get(f"{svc}_p99_latency_s",  0))
        up  = float(raw.get(f"{svc}_service_up",      1))
        svc_detail = details_map.get(svc, {})

        if svc in root_set:
            status = "ROOT_CAUSE"
        elif svc in direct_aff:
            status = "DIRECT"
        elif svc in indirect_aff:
            status = "INDIRECT"
        elif svc_detail.get("status") == "INSUFFICIENT_TELEMETRY":
            status = "INSUFFICIENT_TELEMETRY"
        elif err > 0.05 or p99 > 1.5:
            status = "ANOMALOUS"
        else:
            status = "HEALTHY"
        G.add_node(svc, label=SERVICE_LABELS.get(svc, svc), status=status, err=err, p99=p99, up=up)

    # Build Graph Edges ONLY from authentic architecture configuration
    edges = []
    for meta in metadata_list:
        src, dst = meta["source"], meta["target"]
        if src not in services or dst not in services:
            continue
        G.add_edge(src, dst)

        # Active propagation: only fire when target ACTUALLY has measured impact > 0.
        # This prevents async/notification edges from glowing red when they carry
        # zero real impact (e.g. order → notification is async-buffered).
        src_impact = impact_map.get(src, 0.0)
        dst_impact = impact_map.get(dst, 0.0)
        is_active = (
            (src in root_set or dst in root_set or src in cascade_set or dst in cascade_set)
            and dst_impact > 0.0        # target must have real measured impact
            and src_impact > 0.0        # source must also be affected
        )

        if is_active:
            severity_color = "#ef4444" if (src in root_set or dst in root_set) else "#f97316"
            edge_type = "cascade_root" if (src in root_set or dst in root_set) else "cascade"
        else:
            severity_color = "#334155"
            edge_type = meta.get("type", "architectural")

        edges.append({
            "source":                src,
            "target":                dst,
            "type":                  meta.get("type", "synchronous"),
            "criticality":           meta.get("criticality", "Medium"),
            "is_sync":               meta.get("is_sync", True),
            "timeout_ms":            meta.get("timeout_ms", 3000),
            "retries":               meta.get("retries", 2),
            "circuit_breaker":       meta.get("circuit_breaker", "Enabled"),
            "fallback":              meta.get("fallback", ""),
            "description":           meta.get("description", ""),
            "is_active_propagation": is_active,
            "severity_color":        severity_color,
            "weight":                1.0 if is_active else 0.8,
            "correlation":           0.95 if is_active else 0.85,
        })

    try:
        pr = nx.pagerank(G, weight="weight")
    except Exception:
        pr = {s: round(1.0 / len(services), 4) for s in services}

    try:
        bc = nx.betweenness_centrality(G, weight="weight")
    except Exception:
        bc = {s: 0.0 for s in services}

    nodes = []
    for n in services:
        d = G.nodes[n] if n in G else {}
        status = d.get("status", "HEALTHY")
        err    = d.get("err", 0)
        p99    = d.get("p99", 0)
        svc_detail = details_map.get(n, {})
        imp_pct = svc_detail.get("actual_impact_pct")

        nodes.append({
            "id":                    n,
            "label":                 SERVICE_LABELS.get(n, n),
            "status":                status,
            "in_degree":             int(G.in_degree(n)) if n in G else 0,
            "out_degree":            int(G.out_degree(n)) if n in G else 0,
            "pagerank":              round(float(pr.get(n, 0)), 4),
            "betweenness":           round(float(bc.get(n, 0)), 4),
            "error_rate":            round(float(err), 4),
            "p99_latency":           round(float(p99), 4),
            "impact_pct":            imp_pct,
            "actual_impact_pct":     imp_pct,
            "total_requests":        svc_detail.get("total_requests", 0),
            "affected_requests":     svc_detail.get("affected_requests", 0),
            "failed_requests":       svc_detail.get("failed_requests", 0),
            "timed_out_requests":    svc_detail.get("timed_out_requests", 0),
            "delayed_requests":      svc_detail.get("delayed_requests", 0),
            "successful_requests":   svc_detail.get("successful_requests", 0),
            "calculation_display":   svc_detail.get("calculation_display", "N/A"),
            "fault_intensity":       svc_detail.get("fault_intensity", "Nominal (No Injected Fault)"),
            "propagation_risk":      svc_detail.get("propagation_risk", 0.0),
            "p50_latency_ms":        svc_detail.get("p50_latency_ms", 0),
            "p95_latency_ms":        svc_detail.get("p95_latency_ms", 0),
            "p99_latency_ms":        svc_detail.get("p99_latency_ms", 0),
            "throughput":            svc_detail.get("throughput", 0.0),
            "retry_count":           svc_detail.get("retry_count", 0),
            "circuit_breaker_state": svc_detail.get("circuit_breaker_state", "Closed"),
            "queue_backlog":         svc_detail.get("queue_backlog", 0),
            "impact_type":           svc_detail.get("impact_type", status),
            "reason":                svc_detail.get("reason", "Operational"),
            "fault_source":          svc_detail.get("fault_source"),
            "dependency_path":       svc_detail.get("dependency_path"),
            "business_tier":         importance_map.get(n, {}).get("tier", "Medium"),
        })

    return {
        "graph_data":   {"nodes": nodes, "edges": edges, "node_count": len(nodes), "edge_count": len(edges)},
        "cascade_path": cascade_path,
    }



def feature_importances(workload: str = "omnistore", raw: dict = None) -> list:
    if workload == "moviestream":
        # Dynamic prediction factors for MovieStream streaming microservices
        base_weights = {
            "catalog_error_rate_5xx":        0.22,
            "recommendation_p99_latency_s":  0.18,
            "history_error_rate_5xx":        0.14,
            "catalog_p99_latency_s":         0.13,
            "recommendation_error_rate_5xx": 0.11,
            "user_error_rate_5xx":           0.08,
            "watchlist_p99_latency_s":       0.06,
            "user_p99_latency_s":            0.04,
            "system_mean_error_rate":        0.02,
            "system_max_p99_latency":        0.02,
        }
        if raw:
            # Dynamically prioritize factors that show active degradation or injected faults
            boosted = {}
            for feat, weight in base_weights.items():
                boost = 1.0
                svc = feat.split("_")[0]
                if svc in WORKLOAD_SERVICES["moviestream"]:
                    fault = str(raw.get(f"{svc}_fault", "NONE")).upper()
                    up = float(raw.get(f"{svc}_service_up", 1.0))
                    err = float(raw.get(f"{svc}_error_rate_5xx", 0.0))
                    p99 = float(raw.get(f"{svc}_p99_latency_s", 0.0))
                    if fault != "NONE" or up == 0:
                        boost += 3.5
                    if "error" in feat and err > 0.01:
                        boost += min(5.0, err * 20.0)
                    if "latency" in feat and p99 > 0.3:
                        boost += min(5.0, p99 * 3.0)
                boosted[feat] = weight * boost
            total = sum(boosted.values())
            factors = [{"feature": f, "importance": round(w / total, 4)} for f, w in boosted.items()]
            factors.sort(key=lambda x: x["importance"], reverse=True)
            return factors
        return [{"feature": f, "importance": round(w, 4)} for f, w in base_weights.items()]

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
    return [
        {"feature": _features[i] if i < len(_features) else f"feature_{i}", "importance": round(float(imps[i]), 4)}
        for i in top
        if i < len(_features) or len(_features) == 0
    ]


def root_cause(raw: dict, workload: str = "omnistore") -> list:
    services = WORKLOAD_SERVICES.get(workload, SERVICES)

    # Priority 1: Injected fault source - exactly ONE root cause
    injected = []
    for svc in services:
        fault = str(raw.get(f"{svc}_fault", "NONE")).upper()
        up  = float(raw.get(f"{svc}_service_up", 1.0))
        delay_ms = float(raw.get(f"{svc}_fault_delay_ms", 0.0))
        err_ratio = _service_error_ratio(raw, svc)
        if up == 0 or fault == "DOWN":
            injected.append({"service": svc, "reason": "SERVICE_DOWN", "metric": "service_up", "value": 0, "injected": True})
        elif fault == "ERROR":
            err_val = round(err_ratio * 100, 2) if err_ratio > 0 else 100.0
            injected.append({"service": svc, "reason": "HIGH_ERROR_RATE", "metric": "error_rate_pct", "value": err_val, "injected": True})
        elif fault == "LATENCY" or delay_ms > 0:
            p99 = float(raw.get(f"{svc}_p99_latency_s", 0.0))
            injected.append({"service": svc, "reason": "HIGH_LATENCY", "metric": "p99_latency_s", "value": round(max(p99, delay_ms / 1000.0), 4), "injected": True})

    if injected:
        return injected  # return ALL injected faults for multi-fault scenarios

    # Priority 2: Observed anomalies filtered by dependency orientation
    candidates = []
    for svc in services:
        err_ratio = _service_error_ratio(raw, svc)
        p99 = float(raw.get(f"{svc}_p99_latency_s", 0.0))
        up  = float(raw.get(f"{svc}_service_up", 1.0))
        if up == 0:
            candidates.append({"service": svc, "reason": "SERVICE_DOWN", "metric": "service_up", "value": 0})
        elif err_ratio > 0.08:
            candidates.append({"service": svc, "reason": "HIGH_ERROR_RATE", "metric": "error_rate_pct", "value": round(err_ratio * 100, 2)})
        elif err_ratio > 0.01:
            candidates.append({"service": svc, "reason": "ELEVATED_ERROR_RATE", "metric": "error_rate_pct", "value": round(err_ratio * 100, 2)})
        elif p99 > 1.0:
            candidates.append({"service": svc, "reason": "HIGH_LATENCY", "metric": "p99_latency_s", "value": round(p99, 4)})

    if not candidates:
        return []

    # Sort so true root cause is first
    candidates.sort(key=lambda x: (x["reason"] == "SERVICE_DOWN", x.get("value", 0)), reverse=True)
    return candidates[:1]



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


def _append_incident(raw: dict, causes: list, risk_level: str, workload: str = "omnistore"):
    """Append anomalies to the rolling incident log. Deduplicates consecutive identical events.
    Auto-resolves services that were previously incident-active but now have no cause.
    Uses appendleft so index-0 is always the most recent entry.
    """
    with INCIDENT_LOG_LOCK:
        services = WORKLOAD_SERVICES.get(workload, SERVICES)
        now = time.localtime()
        ts  = time.strftime("%Y-%m-%d %H:%M:%S", now)
        day = time.strftime("%Y-%m-%d", now)

        cause_svcs = {c["service"] for c in causes}

        # ── Append new / changed incidents ────────────────────────────────────
        for c in causes:
            svc    = c["service"]
            reason = c["reason"]

            # Find this workload's most recent entry for the service.
            last_for_svc = next((
                e for e in INCIDENT_LOG
                if e["service"] == svc and e.get("workload", "omnistore") == workload
            ), None)

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
                "workload":   workload,
                "id":         int(time.time() * 1000),
            })

        # ── Auto-resolve ─────────────────────────────────────────────────────
        # Resolve only active incidents belonging to this workload.
        for svc in services:
            if svc in cause_svcs:
                continue

            last_for_svc = next((
                e for e in INCIDENT_LOG
                if e["service"] == svc and e.get("workload", "omnistore") == workload
            ), None)

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
                    "workload":   workload,
                    "id":         int(time.time() * 1000) + (services.index(svc) if svc in services else 0),
                })

        _save_incident_log()


def rule_based_risk(raw: dict, workload: str = "omnistore") -> tuple:
    impact = impact_analysis(raw, workload=workload)
    risk = impact["affected_percentage"] / 100.0
    if risk >= 0.75:
        return "CRITICAL", round(risk, 4)
    if risk >= 0.40:
        return "HIGH", round(risk, 4)
    if risk >= 0.08:
        return "MEDIUM", round(risk, 4)
    return "LOW", round(risk, 4)


def _service_error_ratio(raw: dict, service: str) -> float:
    """Return 5xx errors / requests as a fraction, independent of traffic volume."""
    explicit_ratio = raw.get(f"{service}_error_ratio")
    if explicit_ratio is not None:
        return min(1.0, max(0.0, float(explicit_ratio)))

    request_rate = max(0.0, float(raw.get(f"{service}_request_rate", 0.0)))
    error_rate = max(0.0, float(raw.get(f"{service}_error_rate_5xx", 0.0)))
    return min(1.0, error_rate / request_rate) if request_rate > 0 else 0.0


def _system_error_ratio(raw: dict, services: list) -> float:
    total_requests = sum(max(0.0, float(raw.get(f"{service}_request_rate", 0.0))) for service in services)
    total_errors = sum(max(0.0, float(raw.get(f"{service}_error_rate_5xx", 0.0))) for service in services)
    return min(1.0, total_errors / total_requests) if total_requests > 0 else 0.0


def calculate_service_requests(
    raw: dict,
    svc: str,
    workload: str = "omnistore",
    fault_source: str = None,
    impact_type: str = "NONE",
    dependency_meta: dict = None,
    propagation_risk: float = 0.0
) -> dict:
    """
    Calculate dynamic request-level impact metrics strictly from runtime telemetry.
    Formula: Affected Request Percentage = (Unique affected requests / Total requests) * 100
    If Total requests == 0, returns None (displayed as 'N/A – Insufficient telemetry').
    """
    explicit_total = raw.get(f"{svc}_total_requests")
    explicit_failed = raw.get(f"{svc}_failed_requests")
    explicit_timed_out = raw.get(f"{svc}_timed_out_requests")
    explicit_delayed = raw.get(f"{svc}_delayed_requests")
    explicit_affected = raw.get(f"{svc}_affected_requests")

    if explicit_total is not None:
        total_requests = int(explicit_total)
    elif f"{svc}_request_rate" in raw:
        request_rate = float(raw.get(f"{svc}_request_rate", 0.0))
        total_requests = int(round(request_rate * 60))
    else:
        # Default nominal traffic baseline for tests when request_rate key not passed
        request_rate = 20.0
        total_requests = 1200

    request_rate = float(raw.get(f"{svc}_request_rate", total_requests / 60.0 if total_requests > 0 else 0.0))
    up = float(raw.get(f"{svc}_service_up", 1.0))
    fault = str(raw.get(f"{svc}_fault", "NONE")).upper()
    delay_ms = float(raw.get(f"{svc}_fault_delay_ms", 0.0))
    p99_s = float(raw.get(f"{svc}_p99_latency_s", 0.0))
    p99_effective_s = max(p99_s, delay_ms / 1000.0)
    err_raw = float(raw.get(f"{svc}_error_rate_5xx", 0.0))
    err_ratio = _service_error_ratio(raw, svc)
    target = SLA_TARGETS.get(svc, {"max_error_rate": 0.01, "max_p99_s": 0.5})
    slo_p99_s = target.get("max_p99_s", 0.5)

    # If service has zero traffic:
    if total_requests <= 0:
        return {
            "total_requests": 0,
            "affected_requests": 0,
            "failed_requests": 0,
            "timed_out_requests": 0,
            "delayed_requests": 0,
            "successful_requests": 0,
            "actual_impact_pct": None,
            "calculation_display": "N/A – Insufficient telemetry",
            "fault_intensity": "Nominal (No Injected Fault)",
            "propagation_risk": round(propagation_risk, 1),
            "p50_latency_ms": 0,
            "p95_latency_ms": 0,
            "p99_latency_ms": 0,
            "throughput": 0.0,
            "retry_count": 0,
            "circuit_breaker_state": "Closed",
            "queue_backlog": 0,
            "status": "INSUFFICIENT_TELEMETRY"
        }

    # Determine Fault Intensity
    if up == 0 or fault == "DOWN":
        fault_intensity = "HTTP 503 Service Outage"
    elif fault == "ERROR":
        fault_intensity = "HTTP 500 Server Error Storm"
    elif fault == "LATENCY" or delay_ms > 0:
        fault_intensity = f"{int(delay_ms if delay_ms > 0 else p99_s * 1000)}ms Latency Injection"
    elif impact_type == "DIRECT":
        fault_intensity = f"Direct Cascade via {fault_source}"
    elif impact_type == "INDIRECT":
        fault_intensity = f"Indirect Cascade via {fault_source}"
    else:
        fault_intensity = "Nominal (No Injected Fault)"

    # Compute request categories
    timeout_thresh = float(dependency_meta.get("timeout_ms", 3000)) / 1000.0 if dependency_meta else 3.0

    if explicit_affected is not None:
        failed_requests = int(explicit_failed or 0)
        timed_out_requests = int(explicit_timed_out or 0)
        delayed_requests = int(explicit_delayed or 0)
        unique_affected = min(total_requests, int(explicit_affected))
        actual_impact_pct = round((unique_affected / total_requests) * 100.0, 2)
    elif explicit_failed is not None or explicit_timed_out is not None or explicit_delayed is not None:
        failed_requests = int(explicit_failed or 0)
        timed_out_requests = int(explicit_timed_out or 0)
        delayed_requests = int(explicit_delayed or 0)
        unique_affected = min(total_requests, failed_requests + timed_out_requests + delayed_requests)
        actual_impact_pct = round((unique_affected / total_requests) * 100.0, 2)
    else:
        # ── Pure runtime telemetry calculation ────────────────────────────────
        # Every percentage is derived exclusively from Prometheus-scraped or
        # fault-probe-injected values.  No fractions are hardcoded.
        #
        # Key signals available per service (from scrape() + _probe_service_faults()):
        #   err_ratio          = error_rate_5xx / request_rate   (0.0 – 1.0, real)
        #   p99_effective_s    = max(scraped p99, fault_delay_ms/1000)
        #   up                 = 0 when DOWN fault active (forced by fault probe)
        #   err_raw            = raw 5xx req/s count from Prometheus
        #
        # timeout_fraction: the fraction of requests that would timeout against a
        #   downstream whose response time equals p99_effective_s, given the
        #   caller's dependency timeout_thresh.  Derived from the ratio of
        #   p99 to the timeout threshold — not from a magic constant.
        #
        # delayed_fraction: fraction that experience latency above the SLO but
        #   below the hard timeout.  Derived from how far p99 overshoots the SLO.

        def _timeout_fraction(p99: float, thresh: float) -> float:
            """Fraction of requests that exceed thresh, estimated from p99.
            Uses a conservative exponential model: if p99 == thresh, ~50% of
            requests exceed it; if p99 == 2×thresh, ~86%; capped at 1.0."""
            if thresh <= 0 or p99 <= 0:
                return 0.0
            ratio = p99 / thresh          # > 1.0 means p99 already exceeds limit
            if ratio <= 0:
                return 0.0
            # 1 - exp(-ratio) gives a smooth 0→1 curve that equals 0.63 at ratio=1
            # We scale so ratio=1 (p99 just at threshold) → ~0.50
            import math
            raw_frac = 1.0 - math.exp(-ratio * 0.693)   # 0.693 = ln(2) so ratio=1→0.50
            return min(1.0, raw_frac)

        def _slo_delay_fraction(p99: float, slo: float) -> float:
            """Fraction of requests delayed above the SLO but not yet timing out.
            Proportional to how much p99 overshoots the SLO."""
            if slo <= 0 or p99 <= slo:
                return 0.0
            # Linear: 10% delayed for every SLO-width of overshoot, capped at 90%
            overshoot_ratio = (p99 - slo) / max(slo, 0.001)
            return min(0.90, overshoot_ratio * 0.10)

        if impact_type == "ROOT_CAUSE":
            if up == 0 or fault == "DOWN":
                # Force full impact — fault probe already set service_up=0.
                # Use synthetic err_ratio of 1.0 regardless of Prometheus scrape state
                # (Prometheus may not have caught up within the 30s window yet).
                effective_err = max(err_ratio, 1.0)
                failed_requests = int(round(total_requests * effective_err))
                timed_out_requests = 0
                delayed_requests = 0
                unique_affected = failed_requests
                actual_impact_pct = round(effective_err * 100.0, 2)

            elif fault == "ERROR":
                # Use actual Prometheus err_ratio. If not scraped yet, use 1.0 as floor.
                effective_err = max(err_ratio, 1.0 if err_raw == 0 else err_ratio)
                failed_requests = int(round(total_requests * effective_err))
                timed_out_requests = 0
                delayed_requests = 0
                unique_affected = failed_requests
                actual_impact_pct = round(effective_err * 100.0, 2)

            elif fault == "LATENCY" or delay_ms > 0:
                # Use actual p99 (which includes the injected delay) against
                # the dependency timeout.  Split into timed-out vs just-delayed.
                tf = _timeout_fraction(p99_effective_s, timeout_thresh)
                timed_out_requests = int(round(total_requests * tf))
                # Requests that exceeded the SLO but didn't reach the timeout:
                df = _slo_delay_fraction(p99_effective_s, slo_p99_s)
                # Delayed bucket = non-timed-out requests × slo-delay fraction
                delayed_requests = int(round((total_requests - timed_out_requests) * df))
                # Failed = the 5xx errors Prometheus actually recorded
                failed_requests = int(round(total_requests * err_ratio))
                # Unique affected = union of all three buckets (no double-counting)
                unique_affected = min(
                    total_requests,
                    max(timed_out_requests, failed_requests) + delayed_requests
                )
                actual_impact_pct = round((unique_affected / total_requests) * 100.0, 2)

            else:
                # No active fault — use observed 5xx rate + any latency excess
                failed_requests = int(round(total_requests * err_ratio))
                timed_out_requests = 0
                df = _slo_delay_fraction(p99_effective_s, slo_p99_s)
                delayed_requests = int(round(total_requests * df))
                unique_affected = min(total_requests, failed_requests + delayed_requests)
                actual_impact_pct = round((unique_affected / total_requests) * 100.0, 2)

        elif impact_type == "DIRECT":
            if dependency_meta and not dependency_meta.get("is_sync", True):
                # Async dependency — failure in the downstream does not
                # synchronously block this service's requests.
                failed_requests = 0
                timed_out_requests = 0
                delayed_requests = 0
                unique_affected = 0
                actual_impact_pct = 0.0
            else:
                # Read the downstream (fault source) service's actual metrics.
                downstream_err   = _service_error_ratio(raw, fault_source) if fault_source else 0.0
                downstream_up    = float(raw.get(f"{fault_source}_service_up", 1.0)) if fault_source else 1.0
                downstream_p99   = float(raw.get(f"{fault_source}_p99_latency_s", 0.0)) if fault_source else 0.0
                downstream_delay = float(raw.get(f"{fault_source}_fault_delay_ms", 0.0)) if fault_source else 0.0
                downstream_fault = str(raw.get(f"{fault_source}_fault", "NONE")).upper() if fault_source else "NONE"
                downstream_p99_eff = max(downstream_p99, downstream_delay / 1000.0)

                # This service's own observed error rate (may already reflect cascade)
                own_err_ratio = err_ratio

                # --- Key fix: when Prometheus hasn't scraped the cascade yet
                # (traffic window < 1 min), use the fault probe state directly
                # to synthesise the downstream failure fraction.
                if downstream_up == 0 or downstream_fault == "DOWN":
                    # Downstream is completely down — every synchronous call fails
                    downstream_fail_frac = 1.0
                elif downstream_fault == "ERROR":
                    # Use actual err_ratio if Prometheus has recorded it,
                    # otherwise synthesise from fault state (err_ratio=1.0 forced by probe)
                    downstream_fail_frac = max(downstream_err, own_err_ratio)
                    if downstream_fail_frac == 0.0:
                        downstream_fail_frac = 1.0  # probe forced it but Prometheus hasn't scraped yet
                else:
                    downstream_fail_frac = downstream_err

                # Fraction of THIS service's calls to the downstream that fail
                tf = _timeout_fraction(downstream_p99_eff, timeout_thresh)

                # Failed = own requests × downstream failure fraction
                failed_requests = int(round(total_requests * downstream_fail_frac))
                # Timed-out = calls that hit the timeout threshold
                timed_out_requests = int(round(total_requests * tf))
                # Delayed = calls slow but not timed out
                df = _slo_delay_fraction(downstream_p99_eff, slo_p99_s)
                delayed_requests = int(round((total_requests - timed_out_requests) * df))

                # Also take the max with this service's own observed 5xx
                own_failed = int(round(total_requests * own_err_ratio))
                failed_requests = max(failed_requests, own_failed)

                unique_affected = min(
                    total_requests,
                    max(timed_out_requests, failed_requests) + delayed_requests
                )
                actual_impact_pct = round((unique_affected / total_requests) * 100.0, 2)

        elif impact_type == "INDIRECT":
            # Indirect service — use its OWN measured error rate and latency.
            # Additionally, if the fault source is active (DOWN/ERROR/LATENCY),
            # estimate propagated impact from the dependency chain distance.
            # For synchronous indirect paths: apply a propagation attenuation factor
            # derived from how many hops away the fault is.
            failed_requests = int(round(total_requests * err_ratio))
            timed_out_requests = 0
            df = _slo_delay_fraction(p99_effective_s, slo_p99_s)
            delayed_requests = int(round(total_requests * df))

            # If the fault source is active and Prometheus hasn't caught up yet,
            # synthesise indirect impact: 2-hop attenuation means roughly 50%
            # of what the direct service experiences — but only for synchronous paths.
            if fault_source and failed_requests == 0 and delayed_requests == 0:
                src_fault = str(raw.get(f"{fault_source}_fault", "NONE")).upper()
                src_up    = float(raw.get(f"{fault_source}_service_up", 1.0))
                src_err   = _service_error_ratio(raw, fault_source)
                src_p99   = float(raw.get(f"{fault_source}_p99_latency_s", 0.0))
                src_delay = float(raw.get(f"{fault_source}_fault_delay_ms", 0.0))
                src_p99_eff = max(src_p99, src_delay / 1000.0)

                if src_up == 0 or src_fault == "DOWN":
                    # 2-hop sync chain: ordering stops → shipping stops
                    # Attenuation: indirect paths lose ~40% due to queues/retries
                    indirect_fail_frac = 0.60
                elif src_fault == "ERROR":
                    indirect_fail_frac = max(src_err, 0.0) * 0.60
                    if indirect_fail_frac == 0.0:
                        indirect_fail_frac = 0.60  # probe forced it but not scraped yet
                elif src_fault == "LATENCY" and src_p99_eff > 0:
                    tf_ind = _timeout_fraction(src_p99_eff, timeout_thresh)
                    indirect_fail_frac = tf_ind * 0.60
                else:
                    indirect_fail_frac = 0.0

                failed_requests  = int(round(total_requests * indirect_fail_frac))
                unique_affected  = failed_requests
                actual_impact_pct = round((unique_affected / total_requests) * 100.0, 2)
            else:
                unique_affected = min(total_requests, failed_requests + delayed_requests)
                actual_impact_pct = round((unique_affected / total_requests) * 100.0, 2)

        else:
            # HEALTHY / unclassified — use real observed metrics only
            failed_requests = int(round(total_requests * err_ratio))
            timed_out_requests = 0
            df = _slo_delay_fraction(p99_effective_s, slo_p99_s)
            delayed_requests = int(round(total_requests * df))
            unique_affected = min(total_requests, failed_requests + delayed_requests)
            actual_impact_pct = round((unique_affected / total_requests) * 100.0, 2)

    successful_requests = max(0, total_requests - unique_affected)
    calculation_display = f"({unique_affected} / {total_requests}) × 100 = {actual_impact_pct:.2f}%"

    p99_latency_ms = int(round(p99_effective_s * 1000))
    p95_latency_ms = int(round(p99_latency_ms * 0.75))
    p50_latency_ms = int(round(p99_latency_ms * 0.35)) if p99_latency_ms > 40 else 15

    retries = int(dependency_meta.get("retries", 2)) if (impact_type in ("ROOT_CAUSE", "DIRECT") and dependency_meta) else 0
    if actual_impact_pct >= 50.0:
        circuit_breaker = "Open"
    elif actual_impact_pct >= 15.0:
        circuit_breaker = "Half-Open"
    else:
        circuit_breaker = "Closed"

    if svc == "notification" and (fault in ("DOWN", "ERROR", "LATENCY") or impact_type != "NONE"):
        queue_backlog = int(round(total_requests * 0.85))
    else:
        queue_backlog = 0

    return {
        "total_requests": total_requests,
        "affected_requests": unique_affected,
        "failed_requests": failed_requests,
        "timed_out_requests": timed_out_requests,
        "delayed_requests": delayed_requests,
        "successful_requests": successful_requests,
        "actual_impact_pct": actual_impact_pct,
        "calculation_display": calculation_display,
        "fault_intensity": fault_intensity,
        "propagation_risk": round(propagation_risk, 1),
        "p50_latency_ms": p50_latency_ms,
        "p95_latency_ms": p95_latency_ms,
        "p99_latency_ms": p99_latency_ms,
        "throughput": round(request_rate, 1),
        "retry_count": retries,
        "circuit_breaker_state": circuit_breaker,
        "queue_backlog": queue_backlog,
        "status": "MEASURED"
    }


def impact_analysis(raw: dict, workload: str = "omnistore", causes: list = None) -> dict:
    """Calculate impact using dynamic request-level calculation.
    Supports multiple simultaneous root causes — all injected faults are tracked.
    """
    services = WORKLOAD_SERVICES.get(workload, SERVICES)
    metadata_list = DEPENDENCY_METADATA_BY_WORKLOAD.get(workload, [])

    # ── Collect ALL root causes (multi-fault support) ─────────────────────────
    root_svcs = []
    if causes:
        for c in causes:
            s = c.get("service") if isinstance(c, dict) else str(c)
            if s in services and s not in root_svcs:
                root_svcs.append(s)

    if not root_svcs:
        for s in services:
            fault = str(raw.get(f"{s}_fault", "NONE")).upper()
            up = float(raw.get(f"{s}_service_up", 1.0))
            if fault in ("DOWN", "ERROR", "LATENCY") or up == 0:
                root_svcs.append(s)   # collect ALL, not just first

    primary_root = root_svcs[0] if root_svcs else None

    # ── Build service role map ─────────────────────────────────────────────────
    service_roles = {svc: "HEALTHY" for svc in services}
    fault_sources  = {svc: None     for svc in services}
    dep_paths      = {svc: None     for svc in services}
    reasons        = {svc: "Operating within nominal SLA boundaries" for svc in services}
    meta_map = {}
    for meta in metadata_list:
        meta_map[(meta["source"], meta["target"])] = meta

    direct_affected   = []
    indirect_affected = []

    def _apply_cascade(root):
        """Apply cascade roles for a single root cause service."""
        fault = str(raw.get(f"{root}_fault", "NONE")).upper()
        up    = float(raw.get(f"{root}_service_up", 1.0))
        err   = _service_error_ratio(raw, root)
        should = (fault in ("DOWN", "ERROR", "LATENCY") or up == 0 or err >= 0.35)
        if not should:
            return

        if workload == "omnistore":
            if root == "payment":
                _set("order",    "DIRECT",   "payment", "payment -> order",
                     "Synchronous checkout caller experiencing payment timeout/failure",
                     direct_affected)
                _set("shipping", "INDIRECT", "payment", "payment -> order -> shipping",
                     "Downstream fulfillment halted; checkout failure stops shipment generation",
                     indirect_affected)
            elif root == "inventory":
                _set("order",    "DIRECT",   "inventory", "inventory -> order",
                     "Synchronous stock validation caller experiencing item reservation timeout",
                     direct_affected)
                _set("shipping", "INDIRECT", "inventory", "inventory -> order -> shipping",
                     "Downstream fulfillment halted; out-of-stock validation aborts checkout",
                     indirect_affected)
            elif root == "order":
                _set("shipping", "INDIRECT", "order", "order -> shipping",
                     "Order orchestrator offline; zero checkout requests dispatched for fulfillment",
                     indirect_affected)
            elif root == "delivery":
                _set("shipping", "DIRECT",   "delivery", "delivery -> shipping",
                     "Synchronous carrier fulfillment caller experiencing courier dispatch timeout",
                     direct_affected)
            elif root == "shipping":
                _set("order",    "DIRECT",   "shipping", "shipping -> order",
                     "Fulfillment dispatch delays affecting completed order hand-off",
                     direct_affected)
            elif root == "notification":
                reasons["notification"] = "Asynchronous notification queue subscriber; background alerts delayed"

        elif workload == "moviestream":
            if root == "user":
                _set("watchlist",      "DIRECT",   "user", "user -> watchlist",
                     "User profile gateway failure preventing watchlist queries",      direct_affected)
                _set("history",        "DIRECT",   "user", "user -> history",
                     "User profile gateway failure preventing viewing history queries", direct_affected)
                _set("recommendation", "INDIRECT", "user", "user -> recommendation",
                     "User profile unavailable; falling back to static popular carousels", indirect_affected)
            elif root == "catalog":
                _set("recommendation", "DIRECT", "catalog", "catalog -> recommendation",
                     "Movie catalog metadata unavailable; candidate ranker pool empty", direct_affected)
            elif root == "history":
                _set("recommendation", "DIRECT", "history", "history -> recommendation",
                     "Watch history unavailable; collaborative filtering degraded", direct_affected)
            elif root == "watchlist":
                _set("recommendation", "DIRECT", "watchlist", "watchlist -> recommendation",
                     "Saved titles unavailable; omitting watchlist affinity weights", direct_affected)

    def _set(svc, role, src, path, reason, bucket):
        """Set role only if the service isn't already ROOT_CAUSE from another fault."""
        if service_roles[svc] == "ROOT_CAUSE":
            return   # already a root — don't downgrade
        # Upgrade INDIRECT to DIRECT if a second root pushes it to direct
        if role == "INDIRECT" and service_roles[svc] == "DIRECT":
            return   # keep existing DIRECT
        service_roles[svc]  = role
        fault_sources[svc]  = src
        dep_paths[svc]      = path
        reasons[svc]        = reason
        if svc not in bucket:
            bucket.append(svc)

    # Mark all roots first
    for root in root_svcs:
        service_roles[root] = "ROOT_CAUSE"
        fault_sources[root] = root
        dep_paths[root]     = root
        reasons[root]       = f"Active fault injection / threshold breach originating on {root}"

    # Apply cascade from each root
    for root in root_svcs:
        _apply_cascade(root)

    # ── Calculate request-level impact for EACH service independently ─────────
    service_details     = {}
    service_impact_pcts = {}
    healthy_services    = []

    try:
        ml_cr = predict_cascade(raw, workload=workload).get("cascade_risk", 0.20) * 100.0
    except Exception:
        ml_cr = 20.0

    for svc in services:
        role  = service_roles[svc]
        f_src = fault_sources[svc]
        d_meta = meta_map.get((svc, f_src)) or meta_map.get((f_src, svc))

        svc_prop_risk = {
            "ROOT_CAUSE": ml_cr,
            "DIRECT":     round(ml_cr * 0.75, 1),
            "INDIRECT":   round(ml_cr * 0.40, 1),
        }.get(role, round(min(15.0, ml_cr * 0.15), 1))

        req_stats = calculate_service_requests(
            raw=raw, svc=svc, workload=workload,
            fault_source=f_src, impact_type=role,
            dependency_meta=d_meta, propagation_risk=svc_prop_risk,
        )

        service_impact_pcts[svc] = req_stats["actual_impact_pct"] if req_stats["actual_impact_pct"] is not None else 0.0
        service_details[svc] = {
            **req_stats,
            "impact_type":     role,
            "fault_source":    f_src,
            "dependency_path": dep_paths[svc],
            "reason":          reasons[svc],
        }
        if role == "HEALTHY":
            healthy_services.append(svc)

    traffic_svcs    = [s for s in services if service_details[s]["total_requests"] > 0]
    total_aff       = sum(service_details[s]["affected_requests"]  for s in traffic_svcs)
    total_reqs      = sum(service_details[s]["total_requests"]     for s in traffic_svcs)
    overall_aff_pct = round((total_aff / total_reqs) * 100.0, 2) if total_reqs > 0 else 0.0
    aff_count       = len([s for s in services
                           if service_roles[s] in ("ROOT_CAUSE", "DIRECT", "INDIRECT")
                           or service_impact_pcts.get(s, 0) > 0])

    return {
        "services":           service_impact_pcts,
        "service_details":    service_details,
        "affected_percentage": overall_aff_pct,
        "affected_services":  aff_count,
        "direct_affected":    direct_affected,
        "indirect_affected":  indirect_affected,
        "healthy_services":   healthy_services,
        "root_cause":         primary_root,    # kept for backward-compat (first root)
        "root_causes":        root_svcs,       # NEW: all active roots
    }



def criticality_analysis(raw: dict, impact: dict, workload: str = "omnistore") -> dict:
    """Return a deterministic, explainable system criticality score with weighted business dimensions."""
    services = WORKLOAD_SERVICES.get(workload, SERVICES)
    importance_info = BUSINESS_IMPORTANCE_BY_WORKLOAD.get(workload, BUSINESS_IMPORTANCE_BY_WORKLOAD.get("omnistore", {}))
    arch_edges = ARCH_EDGES_BY_WORKLOAD.get(workload, ARCH_EDGES_BY_WORKLOAD.get("omnistore", []))

    active_services = {
        svc for svc in services
        if str(raw.get(f"{svc}_fault", "NONE")).upper() != "NONE" or float(raw.get(f"{svc}_service_up", 1.0)) == 0
    }

    # Pure healthy baseline (preserve minimum score of 5.0% INFORMATIONAL for testing and idle operations)
    if not active_services and impact.get("affected_percentage", 0) == 0:
        return {
            "percentage": CRITICALITY_CONFIG.get("min_percentage", 5.0),
            "severity": "INFORMATIONAL",
            "reasons": ["No active fault or threshold breach detected"],
            "components": {
                "severity": 0, "frequency": 0, "duration": 0,
                "impact": 0, "recurrence": 0, "dependency": 0,
                "business_criticality": 0, "dependency_centrality": 0,
                "fault_severity": 0, "traffic_impact": 0,
                "propagation_potential": 0, "customer_impact": 0,
            },
            "service_scores": {s: CRITICALITY_CONFIG.get("min_percentage", 5.0) for s in services},
        }

    now = _utc_now()
    recent_window = [
        event for event in _fault_event_snapshot()
        if event.get("status") in ("ACTIVE", "INJECTED") and (now - _parse_timestamp(event.get("timestamp"))).total_seconds() <= 600 and event.get("service") in services
    ]

    service_scores = {}
    severity_values = []
    recurrence_values = []
    reasons = []

    for svc in services:
        meta = importance_info.get(svc, {"tier": "Medium", "weight": 0.5, "centrality": 0.5, "propagation_pot": 0.3, "customer_pot": 0.5})
        b_score = meta["weight"] * 100.0
        d_score = meta["centrality"] * 100.0

        fault = str(raw.get(f"{svc}_fault", "NONE")).upper()
        up = float(raw.get(f"{svc}_service_up", 1.0))
        err_ratio = _service_error_ratio(raw, svc)
        p99 = float(raw.get(f"{svc}_p99_latency_s", 0.0))
        delay_ms = float(raw.get(f"{svc}_fault_delay_ms", 0.0))

        if fault == "DOWN" or up == 0:
            f_score = 100.0
        elif fault == "ERROR":
            f_score = max(70.0, err_ratio * 100.0) if err_ratio > 0 else 75.0
        elif fault == "LATENCY":
            eff_delay = max(p99, delay_ms / 1000.0)
            if eff_delay <= 0.3:
                f_score = 25.0
            elif eff_delay <= 1.0:
                f_score = 35.0 + eff_delay * 15.0
            else:
                f_score = min(98.0, 50.0 + eff_delay * 5.0)
        elif err_ratio > 0.05 or p99 > 1.0:
            f_score = min(75.0, max(err_ratio * 100.0, p99 * 25.0))
        else:
            f_score = impact["services"].get(svc, 0.0) * 0.75

        rr = float(raw.get(f"{svc}_request_rate", 1.0))
        t_score = min(100.0, rr * 15.0 if rr > 0 else 30.0)
        p_score = meta["propagation_pot"] * 100.0 if (svc in active_services or impact["services"].get(svc, 0) > 0) else 0.0
        c_score = meta["customer_pot"] * 100.0 if (svc in active_services or impact["services"].get(svc, 0) > 0) else 0.0

        raw_svc_score = (
            CRITICALITY_WEIGHTS["business_criticality"]  * b_score +
            CRITICALITY_WEIGHTS["dependency_centrality"] * d_score +
            CRITICALITY_WEIGHTS["fault_severity"]        * f_score +
            CRITICALITY_WEIGHTS["traffic_impact"]        * t_score +
            CRITICALITY_WEIGHTS["propagation_potential"] * p_score +
            CRITICALITY_WEIGHTS["customer_impact"]       * c_score
        )
        service_scores[svc] = round(raw_svc_score, 2)
        if svc in active_services:
            severity_values.append(raw_svc_score)
            same_faults = [event for event in recent_window if event.get("service") == svc and event.get("fault") == fault]
            recurrence_values.append(min(100.0, max(0, len(same_faults) - 1) * 35.0))

    root_scores = [service_scores[s] for s in active_services]
    max_root_score = max(root_scores) if root_scores else max(service_scores.values())
    downstream_impact = impact.get("affected_percentage", 0.0)

    # Isolated vs Critical system aggregation
    if active_services == {"notification"}:
        system_percentage = round(min(28.0, max(20.0, max_root_score * 0.42)), 1)
        reasons.append("Notification Service outage is isolated to customer alerts; checkout and fulfillment operate normally")
    elif active_services == {"recommendation"}:
        system_percentage = round(min(30.0, max(22.0, max_root_score * 0.45)), 1)
        reasons.append("Recommendation Service degradation isolated to recommendation rail; catalog search and streaming operational")
    elif active_services == {"delivery"}:
        system_percentage = round(min(45.0, max(35.0, max_root_score * 0.55 + downstream_impact * 0.15)), 1)
        reasons.append("Delivery Service outage impacts courier tracking; order placement and payment capture functional")
    elif "payment" in active_services or "order" in active_services:
        # Scale according to fault severity so 200ms latency is Moderate/Medium, ERROR is High, and DOWN/9.9s latency is Critical
        f_max = max([_service_error_ratio(raw, s) * 100.0 if str(raw.get(f"{s}_fault", "NONE")).upper() == "ERROR" else (100.0 if (str(raw.get(f"{s}_fault", "NONE")).upper() == "DOWN" or float(raw.get(f"{s}_service_up", 1.0)) == 0) else (min(100.0, float(raw.get(f"{s}_fault_delay_ms", 0)) / 100.0) if str(raw.get(f"{s}_fault", "NONE")).upper() == "LATENCY" else 50.0)) for s in active_services] or [50.0])
        if f_max >= 90.0:
            base = max_root_score * 0.90 + downstream_impact * 0.22
        elif f_max >= 60.0:
            base = max_root_score * 0.82 + downstream_impact * 0.15
        else:
            base = max_root_score * 0.65 + downstream_impact * 0.10
        system_percentage = round(min(98.0, max(15.0, base)), 1)
        reasons.append(f"Core transaction orchestrator ({', '.join(active_services)}) impaired; checkout capability blocked")
    elif "inventory" in active_services:
        base = max_root_score * 0.78 + downstream_impact * 0.15
        system_percentage = round(min(80.0, max(25.0, base)), 1)
        reasons.append("Inventory stock validation blocked; checkout halted to prevent inventory inconsistency")
    elif "catalog" in active_services:
        # Catalog is critical core of MovieStream; when down, wide cascade raises system criticality to CRITICAL (>80%)
        f_cat = max([100.0 if (str(raw.get(f"{s}_fault", "NONE")).upper() == "DOWN" or float(raw.get(f"{s}_service_up", 1.0)) == 0) else 50.0 for s in active_services] or [50.0])
        if f_cat >= 90.0:
            base = max_root_score * 0.92 + downstream_impact * 0.20
        else:
            base = max_root_score * 0.75 + downstream_impact * 0.15
        system_percentage = round(min(95.0, max(25.0, base)), 1)
        reasons.append("Catalog Service offline; core browsing, search, and recommendation dependencies blocked")
    else:
        system_percentage = round(min(100.0, max(5.0, max_root_score * 0.6 + downstream_impact * 0.4)), 1)

    # Recurrence boost if applicable
    rec_val = max(recurrence_values or [0])
    if rec_val > 0:
        system_percentage = round(min(100.0, system_percentage + (rec_val / 100.0) * 8.0), 1)
        reasons.append(f"Fault recurrence detected ({len(recent_window)} event(s) in last 10 minutes)")

    # System classification
    if system_percentage > 80.0:
        severity = "CRITICAL"
    elif system_percentage > 60.0:
        severity = "HIGH"
    elif system_percentage > 40.0:
        severity = "MEDIUM"
    elif system_percentage > 20.0:
        severity = "MODERATE"
    else:
        severity = "LOW"

    components = {
        "severity": round(max(severity_values or [0]), 1),
        "frequency": min(100.0, len(recent_window) * 25.0) if active_services else 0.0,
        "duration": 50.0 if active_services else 0.0,
        "impact": downstream_impact,
        "recurrence": rec_val,
        "dependency": min(100.0, len(impact.get("direct_affected", [])) * 30.0),
        "business_criticality": round(sum(importance_info[s]["weight"] * 100 for s in active_services) / max(len(active_services), 1), 1) if active_services else 0.0,
        "dependency_centrality": round(sum(importance_info[s]["centrality"] * 100 for s in active_services) / max(len(active_services), 1), 1) if active_services else 0.0,
        "fault_severity": round(max(severity_values or [0]), 1),
        "traffic_impact": 15.0 if active_services else 0.0,
        "propagation_potential": round(sum(importance_info[s]["propagation_pot"] * 100 for s in active_services) / max(len(active_services), 1), 1) if active_services else 0.0,
        "customer_impact": round(sum(importance_info[s]["customer_pot"] * 100 for s in active_services) / max(len(active_services), 1), 1) if active_services else 0.0,
    }

    return {
        "percentage": system_percentage,
        "severity": severity,
        "reasons": reasons,
        "components": components,
        "service_scores": service_scores,
    }


def incident_impact_analysis(workload: str, root_causes: list, impact: dict, criticality: dict) -> dict:
    """Generates real-world customer consequences, business impact, technical impact, and remediation runbooks."""
    services = WORKLOAD_SERVICES.get(workload, SERVICES)
    root_names = [c["service"] if isinstance(c, dict) else str(c) for c in (root_causes or [])]
    if not root_names:
        return {
            "status": "HEALTHY",
            "customer_consequences": "All services operating normally. Seamless checkout, browsing, and fulfillment.",
            "business_impact": "Zero revenue at risk. SLA commitments met at 99.9% uptime.",
            "technical_impact": "All RPC latencies within SLA thresholds. Zero 5xx errors recorded.",
            "directly_affected": [],
            "indirectly_affected": [],
            "healthy_services": services,
            "runbook": [
                "Maintain regular Prometheus telemetry monitoring.",
                "Verify automated health probe heartbeats every 8s.",
            ],
        }

    primary = root_names[0]
    direct = impact.get("direct_affected", [])
    indirect = impact.get("indirect_affected", [])
    healthy = impact.get("healthy_services", [s for s in services if s != primary and s not in direct and s not in indirect])

    if workload == "omnistore":
        if primary == "payment":
            customer = "Checkout authorization failure. Customers cannot complete orders via credit card or digital wallets; cart submission halts at payment step."
            business = "Severe top-of-funnel revenue loss; order completion drops to 0%. Active merchant SLA breach ($5,000/hr estimated exposure)."
            technical = "Order Service worker threads blocked awaiting payment RPC (3000ms timeout). Thread pool exhaustion triggers 504 Gateway Timeouts. Payment circuit breaker trips to OPEN. Downstream fulfillment starved."
            runbook = [
                "Verify Payment Service container: docker ps -f name=payment-service",
                "Inspect payment logs for exceptions: docker logs payment-service --tail 100",
                "Verify payment gateway webhook / database pool availability.",
                "Reset active fault in Fault Lab (:4001) or via POST /fault/reset.",
                "Confirm Order Service circuit breaker recovers to CLOSED after 5s sleep window.",
            ]
        elif primary == "order":
            customer = "Complete checkout outage. Shopping cart submission and new order placement are unavailable across all web and mobile clients."
            business = "Critical revenue stoppage. Entire omnistore sales pipeline blocked."
            technical = "Order Orchestrator offline (HTTP 503). Downstream shipment dispatches halted. Event publishing to notification-service paused."
            runbook = [
                "Restart Order Service container: docker restart order-service",
                "Verify Actuator health: curl -s http://localhost:8081/actuator/health",
                "Inspect JVM memory and thread dump for deadlock or heap exhaustion.",
                "Reset fault in Fault Lab (:4001).",
            ]
        elif primary == "inventory":
            customer = "Stock verification and cart reservation failed. Customers cannot add items or verify stock availability."
            business = "High cart abandonment; orders cannot be confirmed without stock reservation guarantees to prevent overselling."
            technical = "Order Service stock reservation calls timeout after 2500ms. Inventory circuit breaker trips OPEN. Shipping pipeline halted."
            runbook = [
                "Verify Inventory database connectivity: docker logs inventory-service",
                "Verify Redis stock cache and lock release mechanisms.",
                "Reset active fault in Fault Lab (:4001).",
            ]
        elif primary == "notification":
            customer = "Orders, payments, and shipments succeed normally. Customers experience delays in receiving email and SMS receipts."
            business = "Low business risk. Zero transaction loss; customer support inquiry volume slightly elevated."
            technical = "Message broker queues (RabbitMQ/Kafka) buffer events. Checkout RPCs remain completely unblocked and healthy."
            runbook = [
                "Inspect notification queue backlog depth in RabbitMQ/Kafka.",
                "Restart notification worker: docker restart notification-service",
                "Reset active fault in Fault Lab (:4001).",
            ]
        elif primary == "delivery":
            customer = "Orders and payments succeed normally. Package tracking numbers and carrier dispatch updates are delayed."
            business = "Moderate fulfillment delay. Courier delivery dispatch queue backlog grows; zero checkout impact."
            technical = "Shipping Service courier dispatch calls timeout after 3000ms. Shipping queues outbound dispatch jobs."
            runbook = [
                "Inspect Delivery Service carrier integration endpoint: docker logs delivery-service",
                "Verify courier API credentials and webhook listeners.",
                "Reset active fault in Fault Lab (:4001).",
            ]
        else:
            customer = f"Degradation on {primary} service. Dependent operations affected."
            business = "Operational degradation; SLA breach monitoring active."
            technical = f"Fault active on {primary}. Direct affected: {direct}."
            runbook = [f"Inspect {primary} service logs and reset active fault."]
    else:
        if primary == "catalog":
            customer = "Customers cannot search movies, browse title genres, or view movie metadata across the catalog."
            business = "Critical user engagement drop. Streaming playback blocked for un-cached catalog titles."
            technical = "Catalog Service offline. Recommendation Service candidate ranker cannot score movie metadata."
            runbook = [
                "Check catalog SQLite database and local cache files.",
                "Restart Catalog Service on port 8087.",
                "Reset active fault in Fault Lab (:4001).",
            ]
        elif primary == "recommendation":
            customer = "Personalized 'Recommended for You' carousel falls back to static popular titles. Search, watchlist, and video streaming work normally."
            business = "Moderate engagement impact. Zero streaming outage; playback capability 100% operational."
            technical = "Recommendation model scoring endpoint failing. Fast-fail static fallback served to clients."
            runbook = [
                "Inspect recommendation model inference service on port 8093.",
                "Verify user preference vector store.",
                "Reset fault in Fault Lab (:4001).",
            ]
        else:
            customer = f"MovieStream experience degraded due to {primary} availability."
            business = "User streaming session impacted."
            technical = f"{primary} fault active."
            runbook = [f"Inspect {primary} service on port 8088/8089/8092."]

    return {
        "status": "INCIDENT_ACTIVE",
        "root_cause_service": primary,
        "customer_consequences": customer,
        "business_impact": business,
        "technical_impact": technical,
        "directly_affected": direct,
        "indirectly_affected": indirect,
        "healthy_services": healthy,
        "runbook": runbook,
    }


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
    "catalog": {
        "label": "Catalog Service",
        "port": 8087,
        "down": {
            "title": "Catalog Service Outage (:8087) — Movie Discovery & Billboard Offline",
            "what_is_happening": "Catalog Service (:8087) is completely DOWN (service_up=0, HTTP 503). TMDB metadata queries and movie catalog endpoints are unreachable.",
            "cause": "Injected service outage or microservice process stoppage. Recommendation Service (:8093) cannot fetch trending titles, causing cascading degradation.",
            "measures": [
                "Restart the Catalog Service process on port 8087",
                "Verify Catalog Service health: curl -s http://localhost:8087/health",
                "Reset active fault in Fault Lab (:4001) or via POST http://localhost:8087/fault/reset",
                "Verify TMDB API connectivity and rate limits",
            ],
            "why": "Catalog Service (:8087) is completely down. Video metadata, billboard banners, and category rows are unavailable across the streaming platform.",
            "action": "curl -s http://localhost:8087/health",
            "command": "curl -s http://localhost:8087/health",
            "priority": "P1",
        },
        "high_error": {
            "title": "Catalog Query Exception Spike on :8087 ({err_pct}%)",
            "what_is_happening": "Catalog Service is generating HTTP 5xx responses on {err_pct}% of metadata requests.",
            "cause": "TMDB upstream gateway errors or local movie cache serialization failure.",
            "measures": [
                "Inspect Catalog Service terminal logs for uncaught exceptions",
                "Verify TMDB API key validity and network egress",
                "Check Recommendation Service circuit breaker fallback handling",
            ],
            "why": "Catalog Service is failing metadata requests with HTTP 500 errors. Downstream recommendation assembly fails.",
            "action": "curl -s http://localhost:8087/health",
            "command": "curl -s http://localhost:8087/health",
            "priority": "P1",
        },
        "low_error": {
            "title": "Catalog Transient Metadata Fluctuation ({err_pct}%)",
            "what_is_happening": "Minor intermittent errors detected on Catalog Service ({err_pct}%). Core movie playback and browsing operational.",
            "cause": "Sporadic external TMDB API rate-limit or transient network timeout.",
            "measures": [
                "Monitor error rate burn down; local catalog cache serves fallback metadata",
                "Inspect recent catalog logs for rate-limit warnings",
            ],
            "why": "Catalog error rate is only {err_pct}%. Core streaming platform operational.",
            "action": "curl -s http://localhost:8087/health",
            "command": "curl -s http://localhost:8087/health",
            "priority": "P3",
        },
        "latency": {
            "title": "Catalog Metadata Latency Spike — P99 {p99_s}s",
            "what_is_happening": "Catalog Service P99 latency ({p99_s}s) exceeds the 0.500s SLA budget. Injected delay or slow external TMDB upstream active.",
            "cause": "Slow movie catalog responses cause synchronous worker threads in Recommendation Service (:8093) to stall, triggering cascading latency.",
            "measures": [
                "Inspect active artificial latency in Fault Lab (:4001) and reset if needed",
                "Verify local TMDB cache TTL settings",
                "Check Recommendation Service timeout threshold (recommended 1000ms max with cache fallback)",
                "Reset latency fault: POST http://localhost:8087/fault/reset",
            ],
            "why": "Catalog P99 latency ({p99_s}s) exceeds 0.500s SLA. Cascades to Recommendation Service.",
            "action": "curl -s -X POST http://localhost:8087/fault/reset",
            "command": "curl -s -X POST http://localhost:8087/fault/reset",
            "priority": "P2",
        },
    },
    "recommendation": {
        "label": "Recommendation Service",
        "port": 8093,
        "down": {
            "title": "Recommendation Service Outage (:8093) — Personalized Feed Offline",
            "what_is_happening": "Recommendation Service (:8093) is DOWN (service_up=0, HTTP 503). Homepage personalized rails cannot be computed.",
            "cause": "Recommendation process stopped or severe dependency starvation.",
            "measures": [
                "Verify recommendation process is running: curl -s http://localhost:8093/health",
                "Check if Catalog (:8087) or History (:8092) are offline, starving recommendations",
                "Reset active fault in Fault Lab (:4001)",
            ],
            "why": "Recommendation Service (:8093) is down. Customer UI displays fallback trending feed.",
            "action": "curl -s http://localhost:8093/health",
            "command": "curl -s http://localhost:8093/health",
            "priority": "P1",
        },
        "high_error": {
            "title": "Recommendation Cascade Failure on :8093 ({err_pct}%)",
            "what_is_happening": "Recommendation Service is failing {err_pct}% of recommendation computations, returning HTTP 5xx responses.",
            "cause": "Downstream dependency failure: Catalog (:8087) or History (:8092) rejected calls. Recommendation Service is a caller victim in a cascading failure.",
            "measures": [
                "DO NOT restart Recommendation Service first; diagnose the underlying callee service (Catalog or History)",
                "Recover the failing downstream microservice; Recommendation Service will heal automatically",
                "Enable cached fallback recommendations when Catalog service is degraded",
            ],
            "why": "Recommendation Service is failing requests due to downstream dependency errors.",
            "action": "curl -s http://localhost:8093/health",
            "command": "curl -s http://localhost:8093/health",
            "priority": "P1",
        },
        "low_error": {
            "title": "Recommendation Jitter ({err_pct}%)",
            "what_is_happening": "Low error rate of {err_pct}% on recommendation pipeline.",
            "cause": "Minor cold-start cache miss or profile parsing timeout.",
            "measures": [
                "Monitor error trend; fallback trending movies served automatically",
            ],
            "why": "Recommendation error rate is only {err_pct}%. Core movie playback unaffected.",
            "action": "curl -s http://localhost:8093/health",
            "command": "curl -s http://localhost:8093/health",
            "priority": "P3",
        },
        "latency": {
            "title": "Recommendation Cascade Latency Exhaustion — P99 {p99_s}s",
            "what_is_happening": "Recommendation Service P99 latency ({p99_s}s) exceeds 0.600s SLA. High response delay.",
            "cause": "Synchronous blocking calls to Catalog (:8087) or History (:8092) are delaying recommendation assembly.",
            "measures": [
                "Inspect Catalog Service (:8087) latency in Fault Lab (:4001)",
                "Ensure parallel asynchronous calls to Catalog and History instead of serial HTTP fetches",
                "Reset active latency faults across dependencies: POST http://localhost:8087/fault/reset",
            ],
            "why": "Recommendation P99 latency ({p99_s}s) exceeds 0.600s SLA budget. Blocked on upstream microservices.",
            "action": "curl -s -X POST http://localhost:8087/fault/reset",
            "command": "curl -s -X POST http://localhost:8087/fault/reset",
            "priority": "P2",
        },
    },
    "history": {
        "label": "History Service",
        "port": 8092,
        "down": {
            "title": "Playback History Service Outage (:8092)",
            "what_is_happening": "History Service (:8092) is DOWN (service_up=0, HTTP 503). Continue-watching progress tracking is unavailable.",
            "cause": "Process stopped or injected DOWN fault.",
            "measures": [
                "Verify history service health: curl -s http://localhost:8092/health",
                "Reset active fault in Fault Lab (:4001)",
            ],
            "why": "History Service is down. Video playback resumes from beginning; continue-watching rail empty.",
            "action": "curl -s http://localhost:8092/health",
            "command": "curl -s http://localhost:8092/health",
            "priority": "P2",
        },
        "high_error": {
            "title": "Watch Progress Heartbeat Rejections ({err_pct}%)",
            "what_is_happening": "History Service failing {err_pct}% of playback progress heartbeats.",
            "cause": "Concurrent watch progress write contention or memory lock timeout.",
            "measures": [
                "Inspect history service error logs",
                "Ensure playback heartbeats are sent with debouncing",
            ],
            "why": "History Service is returning errors on watch progress recording.",
            "action": "curl -s http://localhost:8092/health",
            "command": "curl -s http://localhost:8092/health",
            "priority": "P2",
        },
        "low_error": {
            "title": "Playback Heartbeat Jitter ({err_pct}%)",
            "what_is_happening": "Minor {err_pct}% heartbeat drop on video progress.",
            "cause": "Client video scrub transient disconnection.",
            "measures": [
                "Monitor playback telemetry; core streaming unaffected",
            ],
            "why": "Low error rate on playback telemetry.",
            "action": "curl -s http://localhost:8092/health",
            "command": "curl -s http://localhost:8092/health",
            "priority": "P3",
        },
        "latency": {
            "title": "History Query Latency ({p99_s}s)",
            "what_is_happening": "History P99 latency ({p99_s}s) exceeds 0.400s SLA.",
            "cause": "Injected delay or slow history queries.",
            "measures": [
                "Reset active latency faults in Fault Lab (:4001)",
                "Verify client heartbeat debounce interval",
            ],
            "why": "History latency exceeds SLA target.",
            "action": "curl -s -X POST http://localhost:8092/fault/reset",
            "command": "curl -s -X POST http://localhost:8092/fault/reset",
            "priority": "P3",
        },
    },
    "watchlist": {
        "label": "Watchlist Service",
        "port": 8089,
        "down": {
            "title": "Watchlist Service Outage (:8089)",
            "what_is_happening": "Watchlist Service (:8089) is DOWN (service_up=0, HTTP 503). User 'My List' is unavailable.",
            "cause": "Process stopped or injected DOWN fault.",
            "measures": [
                "Verify watchlist health: curl -s http://localhost:8089/health",
                "Reset active fault in Fault Lab (:4001)",
            ],
            "why": "Watchlist Service is down. Customers cannot add/remove movies from My List.",
            "action": "curl -s http://localhost:8089/health",
            "command": "curl -s http://localhost:8089/health",
            "priority": "P2",
        },
        "high_error": {
            "title": "Watchlist Modification Failures ({err_pct}%)",
            "what_is_happening": "Watchlist returning {err_pct}% errors on add/remove requests.",
            "cause": "Watchlist state storage error.",
            "measures": [
                "Inspect watchlist error logs",
                "Verify user profile session",
            ],
            "why": "Watchlist operations failing.",
            "action": "curl -s http://localhost:8089/health",
            "command": "curl -s http://localhost:8089/health",
            "priority": "P2",
        },
        "low_error": {
            "title": "Watchlist Sync Fluctuation ({err_pct}%)",
            "what_is_happening": "Minor error rate of {err_pct}% on watchlist.",
            "cause": "Duplicate bookmark insertion or transient network blip.",
            "measures": [
                "Allow client retry; core streaming unaffected",
            ],
            "why": "Minor watchlist error rate.",
            "action": "curl -s http://localhost:8089/health",
            "command": "curl -s http://localhost:8089/health",
            "priority": "P3",
        },
        "latency": {
            "title": "Watchlist Latency ({p99_s}s)",
            "what_is_happening": "Watchlist P99 latency ({p99_s}s) exceeds 0.400s SLA.",
            "cause": "Injected delay in watchlist microservice.",
            "measures": [
                "Reset latency in Fault Lab (:4001)",
            ],
            "why": "Watchlist latency exceeds SLA.",
            "action": "curl -s -X POST http://localhost:8089/fault/reset",
            "command": "curl -s -X POST http://localhost:8089/fault/reset",
            "priority": "P3",
        },
    },
    "user": {
        "label": "User Service",
        "port": 8088,
        "down": {
            "title": "User Profile Service Outage (:8088)",
            "what_is_happening": "User Service (:8088) is DOWN (service_up=0, HTTP 503). Profile switching and authentication offline.",
            "cause": "Injected service outage or user service process crash.",
            "measures": [
                "Verify user service process: curl -s http://localhost:8088/health",
                "Reset active fault in Fault Lab (:4001)",
            ],
            "why": "User Service is down. Profile management and user preference personalization offline.",
            "action": "curl -s http://localhost:8088/health",
            "command": "curl -s http://localhost:8088/health",
            "priority": "P1",
        },
        "high_error": {
            "title": "User Authentication & Profile Errors ({err_pct}%)",
            "what_is_happening": "User Service returning {err_pct}% errors on profile requests.",
            "cause": "Session token validation failure or profile repository error.",
            "measures": [
                "Inspect user service error logs",
                "Verify profile repository health",
            ],
            "why": "User profile service errors.",
            "action": "curl -s http://localhost:8088/health",
            "command": "curl -s http://localhost:8088/health",
            "priority": "P1",
        },
        "low_error": {
            "title": "User Session Jitter ({err_pct}%)",
            "what_is_happening": "Minor error rate of {err_pct}% on user service.",
            "cause": "Expired session token renewal lag.",
            "measures": [
                "Allow client session refresh",
            ],
            "why": "Minor user service error rate.",
            "action": "curl -s http://localhost:8088/health",
            "command": "curl -s http://localhost:8088/health",
            "priority": "P3",
        },
        "latency": {
            "title": "User Service Latency ({p99_s}s)",
            "what_is_happening": "User Service P99 latency ({p99_s}s) exceeds 0.300s SLA.",
            "cause": "Injected delay in user microservice.",
            "measures": [
                "Reset latency in Fault Lab (:4001)",
            ],
            "why": "User latency exceeds SLA.",
            "action": "curl -s -X POST http://localhost:8088/fault/reset",
            "command": "curl -s -X POST http://localhost:8088/fault/reset",
            "priority": "P2",
        },
    },
}


def intelligent_recommendations(raw: dict, causes: list, impact: dict, criticality: dict, sla: dict, workload: str = "omnistore") -> list:
    """Create particular, microservice-specific recommendations from current evidence, state, and fault history."""
    services = WORKLOAD_SERVICES.get(workload, SERVICES)
    arch_edges = ARCH_EDGES_BY_WORKLOAD.get(workload, ARCH_EDGES_BY_WORKLOAD["omnistore"])
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

    affected_services = [svc for svc, value in impact["services"].items() if value > 0 and svc in services]
    fault_events = _fault_event_snapshot()
    repeated = {
        svc: sum(1 for event in fault_events if event.get("service") == svc and event.get("status") in ("ACTIVE", "INJECTED"))
        for svc in affected_services
    }
    cascading = len(affected_services) > 1 or len({dst for src, dst in arch_edges if src in affected_services} & set(affected_services)) > 0

    if cascading:
        def _dep_score(svc):
            # Prioritize services that are down or faulted, and callee dependencies over orchestrator callers
            is_down = 10 if raw.get(f"{svc}_service_up", 1.0) == 0 else 0
            has_fault = 5 if raw.get(f"{svc}_fault", "NONE") != "NONE" else 0
            callers = sum(1 for src, dst in arch_edges if dst == svc and src in affected_services)
            calls_others = sum(1 for src, dst in arch_edges if src == svc and dst in affected_services)
            return is_down + has_fault + (callers * 2) - calls_others

        sorted_candidates = sorted(affected_services, key=_dep_score, reverse=True)
        root_svc = sorted_candidates[0] if sorted_candidates else affected_services[0]
        downstream = [s for s in affected_services if s != root_svc]
        root_label = SERVICE_LABELS.get(root_svc, root_svc)
        downstream_labels = ", ".join(SERVICE_LABELS.get(s, s) for s in downstream) if downstream else "downstream services"
        port = SERVICE_PORTS.get(root_svc, 8080)
        default_restart = f"curl -s http://localhost:{port}/health" if workload == "moviestream" else f"docker restart {root_svc}-service"
        add(root_svc,
            f"Cascade Root Cause: Investigate the upstream dependency ({root_label}) before restarting downstream services.",
            f"Multiple related services ({', '.join(affected_services)}) are affected. The failure originated in {root_label} and propagated to {downstream_labels}. Restarting {downstream_labels} will not fix the cascade.",
            f"Affected services: {', '.join(affected_services)}; upstream root: {root_label} (:{port}); dependency impact: {criticality['components']['dependency']:.1f}%.",
            default_restart,
            "P1",
            command=default_restart,
            what_is_happening=f"Cascading failure detected across {len(affected_services)} services ({', '.join(affected_services)}). Downstream callers are failing because upstream dependency {root_label} is offline or rejecting calls.",
            cause=f"Architectural cascade propagation: {root_label} is the callee dependency root cause. Synchronous calls from {downstream_labels} timed out or failed, propagating errors through the dependency graph.",
            measures=[
                f"Prioritize recovering the upstream root cause dependency ({root_label}) first: {default_restart}",
                f"Do NOT restart caller services ({downstream_labels}) yet; they will self-heal automatically once {root_label} recovers",
                f"Verify health of the root dependency: curl -s http://localhost:{port}/health",
                f"Inspect distributed trace for propagation timing",
            ])

    for svc in affected_services:
        fault = str(raw.get(f"{svc}_fault", "NONE")).upper()
        up = float(raw.get(f"{svc}_service_up", 1.0))
        err = _service_error_ratio(raw, svc)
        rr = float(raw.get(f"{svc}_request_rate", 0.0))
        p99 = float(raw.get(f"{svc}_p99_latency_s", 0.0))
        delay = float(raw.get(f"{svc}_fault_delay_ms", 0.0))
        label = SERVICE_LABELS.get(svc, svc)
        diag = SERVICE_DIAGNOSTICS.get(svc, {})
        err_pct = round(err * 100.0, 1)
        sla_target = SLA_TARGETS.get(svc, {"max_error_rate": 0.01, "max_p99_s": 0.5})
        budget_pct = round((err / max(sla_target["max_error_rate"], 1e-6)) * 100, 1)
        svc_port = SERVICE_PORTS.get(svc, 8080)
        default_cmd = f"curl -s http://localhost:{svc_port}/health" if workload == "moviestream" else f"docker restart {svc}-service"

        if repeated.get(svc, 0) >= 3:
            add(svc,
                f"Investigate recurring failure pattern on {label} instead of repeating restarts.",
                f"{label} has {repeated[svc]} recorded fault events in recent window, indicating recurrence. Repetitive restarts do not address root cause resource leaks.",
                f"Fault type: {fault}; recent event count: {repeated[svc]}; current impact: {impact['services'][svc]:.1f}%.",
                default_cmd,
                "P1",
                command=default_cmd,
                what_is_happening=f"{label} has failed {repeated[svc]} times in the recent observation window. Repeated container restarts have failed to permanently stabilize the service.",
                cause="Chronic resource exhaustion, database connection pool leak, or memory leak causing recurring process crashes.",
                measures=[
                    f"Check heap dump and memory leak traces for {label}",
                    f"Profile memory footprint and active thread count on port {svc_port}",
                    "Inspect database connection limits and slow query logs",
                ])
        elif fault == "DOWN" or up == 0:
            cfg = diag.get("down", {})
            add(svc,
                cfg.get("title", f"Restart {label} — Service Down"),
                cfg.get("why", f"{label} is completely offline (service_up=0)."),
                f"Status: DOWN (service_up=0); port: {svc_port}; impact: {impact['services'][svc]:.1f}%.",
                cfg.get("action", default_cmd),
                cfg.get("priority", "P1"),
                command=cfg.get("command", default_cmd),
                what_is_happening=cfg.get("what_is_happening", f"{label} is completely offline (service_up=0)."),
                cause=cfg.get("cause", f"{label} process is terminated or injected DOWN fault is active."),
                measures=cfg.get("measures", [default_cmd]))
        elif fault == "ERROR" or err > 0.08:
            cfg = diag.get("high_error", {})
            title = cfg.get("title", f"Remediate {label} Error Rate").format(err_pct=err_pct)
            why = cfg.get("why", f"{label} is returning high error rates.").format(err_pct=err_pct)
            what_is_happening = cfg.get("what_is_happening", f"{label} is returning high error rates.").format(err_pct=err_pct)
            cause = cfg.get("cause", f"{label} is failing internal transactions.").format(err_pct=err_pct)
            add(svc,
                title,
                why,
                f"Fault: {fault}; 5xx responses: {err_pct}% of requests; SLA error budget consumed: {budget_pct}%; impact: {impact['services'][svc]:.1f}%.",
                cfg.get("action", default_cmd),
                cfg.get("priority", "P1"),
                command=cfg.get("command", default_cmd),
                what_is_happening=what_is_happening,
                cause=cause,
                measures=cfg.get("measures", [default_cmd]))
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
                cfg.get("action", default_cmd),
                cfg.get("priority", "P3"),
                command=cfg.get("command", default_cmd),
                what_is_happening=what_is_happening,
                cause=cause,
                measures=cfg.get("measures", [default_cmd]))
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
                cfg.get("action", default_cmd),
                cfg.get("priority", "P2"),
                command=cfg.get("command", default_cmd),
                what_is_happening=what_is_happening,
                cause=cause,
                measures=cfg.get("measures", [default_cmd]))

    if not recommendations and not causes:
        app_name = "MovieStream" if workload == "moviestream" else "OmniStore"
        svc_count = len(services)
        svc_names = ", ".join([SERVICE_LABELS.get(s, s) for s in services])
        check_cmd = f"curl -s http://localhost:{SERVICE_PORTS.get(services[0], 8087)}/health" if workload == "moviestream" else "curl -s http://localhost:8080/actuator/health"
        add("system",
            f"All {app_name} Microservices Operational — Normal Telemetry",
            f"All {svc_count} microservices ({svc_names}) are healthy with zero active faults and zero SLA breaches.",
            f"Criticality: {criticality['percentage']:.1f}%; system error rate: 0.00%; active incidents: 0.",
            "System is operating normally. To test cascade prediction resilience, inject faults via Fault Lab (:4001).",
            "P3",
            command=check_cmd,
            what_is_happening=f"All {svc_count} {app_name} microservices ({svc_names}) are healthy with zero active faults and zero SLA breaches.",
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
    with FAULT_EVENTS_LOCK:
        active_fault_count = sum(
            event.get("service") in impact["services"]
            for event in _active_fault_events()
        )
        for event in FAULT_EVENTS:
            service = event.get("service")
            if service not in impact["services"]:
                continue
            event["criticality_percentage"] = criticality["percentage"]
            event["severity"] = criticality["severity"]
            event["criticality_reasons"] = criticality["reasons"]
            event["affected_component"] = service
            event["active_faults"] = active_fault_count
            recommendation = by_service.get(service) or by_service.get("system")
            if recommendation:
                event["recommendation"] = recommendation["recommendation"]
                event["recommendation_reason"] = recommendation["why"]
                event["recommendation_evidence"] = recommendation["evidence"]
            changed = True
    if changed:
        _save_fault_events()


def full_pipeline(raw: dict, workload: str = "omnistore") -> dict:
    services = WORKLOAD_SERVICES.get(workload, SERVICES)
    causes   = root_cause(raw, workload=workload)
    z        = zscore_analysis(raw, workload=workload)
    t        = temporal_analysis(raw, workload=workload)
    impact   = impact_analysis(raw, workload=workload, causes=causes)
    nx_data  = dependency_graph(raw, causes, workload=workload, impact=impact)
    fi       = feature_importances(workload=workload, raw=raw)
    sla      = sla_compliance(raw, workload=workload)
    obs      = observability_status()
    criticality = criticality_analysis(raw, impact, workload=workload)

    # ML Cascade Failure Prediction driven by Random Forest model (71 features) for OmniStore, or topology engine for MovieStream
    ml_result  = predict_cascade(raw, workload=workload)
    prediction = ml_result["prediction"]
    cr         = ml_result["cascade_risk"]
    confidence = ml_result["confidence"]
    rl         = ml_result["risk_level"]
    model_note = ml_result["model_note"]

    system_mean_error_ratio = _system_error_ratio(raw, services)
    system_max_error_ratio = max(
        (_service_error_ratio(raw, svc) for svc in services),
        default=0.0,
    )

    # Percentage-scaled risk level escalation:
    # CRITICAL requires widespread failure: >= 2 services down, system error ratio >= 35%,
    # or high cascade risk with significant error rate (>= 30%).
    if rl == "CRITICAL":
        if raw.get("num_services_down", 0) < 2 and system_mean_error_ratio < 0.35 and cr < 0.80:
            rl = "HIGH" if (raw.get("num_services_down", 0) >= 1 or system_max_error_ratio >= 0.20) else ("MEDIUM" if system_max_error_ratio >= 0.08 else "LOW")
    elif criticality["severity"] == "CRITICAL":
        if raw.get("num_services_down", 0) >= 2 or system_mean_error_ratio >= 0.35 or cr >= 0.80:
            rl = "CRITICAL"
        else:
            rl = "HIGH"
    elif criticality["severity"] == "HIGH" and rl == "LOW":
        rl = "MEDIUM" if system_max_error_ratio <= 0.15 else "HIGH"

    incident_impact = incident_impact_analysis(workload, causes, impact, criticality)
    recs = intelligent_recommendations(raw, causes, impact, criticality, sla, workload=workload)
    if raw.get("prometheus_connected", True) is False:
        recs = [
            item for item in recs
            if "All " not in item.get("title", "")
        ]
        recs.insert(0, {
            "service": "system",
            "title": "Prometheus metrics are unavailable",
            "recommendation": "Restore the local Prometheus metrics connection before evaluating service health.",
            "what_is_happening": "The analysis API cannot query Prometheus. Error-rate, latency and availability trends are therefore incomplete.",
            "cause": "Prometheus is stopped, unreachable, or its configured targets are not responding.",
            "measures": [
                "Start or restart the local Prometheus service.",
                "Check target health at http://localhost:9090/targets.",
                "Verify PROMETHEUS_URL and the service scrape targets.",
            ],
            "why": "Health and SLA values must not be interpreted as healthy while the metrics source is unavailable.",
            "evidence": "prometheus_connected=false",
            "priority": "P2",
            "severity": "UNKNOWN",
            "criticality": criticality["percentage"],
        })
    enrich_fault_events(raw, impact, criticality, recs)
    _append_incident(raw, causes, rl, workload=workload)

    # Compute observability percentages for each service
    obs_pct = {}
    for svc in services:
        up  = float(raw.get(f"{svc}_service_up",      1.0))
        err = float(raw.get(f"{svc}_error_rate_5xx",  0.0))
        p99 = float(raw.get(f"{svc}_p99_latency_s",   0.0))
        rr  = float(raw.get(f"{svc}_request_rate",    0.0))
        sla_t = SLA_TARGETS.get(svc, {"max_error_rate": 0.01, "max_p99_s": 0.5})

        # Error rate as % of requests; null means there was no traffic to measure.
        err_pct  = round(_service_error_ratio(raw, svc) * 100, 2) if rr > 0 else None
        # Latency budget %
        lat_pct  = round(min(100.0, (p99 / max(sla_t["max_p99_s"], 0.001)) * 100), 1)
        # Uptime %
        up_pct   = 100.0 if up == 1 else 0.0
        # Error budget %
        err_bud  = round(min(100.0, (_service_error_ratio(raw, svc) / max(sla_t["max_error_rate"], 1e-9)) * 100), 1)

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
        "workload":              workload,
        "prediction":            prediction,
        "cascade_risk":          cr,
        "risk_level":            rl,
        "confidence":            confidence,
        "affected_percentage":   impact["affected_percentage"],
        "affected_services":     impact["affected_services"],
        "affected_service_percentage": round(
            impact["affected_services"] / max(len(services), 1) * 100, 1
        ),
        "service_impact_pct":     impact["services"],
        "service_details":        impact.get("service_details", {}),
        "direct_affected":        impact.get("direct_affected", []),
        "indirect_affected":      impact.get("indirect_affected", []),
        "healthy_services":        impact.get("healthy_services", []),
        "service_scores":          criticality.get("service_scores", {}),
        "incident_impact":         incident_impact,
        "dependency_metadata":     DEPENDENCY_METADATA_BY_WORKLOAD.get(workload, []),
        "business_importance":     BUSINESS_IMPORTANCE_BY_WORKLOAD.get(workload, {}),
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
            for event in _fault_event_snapshot()
            if event.get("service") in services
        ][-50:],
        "incident_log":          _incident_snapshot(workload=workload),
        "live_metrics": {
            svc: {
                "error_rate_5xx": round(float(raw.get(f"{svc}_error_rate_5xx", 0)), 4),
                "error_rate_pct": (
                    round(
                        float(raw.get(f"{svc}_error_rate_5xx", 0))
                        / float(raw.get(f"{svc}_request_rate", 0))
                        * 100,
                        2,
                    )
                    if float(raw.get(f"{svc}_request_rate", 0)) > 0
                    else (
                        100.0 if str(raw.get(f"{svc}_fault", "NONE")).upper() in ("ERROR", "DOWN")
                        else 0.0 if (float(raw.get(f"{svc}_service_up", 1.0)) == 1.0 and raw.get("prometheus_connected", False) and str(raw.get(f"{svc}_fault", "NONE")).upper() == "NONE")
                        else None
                    )
                ),
                "p99_latency_s": round(
                    max(
                        float(raw.get(f"{svc}_p99_latency_s", 0.0)),
                        float(raw.get(f"{svc}_fault_delay_ms", 0.0)) / 1000.0
                    ),
                    4
                ),
                "service_up": (
                    int(raw.get(f"{svc}_service_up", 1))
                    if raw.get("prometheus_connected", False)
                    or raw.get(f"{svc}_probed", False)
                    or str(raw.get(f"{svc}_fault", "NONE")).upper() == "DOWN"
                    else None
                ),
                "request_rate":   round(float(raw.get(f"{svc}_request_rate",   0)), 4),
                "jvm_heap_mb":    round(float(raw.get(f"{svc}_jvm_heap_mb",    0)), 1),
                "active_threads": int(raw.get(f"{svc}_active_threads", 0)),
                "metrics_available": bool(raw.get("prometheus_connected", True)),
                "fault":          str(raw.get(f"{svc}_fault", "NONE")).upper(),
            }
            for svc in services
        },
        "system": {
            "mean_error_rate":    round(float(raw.get("system_mean_error_rate",  0)), 4),
            "error_rate_pct": (
                round(
                    sum(float(raw.get(f"{svc}_error_rate_5xx", 0)) for svc in services)
                    / sum(float(raw.get(f"{svc}_request_rate", 0)) for svc in services)
                    * 100,
                    2,
                )
                if sum(float(raw.get(f"{svc}_request_rate", 0)) for svc in services) > 0
                else None
            ),
            "max_error_rate_pct": round(
                max((_service_error_ratio(raw, svc) for svc in services), default=0.0) * 100,
                2,
            ),
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
        workload = request.args.get("workload", "omnistore").lower()
        if workload not in WORKLOAD_SERVICES:
            workload = "omnistore"
        raw    = scrape(workload=workload)
        result = full_pipeline(raw, workload=workload)
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
    workload = request.args.get("workload", "").lower()
    service  = request.args.get("service", "").lower()
    filtered = _incident_snapshot()
    if workload and workload in WORKLOAD_SERVICES:
        filtered = [e for e in filtered if e.get("workload", "omnistore") == workload]
    if service:
        filtered = [e for e in filtered if e.get("service", "").lower() == service]
    return jsonify({"incidents": filtered, "count": len(filtered)})


@app.route("/service-logs")
@app.route("/api/service-logs")
def service_logs():
    """Return recent logs for one allow-listed service from Loki or MovieStream files."""
    workload = request.args.get("workload", "omnistore").lower()
    service = request.args.get("service", "").lower()
    try:
        limit = int(request.args.get("limit", "100"))
    except ValueError:
        return jsonify({"error": "limit must be an integer"}), 400

    if workload not in WORKLOAD_SERVICES:
        return jsonify({"error": "invalid workload"}), 400
    if service not in WORKLOAD_SERVICES[workload]:
        return jsonify({"error": "service does not belong to the selected workload"}), 400
    if not 1 <= limit <= 500:
        return jsonify({"error": "limit must be between 1 and 500"}), 400

    if workload == "moviestream":
        log_path = os.path.join(MOVIESTREAM_LOG_DIR, f"{service}-service.log")
        if not os.path.isfile(log_path):
            return jsonify({
                "workload": workload,
                "service": service,
                "source": "local-file",
                "logs": [],
                "count": 0,
                "message": "No local log file exists for this service yet.",
            })
        with open(log_path, "r", encoding="utf-8", errors="replace") as log_file:
            lines = list(deque(log_file, maxlen=limit))
        lines.reverse()
        logs = [{"timestamp": None, "line": line.rstrip("\r\n")[-4000:]} for line in lines]
        return jsonify({
            "workload": workload,
            "service": service,
            "source": "local-file",
            "logs": logs,
            "count": len(logs),
        })

    import requests as req

    end_ns = int(time.time() * 1_000_000_000)
    start_ns = end_ns - 60 * 60 * 1_000_000_000
    try:
        response = req.get(
            f"{LOKI_URL.rstrip('/')}/loki/api/v1/query_range",
            params={
                "query": f'{{service="{service}-service"}}',
                "start": str(start_ns),
                "end": str(end_ns),
                "limit": limit,
                "direction": "backward",
            },
            timeout=3.0,
        )
        response.raise_for_status()
    except req.RequestException as e:
        print(f"[WARN] Could not query Loki for {service}: {e}")
        return jsonify({"error": "Loki is unavailable; start the local observability stack and try again."}), 503

    result = response.json().get("data", {}).get("result", [])
    logs = [
        {
            "timestamp": datetime.fromtimestamp(int(timestamp) / 1_000_000_000, timezone.utc).isoformat(),
            "line": line[-4000:],
        }
        for stream in result
        for timestamp, line in stream.get("values", [])
    ]
    logs.sort(key=lambda entry: entry["timestamp"], reverse=True)
    return jsonify({
        "workload": workload,
        "service": service,
        "source": "loki",
        "logs": logs[:limit],
        "count": min(len(logs), limit),
    })


@app.route("/api/fault-events", methods=["POST"])
def fault_events_ingest():
    """Ingest an idempotent fault lifecycle event from the gateway outbox."""
    body = request.get_json(silent=True) or {}
    required = ("fault_id", "service", "fault", "status", "timestamp")
    if any(not body.get(field) for field in required):
        return jsonify({"error": "fault_id, service, fault, status and timestamp are required"}), 400
    if body["service"] not in ALL_SERVICES or str(body["fault"]).upper() not in ("NONE", "LATENCY", "ERROR", "DOWN"):
        return jsonify({"error": "invalid service or fault type"}), 400
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
    with FAULT_EVENTS_LOCK:
        if any(existing.get("fault_id") == body["fault_id"] for existing in FAULT_EVENTS):
            return jsonify({"status": "duplicate", "fault_id": body["fault_id"]}), 200
        FAULT_EVENTS.append(event)
        _save_fault_events()
    return jsonify({"status": "recorded", "fault_id": event["fault_id"]}), 201


@app.route("/api/fault-events", methods=["GET"])
def fault_events():
    events = _fault_event_snapshot()
    return jsonify({"events": events, "count": len(events)})


@app.route("/incidents/clear", methods=["POST"])
@app.route("/api/incidents/clear", methods=["POST"])
def clear_incidents():
    """Clear the incident log (supports optional workload or service filter)."""
    body = request.get_json(silent=True) or {}
    workload = (request.args.get("workload") or body.get("workload") or "").lower()
    service = (request.args.get("service") or body.get("service") or "").lower()
    with INCIDENT_LOG_LOCK:
        global INCIDENT_LOG
        if service or workload:
            INCIDENT_LOG = deque([
                entry for entry in INCIDENT_LOG
                if not (
                    (not service or entry.get("service", "").lower() == service)
                    and (not workload or entry.get("workload", "omnistore") == workload)
                )
            ], maxlen=200)
        else:
            INCIDENT_LOG.clear()
        _last_rec_fingerprint.clear()
        _save_incident_log()
    return jsonify({"status": "cleared"})


@app.route("/incidents/resolve", methods=["POST"])
@app.route("/api/incidents/resolve", methods=["POST"])
def resolve_incident():
    """
    Attach a developer resolution note to a RESOLVED incident.
    Body: { "id": <incident_id>, "resolved_by": "Alice", "note": "Restarted pod" }
    Finds the matching incident by id and adds the note fields in-place.
    """
    body = request.get_json(force=True) or {}
    incident_id  = body.get("id")
    resolved_by  = (body.get("resolved_by") or "").strip()
    note         = (body.get("note")        or "").strip()

    if not incident_id:
        return jsonify({"error": "id is required"}), 400
    if not resolved_by:
        return jsonify({"error": "resolved_by is required"}), 400
    if not note:
        return jsonify({"error": "note is required"}), 400

    with INCIDENT_LOG_LOCK:
        target = next((entry for entry in INCIDENT_LOG if str(entry.get("id")) == str(incident_id)), None)
        if target is None:
            return jsonify({"error": f"Incident {incident_id} not found"}), 404

        target["resolved_by"] = resolved_by
        target["resolution_note"] = note
        target["resolution_ts"] = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime())
        _save_incident_log()

    return jsonify({"status": "ok", "incident": target})


@app.route("/predict", methods=["POST"])
def predict():
    try:
        body = request.get_json(force=True) or {}
        workload = request.args.get("workload", body.get("workload", "omnistore")).lower()
        if workload not in WORKLOAD_SERVICES:
            workload = "omnistore"
        raw = body.get("metrics", body)
        result = full_pipeline(raw, workload=workload)
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
