"""
OmniStore Cascading Failure — Dataset Collector
================================================
Runs N experiments under different fault configurations, waits for the system
to produce traffic, then scrapes Prometheus metrics and writes a labelled CSV
dataset ready for the ML training phase.

Usage
-----
  python collect_dataset.py              # default: 5 runs per scenario
  python collect_dataset.py --runs 20   # 20 runs per scenario
  python collect_dataset.py --help

Output
------
  dataset/raw_metrics.csv   — full per-experiment metric snapshot
  dataset/dataset.csv       — cleaned, feature-engineered dataset for ML

Requirements
------------
  pip install -r requirements.txt
  The full Docker Compose stack must be running before executing this script.
"""

import argparse
import csv
import json
import os
import time
import uuid
from datetime import datetime

import numpy as np
import pandas as pd
import requests
from tqdm import tqdm

# ─── Configuration ────────────────────────────────────────────────────────────

GATEWAY_URL   = os.getenv("GATEWAY_URL",   "http://localhost:8080")
PROMETHEUS_URL = os.getenv("PROMETHEUS_URL", "http://localhost:9090")
OUTPUT_DIR    = os.path.join(os.path.dirname(__file__), "dataset")

SERVICES = [
    "order-service",
    "payment-service",
    "inventory-service",
    "shipping-service",
    "delivery-service",
    "notification-service",
]

# Each scenario: (fault_type, affected_service, delay_ms, label)
# label=0 → normal, label=1 → cascading failure
SCENARIOS = [
    # ── Normal runs ──────────────────────────────────────────────────────────
    {"fault": "NONE",    "service": None,                 "delayMs": 0,    "label": 0, "scenario": "NORMAL"},

    # ── Single service DOWN (503) ─────────────────────────────────────────────
    {"fault": "DOWN",    "service": "payment-service",    "delayMs": 0,    "label": 1, "scenario": "PAYMENT_DOWN"},
    {"fault": "DOWN",    "service": "inventory-service",  "delayMs": 0,    "label": 1, "scenario": "INVENTORY_DOWN"},
    {"fault": "DOWN",    "service": "shipping-service",   "delayMs": 0,    "label": 1, "scenario": "SHIPPING_DOWN"},
    {"fault": "DOWN",    "service": "notification-service","delayMs": 0,   "label": 1, "scenario": "NOTIFICATION_DOWN"},
    {"fault": "DOWN",    "service": "delivery-service",   "delayMs": 0,    "label": 1, "scenario": "DELIVERY_DOWN"},

    # ── Single service ERROR (500) ────────────────────────────────────────────
    {"fault": "ERROR",   "service": "payment-service",    "delayMs": 0,    "label": 1, "scenario": "PAYMENT_ERROR"},
    {"fault": "ERROR",   "service": "inventory-service",  "delayMs": 0,    "label": 1, "scenario": "INVENTORY_ERROR"},
    {"fault": "ERROR",   "service": "shipping-service",   "delayMs": 0,    "label": 1, "scenario": "SHIPPING_ERROR"},

    # ── High latency ──────────────────────────────────────────────────────────
    {"fault": "LATENCY", "service": "payment-service",    "delayMs": 3000, "label": 1, "scenario": "PAYMENT_LATENCY_3S"},
    {"fault": "LATENCY", "service": "inventory-service",  "delayMs": 2000, "label": 1, "scenario": "INVENTORY_LATENCY_2S"},
    {"fault": "LATENCY", "service": "shipping-service",   "delayMs": 3000, "label": 1, "scenario": "SHIPPING_LATENCY_3S"},

    # ── Cascading: payment down → order cascade fails ─────────────────────────
    {"fault": "DOWN",    "service": "payment-service",    "delayMs": 0,    "label": 1, "scenario": "CASCADE_PAYMENT_DOWN"},
    {"fault": "DOWN",    "service": "shipping-service",   "delayMs": 0,    "label": 1, "scenario": "CASCADE_SHIPPING_DOWN"},
]

# Prometheus metric queries per service (use {application=} label)
# Each query returns a single float value per service
METRIC_QUERIES = {
    "request_rate":    'sum(rate(http_server_requests_seconds_count{{application="{svc}"}}[1m]))',
    "error_rate_5xx":  'sum(rate(http_server_requests_seconds_count{{application="{svc}",status=~"5.."}}[1m]))',
    "error_rate_4xx":  'sum(rate(http_server_requests_seconds_count{{application="{svc}",status=~"4.."}}[1m]))',
    "p99_latency_s":   'histogram_quantile(0.99, sum(rate(http_server_requests_seconds_bucket{{application="{svc}"}}[1m])) by (le))',
    "p95_latency_s":   'histogram_quantile(0.95, sum(rate(http_server_requests_seconds_bucket{{application="{svc}"}}[1m])) by (le))',
    "p50_latency_s":   'histogram_quantile(0.50, sum(rate(http_server_requests_seconds_bucket{{application="{svc}"}}[1m])) by (le))',
    "jvm_heap_mb":     'jvm_memory_used_bytes{{application="{svc}",area="heap"}} / 1048576',
    "active_threads":  'tomcat_threads_busy_threads{{application="{svc}"}}',
    "service_up":      'up{{job="{svc}"}}',
}

