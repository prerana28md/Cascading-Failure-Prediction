"""
OmniStore Cascading-Failure Dataset Collector (corrected)
=========================================================
Collects one ML row per experiment and a separate time-series raw CSV.

Important:
- A fault injection is NOT automatically labelled as a cascade.
- label=1 only when a configured downstream dependent service shows
  measurable impact after the source fault.
- label=0 means no downstream propagation was observed.
- label=-1 means the experiment could not be labelled reliably; these rows
  are excluded from dataset.csv but retained in experiment_log.csv.
- Update DEPENDENCIES below to match the actual service call graph.
- The PromQL assumes your metrics use the `application` label and the
  metric names shown below. Change them if your instrumentation differs.

Install:
    pip install requests pandas numpy tqdm

Run (Windows CMD):
    set DATASET_USERNAME=dataset_user
    set DATASET_PASSWORD=YOUR_NEW_DATASET_PASSWORD
    python collect_dataset.py --runs 5

Optional:
    python collect_dataset.py --runs 10
    python collect_dataset.py --gateway http://localhost:8080 --prom http://localhost:9090

Outputs (in ./dataset):
    raw_metrics.csv       one row per service per time snapshot
    dataset.csv           one row per experiment, temporal features + label
    experiment_log.csv    injection/reset/label evidence and experiment metadata
"""

import argparse
import os
import time
import uuid
from datetime import datetime, timezone

import numpy as np
import pandas as pd
import requests
from tqdm import tqdm


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
OUTPUT_DIR = os.path.join(BASE_DIR, "dataset")

GATEWAY_URL = os.getenv("GATEWAY_URL", "http://localhost:8080").rstrip("/")
PROMETHEUS_URL = os.getenv("PROMETHEUS_URL", "http://localhost:9090").rstrip("/")
DATASET_USERNAME = os.getenv("DATASET_USERNAME", "dataset_user")
DATASET_PASSWORD = os.getenv("DATASET_PASSWORD", "")

SERVICES = [
    "order-service",
    "payment-service",
    "inventory-service",
    "shipping-service",
    "delivery-service",
    "notification-service",
]

# IMPORTANT: this is an example topology based on the OmniStore workflow.
# Change it to the real synchronous/asynchronous dependency graph in your code.
# A -> B means A depends on B (B is a downstream impact candidate when A fails).
# The collector traverses this graph from the injected fault service.
DEPENDENCIES = {
    "order-service": ["payment-service", "inventory-service", "shipping-service"],
    "payment-service": [],
    "inventory-service": [],
    "shipping-service": ["delivery-service"],
    "delivery-service": ["notification-service"],
    "notification-service": [],
}

# Multiple independent healthy workload profiles are useful for grouped
# train/test evaluation. They all have label 0 only after telemetry verifies
# that no downstream propagation occurred.
SCENARIOS = [
    {"scenario": "NORMAL_LOW", "fault": "NONE", "service": None, "delayMs": 0, "orders": 4},
    {"scenario": "NORMAL_MEDIUM", "fault": "NONE", "service": None, "delayMs": 0, "orders": 8},
    {"scenario": "NORMAL_HIGH", "fault": "NONE", "service": None, "delayMs": 0, "orders": 14},

    {"scenario": "PAYMENT_DOWN", "fault": "DOWN", "service": "payment-service", "delayMs": 0, "orders": 8},
    {"scenario": "INVENTORY_DOWN", "fault": "DOWN", "service": "inventory-service", "delayMs": 0, "orders": 8},
    {"scenario": "SHIPPING_DOWN", "fault": "DOWN", "service": "shipping-service", "delayMs": 0, "orders": 8},
    {"scenario": "NOTIFICATION_DOWN", "fault": "DOWN", "service": "notification-service", "delayMs": 0, "orders": 8},
    {"scenario": "DELIVERY_DOWN", "fault": "DOWN", "service": "delivery-service", "delayMs": 0, "orders": 8},

    {"scenario": "PAYMENT_ERROR", "fault": "ERROR", "service": "payment-service", "delayMs": 0, "orders": 8},
    {"scenario": "INVENTORY_ERROR", "fault": "ERROR", "service": "inventory-service", "delayMs": 0, "orders": 8},
    {"scenario": "SHIPPING_ERROR", "fault": "ERROR", "service": "shipping-service", "delayMs": 0, "orders": 8},

    {"scenario": "PAYMENT_LATENCY_3S", "fault": "LATENCY", "service": "payment-service", "delayMs": 3000, "orders": 8},
    {"scenario": "INVENTORY_LATENCY_2S", "fault": "LATENCY", "service": "inventory-service", "delayMs": 2000, "orders": 8},
    {"scenario": "SHIPPING_LATENCY_3S", "fault": "LATENCY", "service": "shipping-service", "delayMs": 3000, "orders": 8},
]

