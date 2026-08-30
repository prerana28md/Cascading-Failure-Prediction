"""
Temporal Analysis
=================
Analyses how metrics change over time (run order) within each scenario.
Computes rolling statistics, rate-of-change, and detects the propagation
delay between a fault being injected and downstream services degrading.

Usage
-----
  python temporal_analysis.py --input ../data-collection/dataset/dataset.csv

Output
------
  analysis/output/temporal_features.csv  — dataset enriched with temporal features
  analysis/output/propagation_delays.csv — estimated fault propagation delays per scenario
"""

import argparse
import os
import sys

import numpy as np
import pandas as pd

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "output")

SERVICES_SHORT = [
    "order", "payment", "inventory", "shipping", "delivery", "notification"
]


def add_temporal_features(df: pd.DataFrame) -> pd.DataFrame:
    """
    Within each scenario group (sorted by run), compute:
      - rolling_mean_error   : 3-run rolling mean of system_mean_error_rate
      - rolling_std_error    : 3-run rolling std of system_mean_error_rate
      - delta_error_rate     : change in system_mean_error_rate vs previous run
      - delta_latency        : change in system_max_p99_latency vs previous run
      - acceleration_error   : second derivative of error rate (rate of change of change)
    """
    df = df.sort_values(["scenario", "run"]).copy()
    results = []

    for scenario, grp in df.groupby("scenario"):
        grp = grp.copy().reset_index(drop=True)

        if "system_mean_error_rate" in grp.columns:
            grp["rolling_mean_error"]  = grp["system_mean_error_rate"].rolling(3, min_periods=1).mean()
            grp["rolling_std_error"]   = grp["system_mean_error_rate"].rolling(3, min_periods=1).std().fillna(0)
            grp["delta_error_rate"]    = grp["system_mean_error_rate"].diff().fillna(0)
            grp["acceleration_error"]  = grp["delta_error_rate"].diff().fillna(0)

        if "system_max_p99_latency" in grp.columns:
            grp["delta_latency"]       = grp["system_max_p99_latency"].diff().fillna(0)
            grp["rolling_mean_latency"] = grp["system_max_p99_latency"].rolling(3, min_periods=1).mean()

        if "num_services_down" in grp.columns:
            grp["delta_services_down"] = grp["num_services_down"].diff().fillna(0)

        results.append(grp)

    return pd.concat(results, ignore_index=True)


def estimate_propagation_delays(df: pd.DataFrame) -> pd.DataFrame:
    """
    For each failure scenario, estimate how many 'runs' (time steps) it takes
    for the error to propagate to downstream services after the fault is injected.

    Heuristic: the run at which system_mean_error_rate first exceeds 2× the
    normal baseline mean.
    """
    records = []
    normal_base = df[df["label"] == 0]["system_mean_error_rate"].mean() if "system_mean_error_rate" in df.columns else 0
    threshold = max(normal_base * 2, 0.01)

    for scenario, grp in df[df["label"] == 1].groupby("scenario"):
        grp = grp.sort_values("run")
        if "system_mean_error_rate" not in grp.columns:
            continue
        exceeded = grp[grp["system_mean_error_rate"] > threshold]
        first_run = int(exceeded["run"].min()) if not exceeded.empty else -1

        # Per-service error onset
        svc_onsets = {}
        for svc in SERVICES_SHORT:
            col = f"{svc}_error_rate_5xx"
            if col in grp.columns:
                svc_exc = grp[grp[col] > threshold]
                svc_onsets[f"{svc}_onset_run"] = int(svc_exc["run"].min()) if not svc_exc.empty else -1

        records.append({
            "scenario":             scenario,
            "fault_service":        grp["fault_service"].iloc[0],
            "fault_type":           grp["fault_type"].iloc[0],
            "system_onset_run":     first_run,
            "total_runs":           len(grp),
            **svc_onsets,
        })

    return pd.DataFrame(records)


def main(input_path: str):
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    if not os.path.exists(input_path):
        print(f"Dataset not found: {input_path}")
        sys.exit(1)

    df = pd.read_csv(input_path)
    print(f"Loaded: {len(df)} rows")

    # Temporal feature engineering
    temporal_df = add_temporal_features(df)
    out_temporal = os.path.join(OUTPUT_DIR, "temporal_features.csv")
    temporal_df.to_csv(out_temporal, index=False)
    print(f"Temporal features → {out_temporal}")

    # Propagation delay analysis
    prop_df = estimate_propagation_delays(temporal_df)
    out_prop = os.path.join(OUTPUT_DIR, "propagation_delays.csv")
    prop_df.to_csv(out_prop, index=False)
    print(f"Propagation delays → {out_prop}")

    if not prop_df.empty:
        print("\nPropagation delay per scenario:")
        print(prop_df[["scenario", "fault_service", "fault_type", "system_onset_run"]].to_string(index=False))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", default="../data-collection/dataset/dataset.csv")
    args = parser.parse_args()
    main(args.input)