# ─── Helpers ──────────────────────────────────────────────────────────────────

def inject_fault(service: str, fault: str, delay_ms: int = 0):
    """Send fault configuration to a specific service via the API Gateway."""
    url = f"{GATEWAY_URL}/fault/{service}/configure"
    payload = {"fault": fault, "delayMs": delay_ms}
    try:
        resp = requests.post(url, json=payload, timeout=5)
        return resp.status_code == 200
    except Exception as e:
        print(f"  [WARN] Could not inject fault on {service}: {e}")
        return False


def reset_all_faults():
    """Reset every service back to NONE."""
    for svc in SERVICES:
        url = f"{GATEWAY_URL}/fault/{svc}/reset"
        try:
            requests.post(url, timeout=5)
        except Exception:
            pass


def prom_query(query: str) -> float:
    """Execute an instant PromQL query and return the scalar result (or NaN)."""
    try:
        resp = requests.get(
            f"{PROMETHEUS_URL}/api/v1/query",
            params={"query": query},
            timeout=10,
        )
        data = resp.json()
        results = data.get("data", {}).get("result", [])
        if results:
            return float(results[0]["value"][1])
        return float("nan")
    except Exception:
        return float("nan")


def collect_metrics(scenario_name: str, label: int) -> dict:
    """Scrape all Prometheus metrics for all services and return a flat dict."""
    row = {
        "experiment_id": str(uuid.uuid4())[:8],
        "timestamp":     datetime.utcnow().isoformat(),
        "scenario":      scenario_name,
        "label":         label,
    }
    for svc in SERVICES:
        svc_key = svc.replace("-service", "").replace("-", "_")
        for metric_name, query_template in METRIC_QUERIES.items():
            query = query_template.format(svc=svc)
            value = prom_query(query)
            col   = f"{svc_key}_{metric_name}"
            row[col] = round(value, 6) if not (value != value) else None  # NaN → None
    return row


def generate_load(n_orders: int = 5):
    """Send a burst of orders through the gateway to produce traffic/metrics."""
    inventory_resp = requests.get(f"{GATEWAY_URL}/inventory", timeout=5)
    products = inventory_resp.json() if inventory_resp.ok else []

    for i in range(n_orders):
        product_id = products[i % len(products)]["productId"] if products else 101 + i
        payload = {
            "customerId": 900 + i,
            "productId":  product_id,
            "quantity":   1,
            "amount":     99.99,
            "shippingAddress": f"Test Address #{i}",
        }
        try:
            requests.post(f"{GATEWAY_URL}/orders", json=payload, timeout=10)
        except Exception:
            pass  # Expected when service is DOWN
        time.sleep(0.3)


def wait_for_gateway(timeout_s: int = 120):
    """Block until the API Gateway is reachable."""
    print("Waiting for API Gateway to be ready...")
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        try:
            r = requests.get(f"{GATEWAY_URL}/gateway/health", timeout=3)
            if r.status_code == 200:
                print("  Gateway is UP.")
                return True
        except Exception:
            pass
        time.sleep(3)
    raise RuntimeError(f"API Gateway did not become available within {timeout_s}s")


# ─── Main ─────────────────────────────────────────────────────────────────────