# Number of seconds after injection at which snapshots are collected.
SNAPSHOT_TIMES = [0, 10, 20, 30]
# T0 is taken before fault injection. The remaining times are after injection.
BASELINE_SNAPSHOT_LABEL = "baseline"

# A downstream service is considered impacted if one of these conditions is
# met relative to its baseline. Tune using your own healthy/fault experiments.
ERROR_RATE_ABSOLUTE_MIN = 0.02
ERROR_RATE_INCREASE_MIN = 0.02
LATENCY_RATIO_MIN = 2.0
LATENCY_ABSOLUTE_INCREASE_S = 0.25
REQUEST_RATE_MIN_FOR_ERROR_CHECK = 0.01

# Prometheus metrics. PromQL aggregation is done in Prometheus, not by taking
# the first arbitrary returned time series.
METRIC_QUERIES = {
    "request_rate": (
        'sum(rate(http_server_requests_seconds_count'
        '{{application="{svc}"}}[1m]))'
    ),
    "error_rate_5xx": (
        'sum(rate(http_server_requests_seconds_count'
        '{{application="{svc}",status=~"5.."}}[1m]))'
    ),
    "error_rate_4xx": (
        'sum(rate(http_server_requests_seconds_count'
        '{{application="{svc}",status=~"4.."}}[1m]))'
    ),
    "p99_latency_s": (
        'histogram_quantile(0.99, '
        'sum by (le) (rate(http_server_requests_seconds_bucket'
        '{{application="{svc}"}}[1m])))'
    ),
    "p95_latency_s": (
        'histogram_quantile(0.95, '
        'sum by (le) (rate(http_server_requests_seconds_bucket'
        '{{application="{svc}"}}[1m])))'
    ),
    "p50_latency_s": (
        'histogram_quantile(0.50, '
        'sum by (le) (rate(http_server_requests_seconds_bucket'
        '{{application="{svc}"}}[1m])))'
    ),
    "jvm_heap_mb": (
        'sum(jvm_memory_used_bytes'
        '{{application="{svc}",area="heap"}}) / 1048576'
    ),
    "active_threads": (
        'sum(tomcat_threads_busy_threads'
        '{{application="{svc}"}})'
    ),
    "service_up": 'min(up{{job="{svc}"}})',
}

HTTP = requests.Session()
HTTP.headers.update({"User-Agent": "omni-cascade-dataset-collector/2.0"})


# ---------------------------------------------------------------------------
# HTTP / Prometheus helpers
# ---------------------------------------------------------------------------

def utc_now():
    return datetime.now(timezone.utc).isoformat()


