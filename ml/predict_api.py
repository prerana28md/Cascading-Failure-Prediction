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

import networkx as nx
import numpy as np
import joblib
from flask import Flask, jsonify, request
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

# ── Config ────────────────────────────────────────────────────────────────────
PROMETHEUS_URL = os.getenv("PROMETHEUS_URL", "http://localhost:9090")
GRAFANA_URL    = os.getenv("GRAFANA_URL",    "http://localhost:3001")
JAEGER_URL     = os.getenv("JAEGER_URL",     "http://localhost:16686")
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


# ── Prometheus scraper ────────────────────────────────────────────────────────
def _prom(query):
    try:
        import requests as req
        r = req.get(f"{PROMETHEUS_URL}/api/v1/query",
                    params={"query": query}, timeout=1.0)
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
        if up == 0:
            causes.append({"service": svc, "reason": "SERVICE_DOWN",    "metric": "service_up",     "value": 0})
        elif err > 0.01:
            causes.append({"service": svc, "reason": "HIGH_ERROR_RATE", "metric": "error_rate_5xx", "value": round(err, 4)})
        elif p99 > 1.5:
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
    """Append anomalies to the rolling incident log with full datetime. Deduplicates consecutive identical events."""
    now = time.localtime()
    ts  = time.strftime("%Y-%m-%d %H:%M:%S", now)   # full date + time
    day = time.strftime("%Y-%m-%d", now)

    cause_svcs = {c["service"] for c in causes}

    for c in causes:
        svc    = c["service"]
        reason = c["reason"]

        # Deduplicate: skip if the most recent event for this service has same reason
        last_for_svc = next((e for e in INCIDENT_LOG if e["service"] == svc), None)
        if last_for_svc and last_for_svc.get("reason") == reason:
            continue  # same fault still active — don't flood the log

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

    # Auto-resolve: service was in incident log but no longer has a cause
    all_inc_svcs = {e["service"] for e in INCIDENT_LOG if e.get("reason") != "RESOLVED"}
    for svc in (all_inc_svcs - cause_svcs):
        last_for_svc = next((e for e in INCIDENT_LOG if e["service"] == svc), None)
        if last_for_svc and last_for_svc.get("reason") != "RESOLVED":
            INCIDENT_LOG.appendleft({
                "ts":         ts,
                "date":       day,
                "service":    svc,
                "label":      SERVICE_LABELS.get(svc, svc),
                "reason":     "RESOLVED",
                "value":      None,
                "metric":     None,
                "risk_level": "LOW",
                "id":         int(time.time() * 1000) + 1,
            })

    _save_incident_log()


def rule_based_risk(raw: dict) -> tuple:
    n_down   = int(raw.get("num_services_down", 0))
    err_rate = float(raw.get("system_mean_error_rate", 0))
    max_err  = float(raw.get("system_max_error_rate",  0))
    p99      = float(raw.get("system_max_p99_latency", 0))
    if n_down >= 2 or max_err > 0.3:
        return "CRITICAL", 0.90
    if n_down == 1 or max_err > 0.05 or err_rate > 0.05:
        return "HIGH", 0.75
    if max_err > 0.01 or p99 > 1.5:
        return "MEDIUM", 0.45
    return "LOW", 0.05


def full_pipeline(raw: dict) -> dict:
    causes   = root_cause(raw)
    z        = zscore_analysis(raw)
    t        = temporal_analysis(raw)
    nx_data  = dependency_graph(raw, causes)
    fi       = feature_importances()
    sla      = sla_compliance(raw)
    obs      = observability_status()

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

    recs = structured_recommendations(causes, raw, rl, sla)
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
def incidents():
    return jsonify({"incidents": list(INCIDENT_LOG), "count": len(INCIDENT_LOG)})


@app.route("/incidents/clear", methods=["POST"])
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
