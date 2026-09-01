"""
Z-Score Anomaly Detection
=========================
Computes per-feature z-scores from the collected dataset and flags rows
where any service metric deviates significantly from the baseline (normal runs).

Usage
-----
  python zscore_anomaly.py --input ../data-collection/dataset/dataset.csv
  python zscore_anomaly.py --threshold 3.0

Output
------
  analysis/zscore_results.csv   — original data enriched with z-scores and anomaly flags
  analysis/anomaly_summary.txt  — per-feature anomaly statistics
"""

import argparse
import os
import sys

import numpy as np
import pandas as pd
from scipy import stats

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "output")


def compute_zscores(df: pd.DataFrame, threshold: float = 3.0) -> pd.DataFrame:
    """
    Compute z-scores for all numeric metric columns using only NORMAL rows
    as the baseline distribution.  Then apply to the full dataset.
    """
    df = df.copy()

    # Identify metric columns (exclude metadata)
    meta_cols = {"experiment_id", "timestamp", "scenario", "label", "run",
                 "fault_type", "fault_service", "fault_delay_ms"}
    metric_cols = [c for c in df.columns if c not in meta_cols and df[c].dtype in [np.float64, np.int64]]

    # Baseline: normal-operation rows only
    baseline = df[df["label"] == 0][metric_cols].copy()
    baseline_mean = baseline.mean()
    baseline_std  = baseline.std().replace(0, 1e-9)  # avoid divide-by-zero

    # Z-score every metric using the normal baseline parameters
    z_df = (df[metric_cols] - baseline_mean) / baseline_std
    z_df.columns = [f"z_{c}" for c in metric_cols]

    # Anomaly flag: any metric exceeds threshold
    df["max_zscore"]    = z_df.abs().max(axis=1)
    df["anomaly"]       = (z_df.abs() > threshold).any(axis=1).astype(int)
    df["anomaly_cols"]  = z_df.apply(
        lambda row: "|".join([c.replace("z_","") for c in z_df.columns if abs(row[c]) > threshold]),
        axis=1,
    )

    result = pd.concat([df, z_df], axis=1)
    return result, baseline_mean, baseline_std


def summarise(result: pd.DataFrame, threshold: float) -> str:
    lines = ["Z-Score Anomaly Detection - Summary", "=" * 50]

    total     = len(result)
    anomalies = result["anomaly"].sum()
    lines.append(f"Total rows    : {total}")
    lines.append(f"Anomalies     : {anomalies}  ({100*anomalies/total:.1f}%)")
    lines.append(f"Threshold     : +/-{threshold} sigma\n")

    lines.append("Anomaly detection per scenario:")
    grp = result.groupby("scenario").agg(
        rows=("label","count"),
        anomalies=("anomaly","sum"),
        mean_zscore=("max_zscore","mean"),
    ).round(3)
    lines.append(grp.to_string())

    lines.append("\nTop anomalous features (by frequency):")
    feat_counts = {}
    for row in result[result["anomaly"] == 1]["anomaly_cols"]:
        for feat in row.split("|"):
            if feat:
                feat_counts[feat] = feat_counts.get(feat, 0) + 1
    top = sorted(feat_counts.items(), key=lambda x: x[1], reverse=True)[:15]
    for feat, cnt in top:
        lines.append(f"  {feat:<50} {cnt}")

    return "\n".join(lines)


def main(input_path: str, threshold: float):
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    if not os.path.exists(input_path):
        print(f"Dataset not found: {input_path}")
        print("Run data-collection/collect_dataset.py first.")
        sys.exit(1)

    df = pd.read_csv(input_path)
    print(f"Loaded dataset: {len(df)} rows, {len(df.columns)} columns")

    result, baseline_mean, baseline_std = compute_zscores(df, threshold)

    # Save enriched dataset
    out_csv = os.path.join(OUTPUT_DIR, "zscore_results.csv")
    result.to_csv(out_csv, index=False)
    print(f"Z-score results -> {out_csv}")

    # Save summary
    summary = summarise(result, threshold)
    out_txt = os.path.join(OUTPUT_DIR, "anomaly_summary.txt")
    with open(out_txt, "w", encoding="utf-8") as f:
        f.write(summary)
    print(f"Summary         -> {out_txt}")
    print("\n" + summary)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--input",     default="../data-collection/dataset/dataset.csv")
    parser.add_argument("--threshold", type=float, default=3.0)
    args = parser.parse_args()
    main(args.input, args.threshold)