def authenticate_gateway():
    """Log in through the gateway and attach the JWT to subsequent requests."""
    if not DATASET_PASSWORD:
        raise RuntimeError(
            "DATASET_PASSWORD is not set. In Windows CMD run "
            "set DATASET_USERNAME=dataset_user and "
            "set DATASET_PASSWORD=your_dataset_account_password before starting the collector."
        )

    login_url = f"{GATEWAY_URL}/auth/login"
    try:
        response = HTTP.post(
            login_url,
            json={"username": DATASET_USERNAME, "password": DATASET_PASSWORD},
            timeout=10,
        )
    except requests.RequestException as exc:
        raise RuntimeError(f"Could not reach login endpoint {login_url}: {exc}") from exc

    if response.status_code != 200:
        raise RuntimeError(
            f"Dataset account login failed (HTTP {response.status_code}): "
            f"{response.text[:300]}. Check DATASET_USERNAME and DATASET_PASSWORD."
        )

    try:
        auth_data = response.json()
    except ValueError as exc:
        raise RuntimeError("Login endpoint did not return valid JSON.") from exc

    token = auth_data.get("token")
    if not token:
        raise RuntimeError("Login succeeded but the response did not contain a 'token' field.")

    token_type = auth_data.get("tokenType", "Bearer")
    HTTP.headers.update({"Authorization": f"{token_type} {token}"})
    print(f"Authenticated dataset account '{DATASET_USERNAME}' through API Gateway.")


def gateway_post(path, payload=None, timeout=8):
    try:
        response = HTTP.post(
            f"{GATEWAY_URL}{path}", json=payload, timeout=timeout
        )
        return response.status_code == 200, response.status_code, response.text[:300]
    except requests.RequestException as exc:
        return False, None, str(exc)


def inject_fault(service, fault, delay_ms=0):
    """Return True only when the fault endpoint confirms HTTP 200."""
    ok, status, detail = gateway_post(
        f"/fault/{service}/configure",
        {"fault": fault, "delayMs": int(delay_ms)},
    )
    if not ok:
        print(f"  [ERROR] Fault injection failed for {service}: {status} {detail}")
    return ok


def reset_all_faults():
    """Reset every service and return whether every reset endpoint succeeded."""
    results = {}
    for service in SERVICES:
        ok, status, detail = gateway_post(f"/fault/{service}/reset")
        results[service] = ok
        if not ok:
            print(f"  [WARN] Reset failed for {service}: {status} {detail}")
    return all(results.values()), results


def wait_for_gateway(timeout_s=120):
    """Wait until the Spring Boot API Gateway Actuator health endpoint is UP."""
    health_url = f"{GATEWAY_URL}/actuator/health"
    print(f"Waiting for API Gateway health at {health_url}...")
    deadline = time.time() + timeout_s
    last_status = None
    last_detail = None

    while time.time() < deadline:
        try:
            response = HTTP.get(health_url, timeout=3)
            last_status = response.status_code

            if response.status_code == 200:
                try:
                    health = response.json()
                except ValueError:
                    health = {}

                if health.get("status") == "UP":
                    print("  API Gateway is reachable and healthy.")
                    return

                last_detail = f"Unexpected health response: {response.text[:200]}"
            else:
                last_detail = response.text[:200]

        except requests.RequestException as exc:
            last_detail = str(exc)

        time.sleep(3)

    raise RuntimeError(
        f"API Gateway health check failed at {health_url} within {timeout_s}s. "
        f"Last HTTP status: {last_status}; detail: {last_detail}"
    )


def prom_query(query):
    """Return the sum of returned samples; NaN if Prometheus has no valid data."""
    try:
        response = HTTP.get(
            f"{PROMETHEUS_URL}/api/v1/query",
            params={"query": query},
            timeout=12,
        )
        response.raise_for_status()
        payload = response.json()
        if payload.get("status") != "success":
            return np.nan

        results = payload.get("data", {}).get("result", [])
        values = []
        for item in results:
            try:
                value = float(item["value"][1])
                if np.isfinite(value):
                    values.append(value)
            except (KeyError, TypeError, ValueError, IndexError):
                continue

        if not values:
            return np.nan
        # Every query is deliberately aggregated to one series by PromQL.
        # Sum is a safe fallback if the metric still returns multiple series.
        return float(sum(values))
    except (requests.RequestException, ValueError, TypeError):
        return np.nan


def service_metric_snapshot(service):
    short = service.replace("-service", "").replace("-", "_")
    values = {}
    for metric_name, template in METRIC_QUERIES.items():
        query = template.format(svc=service)
        value = prom_query(query)
        values[f"{short}_{metric_name}"] = value
    return values