def main(runs_per_scenario: int):
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    raw_path = os.path.join(OUTPUT_DIR, "raw_metrics.csv")

    wait_for_gateway()
    reset_all_faults()
    time.sleep(5)

    all_rows = []
    total = len(SCENARIOS) * runs_per_scenario

    print(f"\nStarting data collection: {len(SCENARIOS)} scenarios × {runs_per_scenario} runs = {total} experiments\n")

    with tqdm(total=total, unit="run") as pbar:
        for scenario in SCENARIOS:
            fault_type = scenario["fault"]
            svc        = scenario["service"]
            delay_ms   = scenario["delayMs"]
            label      = scenario["label"]
            sc_name    = scenario["scenario"]

            for run in range(runs_per_scenario):
                pbar.set_description(f"{sc_name} run {run+1}/{runs_per_scenario}")

                # 1. Apply fault (if any)
                reset_all_faults()
                if fault_type != "NONE" and svc:
                    inject_fault(svc, fault_type, delay_ms)
                time.sleep(2)  # Let fault propagate

                # 2. Generate traffic
                try:
                    generate_load(n_orders=6)
                except Exception:
                    pass

                # 3. Wait for Prometheus to scrape (scrape interval = 10s)
                time.sleep(12)

                # 4. Collect metrics snapshot
                row = collect_metrics(sc_name, label)
                row["run"]           = run + 1
                row["fault_type"]    = fault_type
                row["fault_service"] = svc or "none"
                row["fault_delay_ms"] = delay_ms
                all_rows.append(row)

                # 5. Reset before next run
                reset_all_faults()
                time.sleep(3)

                pbar.update(1)

    # ── Write raw CSV ─────────────────────────────────────────────────────────
    if not all_rows:
        print("No data collected.")
        return

    df = pd.DataFrame(all_rows)
    df.to_csv(raw_path, index=False)
    print(f"\nRaw dataset saved -> {raw_path}  ({len(df)} rows, {len(df.columns)} columns)")

    # ── Feature engineering & clean dataset ──────────────────────────────────
    feature_df = engineer_features(df)
    clean_path = os.path.join(OUTPUT_DIR, "dataset.csv")
    feature_df.to_csv(clean_path, index=False)
    print(f"Feature dataset saved -> {clean_path}  ({len(feature_df)} rows, {len(feature_df.columns)} columns)")

    print_summary(feature_df)


def engineer_features(df: pd.DataFrame) -> pd.DataFrame:
    """
    Compute derived features that the ML model will use:
      - error_rate_ratio: 5xx / total requests (per service)
      - latency_spike:    p99 / p50 ratio (per service)
      - system_error_rate: mean 5xx rate across ALL services
      - max_p99_latency:   worst p99 across all services
      - num_services_down: count of services where service_up == 0
    """
    df = df.copy()
    numeric_cols = df.select_dtypes(include=[np.number]).columns.tolist()
    df[numeric_cols] = df[numeric_cols].fillna(0)

    services_short = [s.replace("-service", "").replace("-", "_") for s in SERVICES]

    # Per-service derived features
    for s in services_short:
        rr  = f"{s}_request_rate"
        e5  = f"{s}_error_rate_5xx"
        p99 = f"{s}_p99_latency_s"
        p50 = f"{s}_p50_latency_s"

        if rr in df.columns and e5 in df.columns:
            df[f"{s}_error_ratio"] = df[e5] / (df[rr] + 1e-9)
        if p99 in df.columns and p50 in df.columns:
            df[f"{s}_latency_spike"] = df[p99] / (df[p50] + 1e-9)

    # System-level aggregates
    error_5xx_cols = [f"{s}_error_rate_5xx" for s in services_short if f"{s}_error_rate_5xx" in df.columns]
    p99_cols       = [f"{s}_p99_latency_s"  for s in services_short if f"{s}_p99_latency_s"  in df.columns]
    up_cols        = [f"{s}_service_up"     for s in services_short if f"{s}_service_up"      in df.columns]

    if error_5xx_cols:
        df["system_mean_error_rate"] = df[error_5xx_cols].mean(axis=1)
        df["system_max_error_rate"]  = df[error_5xx_cols].max(axis=1)
    if p99_cols:
        df["system_max_p99_latency"] = df[p99_cols].max(axis=1)
        df["system_mean_p99_latency"] = df[p99_cols].mean(axis=1)
    if up_cols:
        df["num_services_down"] = (df[up_cols] == 0).sum(axis=1)

    return df


def print_summary(df: pd.DataFrame):
    print("\n── Dataset Summary ──────────────────────────────────────────")
    print(f"  Total rows       : {len(df)}")
    print(f"  Normal (label=0) : {(df['label'] == 0).sum()}")
    print(f"  Failure (label=1): {(df['label'] == 1).sum()}")
    print(f"  Features         : {len(df.columns) - 5} (excl. meta columns)")
    print(f"  Scenarios        : {df['scenario'].nunique()}")
    print("\n  Class balance:")
    print(df.groupby("scenario")["label"].count().to_string())
    print("─────────────────────────────────────────────────────────────\n")


# ─── Entry point ──────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="OmniStore failure dataset collector")
    parser.add_argument("--runs",    type=int, default=5,   help="Runs per scenario (default: 5)")
    parser.add_argument("--gateway", type=str, default=None, help="Override gateway URL")
    parser.add_argument("--prom",    type=str, default=None, help="Override Prometheus URL")
    args = parser.parse_args()

    if args.gateway:
        GATEWAY_URL = args.gateway
    if args.prom:
        PROMETHEUS_URL = args.prom

    main(runs_per_scenario=args.runs)