def collect_snapshot(experiment_id, scenario, phase, elapsed_s):
    """Collect one snapshot for all services. Does not assign a class label."""
    rows = []
    for service in SERVICES:
        row = {
            "experiment_id": experiment_id,
            "timestamp": utc_now(),
            "scenario": scenario,
            "phase": phase,
            "elapsed_seconds": elapsed_s,
            "service": service,
        }
        row.update(service_metric_snapshot(service))
        rows.append(row)
    return rows


def generate_load(n_orders=8):
    """Send order requests. Individual order failures are recorded, not fatal."""
    try:
        response = HTTP.get(f"{GATEWAY_URL}/inventory", timeout=5)
        products = response.json() if response.ok else []
        if not isinstance(products, list):
            products = []
    except (requests.RequestException, ValueError):
        products = []

    sent = 0
    succeeded = 0
    for index in range(n_orders):
        product_id = 101 + index
        if products:
            try:
                product_id = products[index % len(products)].get("productId", product_id)
            except (AttributeError, TypeError):
                pass

        payload = {
            "customerId": 900 + index,
            "productId": product_id,
            "quantity": 1,
            "amount": 99.99,
            "shippingAddress": f"Dataset Test Address {index + 1}",
        }
        sent += 1
        try:
            response = HTTP.post(
                f"{GATEWAY_URL}/orders", json=payload, timeout=12
            )
            if response.ok:
                succeeded += 1
        except requests.RequestException:
            # Expected for some injected-fault scenarios.
            pass
        time.sleep(0.25)
    return sent, succeeded


# ---------------------------------------------------------------------------
# Topology and labelling
# ---------------------------------------------------------------------------

def downstream_services(source):
    """Return all transitive dependents reachable from the fault source."""
    reverse = {service: [] for service in SERVICES}
    for caller, dependencies in DEPENDENCIES.items():
        for dependency in dependencies:
            if dependency in reverse:
                reverse[dependency].append(caller)

    found = set()
    frontier = [source]
    while frontier:
        current = frontier.pop()
        for dependent in reverse.get(current, []):
            if dependent not in found and dependent != source:
                found.add(dependent)
                frontier.append(dependent)
    return sorted(found)


def finite(value):
    try:
        return value is not None and np.isfinite(float(value))
    except (TypeError, ValueError):
        return False


def service_impacted(baseline, after):
    """
    Return (impacted, evidence, measurable).
    The injected source itself is never counted as downstream propagation.
    """
    evidence = []
    measurable = False

    base_up = baseline.get("service_up", np.nan)
    after_up = after.get("service_up", np.nan)
    if finite(after_up):
        measurable = True
        if float(after_up) < 1:
            evidence.append(f"service_up={after_up}")

    base_req = baseline.get("request_rate", np.nan)
    after_req = after.get("request_rate", np.nan)
    base_err = baseline.get("error_rate_5xx", np.nan)
    after_err = after.get("error_rate_5xx", np.nan)

    if finite(after_err) and finite(after_req):
        measurable = True
        if float(after_req) >= REQUEST_RATE_MIN_FOR_ERROR_CHECK:
            if float(after_err) >= ERROR_RATE_ABSOLUTE_MIN:
                increase = (
                    float(after_err) - float(base_err)
                    if finite(base_err) else float(after_err)
                )
                if increase >= ERROR_RATE_INCREASE_MIN or not finite(base_err):
                    evidence.append(
                        f"5xx_rate={float(after_err):.4f}, increase={increase:.4f}"
                    )

    base_p99 = baseline.get("p99_latency_s", np.nan)
    after_p99 = after.get("p99_latency_s", np.nan)
    if finite(after_p99) and float(after_p99) > 0:
        measurable = True
        if finite(base_p99) and float(base_p99) > 0:
            ratio = float(after_p99) / float(base_p99)
            increase = float(after_p99) - float(base_p99)
            if ratio >= LATENCY_RATIO_MIN and increase >= LATENCY_ABSOLUTE_INCREASE_S:
                evidence.append(
                    f"p99={float(after_p99):.4f}s, baseline={float(base_p99):.4f}s"
                )

    return bool(evidence), evidence, measurable


def classify_cascade(snapshots, fault_service):
    """
    Determine cascade from downstream impact, not from the injected fault label.
    Baseline is the pre-injection snapshot. Any later downstream impact confirms
    propagation. Returns -1 if no downstream service had usable telemetry.
    """
    if not fault_service:
        # Healthy workload experiment: label normal only if telemetry is usable
        # and no service is down / showing a significant 5xx error rate.
        baseline = snapshots.get("baseline", {})
        measurable_count = 0
        for service in SERVICES:
            short = service.replace("-service", "").replace("-", "_")
            metrics = baseline.get(service, {})
            up = metrics.get("service_up", np.nan)
            err = metrics.get("error_rate_5xx", np.nan)
            req = metrics.get("request_rate", np.nan)
            if finite(up) or finite(err):
                measurable_count += 1
            if finite(up) and float(up) < 1:
                return 1, [f"{service}: service_up={up}"]
            if finite(err) and finite(req) and float(req) >= REQUEST_RATE_MIN_FOR_ERROR_CHECK:
                if float(err) >= ERROR_RATE_ABSOLUTE_MIN:
                    return 1, [f"{service}: 5xx_rate={err}"]
        if measurable_count == 0:
            return -1, ["No usable baseline telemetry"]
        return 0, ["No unhealthy service signal detected in baseline"]

    candidates = downstream_services(fault_service)
    if not candidates:
        return 0, [f"No downstream dependents configured for {fault_service}"]

    any_measurable = False
    all_evidence = []
    for service in candidates:
        base = snapshots.get("baseline", {}).get(service, {})
        for phase in ("t10", "t20", "t30"):
            after = snapshots.get(phase, {}).get(service, {})
            impacted, evidence, measurable = service_impacted(base, after)
            any_measurable = any_measurable or measurable
            if impacted:
                all_evidence.append(f"{service} at {phase}: " + "; ".join(evidence))

    if all_evidence:
        return 1, all_evidence
    if any_measurable:
        return 0, [f"No downstream impact detected in {candidates}"]
    return -1, [f"Insufficient downstream telemetry for {candidates}"]


# ---------------------------------------------------------------------------
# Feature engineering: one row per experiment (not one row per snapshot)
# ---------------------------------------------------------------------------

META_COLUMNS = {
    "experiment_id", "timestamp", "scenario", "label", "label_evidence",
    "fault_type", "fault_service", "fault_delay_ms", "fault_injection_success",
    "reset_success", "recovery_verified", "orders_sent", "orders_succeeded",
    "run",
}


def metrics_to_map(rows):
    result = {}
    for row in rows:
        service = row["service"]
        short = service.replace("-service", "").replace("-", "_")
        result[service] = {
            metric: row.get(f"{short}_{metric}", np.nan)
            for metric in METRIC_QUERIES
        }
    return result


def build_experiment_features(experiment, snapshot_map):
    """Build stable temporal features from baseline and post-fault snapshots."""
    row = {
        "experiment_id": experiment["experiment_id"],
        "timestamp": experiment["timestamp"],
        "scenario": experiment["scenario"],
        "label": experiment["label"],
        "label_evidence": " | ".join(experiment["label_evidence"]),
        "fault_type": experiment["fault_type"],
        "fault_service": experiment["fault_service"],
        "fault_delay_ms": experiment["fault_delay_ms"],
        "fault_injection_success": experiment["fault_injection_success"],
        "reset_success": experiment["reset_success"],
        "recovery_verified": experiment["recovery_verified"],
        "orders_sent": experiment["orders_sent"],
        "orders_succeeded": experiment["orders_succeeded"],
        "run": experiment["run"],
    }

    phases = ["baseline", "t10", "t20", "t30"]
    services_short = {
        service: service.replace("-service", "").replace("-", "_")
        for service in SERVICES
    }

    for service, short in services_short.items():
        for metric in METRIC_QUERIES:
            values = []
            for phase in phases:
                value = (
                    snapshot_map.get(phase, {})
                    .get(service, {})
                    .get(metric, np.nan)
                )
                values.append(value)
                row[f"{short}_{metric}_{phase}"] = value

            valid = [float(v) for v in values if finite(v)]
            if len(valid) >= 2:
                row[f"{short}_{metric}_change"] = valid[-1] - valid[0]
                if abs(valid[0]) > 1e-9:
                    row[f"{short}_{metric}_ratio"] = valid[-1] / valid[0]
                else:
                    row[f"{short}_{metric}_ratio"] = np.nan
            else:
                row[f"{short}_{metric}_change"] = np.nan
                row[f"{short}_{metric}_ratio"] = np.nan

            if valid:
                row[f"{short}_{metric}_max"] = max(valid)
                row[f"{short}_{metric}_mean"] = float(np.mean(valid))
            else:
                row[f"{short}_{metric}_max"] = np.nan
                row[f"{short}_{metric}_mean"] = np.nan

        # Error ratio at each phase: 5xx rate / request rate.
        for phase in phases:
            req = row.get(f"{short}_request_rate_{phase}", np.nan)
            err = row.get(f"{short}_error_rate_5xx_{phase}", np.nan)
            row[f"{short}_error_ratio_{phase}"] = (
                float(err) / max(float(req), 1e-9)
                if finite(err) and finite(req) else np.nan
            )

    # System-wide features, preserving missing telemetry as NaN.
    for phase in phases:
        errors = [
            row.get(f"{short}_error_rate_5xx_{phase}", np.nan)
            for short in services_short.values()
        ]
        p99s = [
            row.get(f"{short}_p99_latency_s_{phase}", np.nan)
            for short in services_short.values()
        ]
        ups = [
            row.get(f"{short}_service_up_{phase}", np.nan)
            for short in services_short.values()
        ]
        valid_errors = [float(v) for v in errors if finite(v)]
        valid_p99 = [float(v) for v in p99s if finite(v)]
        valid_up = [float(v) for v in ups if finite(v)]

        row[f"system_mean_error_rate_{phase}"] = (
            float(np.mean(valid_errors)) if valid_errors else np.nan
        )
        row[f"system_max_error_rate_{phase}"] = (
            max(valid_errors) if valid_errors else np.nan
        )
        row[f"system_mean_p99_latency_{phase}"] = (
            float(np.mean(valid_p99)) if valid_p99 else np.nan
        )
        row[f"system_max_p99_latency_{phase}"] = (
            max(valid_p99) if valid_p99 else np.nan
        )
        row[f"num_services_down_{phase}"] = (
            sum(1 for v in valid_up if float(v) < 1)
            if valid_up else np.nan
        )

    # Change in aggregate system behaviour between baseline and final snapshot.
    for metric in (
        "system_mean_error_rate",
        "system_max_error_rate",
        "system_mean_p99_latency",
        "system_max_p99_latency",
        "num_services_down",
    ):
        first = row.get(f"{metric}_baseline", np.nan)
        last = row.get(f"{metric}_t30", np.nan)
        row[f"{metric}_change"] = (
            float(last) - float(first) if finite(first) and finite(last) else np.nan
        )

    return row


def verify_recovery(timeout_s=45):
    """Wait for all monitored services to report UP after reset."""
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        states = []
        for service in SERVICES:
            value = prom_query(METRIC_QUERIES["service_up"].format(svc=service))
            states.append(finite(value) and float(value) >= 1)
        if all(states):
            return True
        time.sleep(3)
    return False


# ---------------------------------------------------------------------------
# Experiment runner
# ---------------------------------------------------------------------------

def run_experiment(scenario, run_number):
    experiment_id = str(uuid.uuid4())
    start_timestamp = utc_now()
    fault_type = scenario["fault"]
    fault_service = scenario["service"]
    delay_ms = scenario["delayMs"]

    record = {
        "experiment_id": experiment_id,
        "timestamp": start_timestamp,
        "scenario": scenario["scenario"],
        "fault_type": fault_type,
        "fault_service": fault_service or "none",
        "fault_delay_ms": delay_ms,
        "fault_injection_success": True,
        "reset_success": False,
        "recovery_verified": False,
        "orders_sent": 0,
        "orders_succeeded": 0,
        "run": run_number,
        "label": -1,
        "label_evidence": [],
    }

    # Start from a clean and observable state.
    reset_ok, _ = reset_all_faults()
    if not reset_ok:
        record["label_evidence"] = ["Initial fault reset failed"]
        return record, [], None

    time.sleep(4)
    if not verify_recovery(timeout_s=30):
        record["label_evidence"] = ["System did not reach healthy state before experiment"]
        return record, [], None

    raw_rows = []
    snapshot_map = {}

    # T0 baseline before fault.
    baseline_rows = collect_snapshot(
        experiment_id, scenario["scenario"], "baseline", 0
    )
    raw_rows.extend(baseline_rows)
    snapshot_map["baseline"] = metrics_to_map(baseline_rows)

    # Apply and verify fault injection.
    if fault_type != "NONE" and fault_service:
        record["fault_injection_success"] = inject_fault(
            fault_service, fault_type, delay_ms
        )
        if not record["fault_injection_success"]:
            record["label_evidence"] = ["Fault injection endpoint did not confirm success"]
            reset_ok, _ = reset_all_faults()
            record["reset_success"] = reset_ok
            record["recovery_verified"] = verify_recovery()
            return record, raw_rows, None

    # Generate traffic and take snapshots at 10, 20, and 30 seconds.
    elapsed_start = time.time()
    for snapshot_index, elapsed_target in enumerate(SNAPSHOT_TIMES[1:], start=1):
        sent, succeeded = generate_load(n_orders=int(scenario["orders"]))
        record["orders_sent"] += sent
        record["orders_succeeded"] += succeeded

        remaining = elapsed_target - (time.time() - elapsed_start)
        if remaining > 0:
            time.sleep(remaining)

        phase = f"t{elapsed_target}"
        rows = collect_snapshot(
            experiment_id, scenario["scenario"], phase, elapsed_target
        )
        raw_rows.extend(rows)
        snapshot_map[phase] = metrics_to_map(rows)

    label, evidence = classify_cascade(snapshot_map, fault_service)
    record["label"] = label
    record["label_evidence"] = evidence

    # Always reset, then verify recovery before the next experiment.
    reset_ok, _ = reset_all_faults()
    record["reset_success"] = reset_ok
    time.sleep(3)
    record["recovery_verified"] = verify_recovery(timeout_s=45)

    # Do not trust an experiment if reset/recovery failed.
    if not record["reset_success"] or not record["recovery_verified"]:
        record["label"] = -1
        record["label_evidence"].append(
            "Experiment invalidated because reset/recovery was not verified"
        )

    feature_row = build_experiment_features(record, snapshot_map)
    return record, raw_rows, feature_row


def print_summary(dataset, log_df):
    print("\n================ DATASET SUMMARY ================")
    print(f"Experiments attempted : {len(log_df)}")
    print(f"Usable labelled rows  : {len(dataset)}")
    if not dataset.empty:
        print(f"Non-cascade (0)       : {(dataset['label'] == 0).sum()}")
        print(f"Cascade (1)           : {(dataset['label'] == 1).sum()}")
        print(f"Scenario groups       : {dataset['scenario'].nunique()}")
        print("\nRows by scenario and label:")
        print(dataset.groupby(["scenario", "label"]).size().to_string())
    print("\nUnlabelled/invalid experiments (-1):")
    print((log_df["label"] == -1).sum() if not log_df.empty else 0)
    print("=================================================\n")


def main(runs_per_scenario):
    if runs_per_scenario < 1:
        raise ValueError("--runs must be at least 1")

    os.makedirs(OUTPUT_DIR, exist_ok=True)
    wait_for_gateway()
    authenticate_gateway()

    all_raw_rows = []
    all_log_rows = []
    all_feature_rows = []

    total = len(SCENARIOS) * runs_per_scenario
    print(
        f"\nCollecting {len(SCENARIOS)} scenarios × {runs_per_scenario} runs "
        f"= {total} experiments"
    )

    with tqdm(total=total, unit="experiment") as progress:
        for scenario in SCENARIOS:
            for run_number in range(1, runs_per_scenario + 1):
                progress.set_description(
                    f"{scenario['scenario']} {run_number}/{runs_per_scenario}"
                )
                try:
                    log_row, raw_rows, feature_row = run_experiment(
                        scenario, run_number
                    )
                except KeyboardInterrupt:
                    raise
                except Exception as exc:
                    log_row = {
                        "experiment_id": str(uuid.uuid4()),
                        "timestamp": utc_now(),
                        "scenario": scenario["scenario"],
                        "fault_type": scenario["fault"],
                        "fault_service": scenario["service"] or "none",
                        "fault_delay_ms": scenario["delayMs"],
                        "fault_injection_success": False,
                        "reset_success": False,
                        "recovery_verified": False,
                        "orders_sent": 0,
                        "orders_succeeded": 0,
                        "run": run_number,
                        "label": -1,
                        "label_evidence": [f"Collector exception: {exc}"],
                    }
                    raw_rows = []
                    feature_row = None
                    print(f"\n[ERROR] {scenario['scenario']} run {run_number}: {exc}")

                all_log_rows.append(log_row)
                all_raw_rows.extend(raw_rows)
                if feature_row is not None and log_row["label"] in (0, 1):
                    all_feature_rows.append(feature_row)

                progress.update(1)

    raw_path = os.path.join(OUTPUT_DIR, "raw_metrics.csv")
    log_path = os.path.join(OUTPUT_DIR, "experiment_log.csv")
    dataset_path = os.path.join(OUTPUT_DIR, "dataset.csv")

    pd.DataFrame(all_raw_rows).to_csv(raw_path, index=False)
    log_df = pd.DataFrame(all_log_rows)
    if not log_df.empty:
        log_df["label_evidence"] = log_df["label_evidence"].apply(
            lambda value: " | ".join(value) if isinstance(value, list) else value
        )
    log_df.to_csv(log_path, index=False)

    dataset_df = pd.DataFrame(all_feature_rows)
    if not dataset_df.empty:
        # Do NOT fill missing telemetry with zero. The training pipeline should
        # fit an imputer on training data only.
        dataset_df = dataset_df.dropna(axis=1, how="all")
    dataset_df.to_csv(dataset_path, index=False)

    print(f"\nRaw time-series metrics : {raw_path} ({len(all_raw_rows)} rows)")
    print(f"Experiment audit log    : {log_path} ({len(log_df)} rows)")
    print(f"ML feature dataset      : {dataset_path} ({len(dataset_df)} rows)")
    print_summary(dataset_df, log_df)

    if dataset_df.empty:
        print(
            "[WARNING] No valid labelled experiments were produced. "
            "Inspect experiment_log.csv and Prometheus metrics."
        )
    elif dataset_df["label"].nunique() < 2:
        print(
            "[WARNING] Dataset currently contains only one class. "
            "Collect more independent experiments with both cascade and "
            "non-cascade outcomes before training a binary classifier."
        )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Collect measured cascading-failure telemetry for OmniStore"
    )
    parser.add_argument("--runs", type=int, default=5, help="Runs per scenario")
    parser.add_argument("--gateway", type=str, default=None, help="API Gateway URL")
    parser.add_argument("--prom", type=str, default=None, help="Prometheus URL")
    args = parser.parse_args()

    if args.gateway:
        GATEWAY_URL = args.gateway.rstrip("/")
    if args.prom:
        PROMETHEUS_URL = args.prom.rstrip("/")

    main(runs_per_scenario=args.runs)
