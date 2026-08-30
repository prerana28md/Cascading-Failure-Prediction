"""
Cascading Failure Prediction — Random Forest Classifier
=========================================================
Trains a Random Forest model to predict whether a service metric snapshot
represents a cascading failure in progress.

Pipeline
--------
  1. Load feature-engineered dataset (output of analysis scripts)
  2. Drop meta columns, impute missing values
  3. SMOTE oversampling to handle class imbalance
  4. Train/test split (80/20, stratified)
  5. Hyperparameter search (GridSearchCV)
  6. Evaluate on test set
  7. Save model, scaler, feature list, and evaluation report

Usage
-----
  python train.py
  python train.py --dataset ../data-collection/dataset/dataset.csv
  python train.py --dataset ../analysis/output/graph_enriched_dataset.csv

Outputs
-------
  ml/model/cascade_rf_model.joblib   — trained RandomForest
  ml/model/scaler.joblib             — fitted StandardScaler
  ml/model/features.json             — ordered feature list
  ml/model/evaluation_report.txt     — classification report + confusion matrix
  ml/model/feature_importance.png    — top-30 feature importance chart
"""

import argparse
import json
import os
import sys
import warnings

warnings.filterwarnings("ignore")

import joblib
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import seaborn as sns
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import (
    classification_report,
    confusion_matrix,
    f1_score,
    roc_auc_score,
)
from sklearn.model_selection import GridSearchCV, StratifiedKFold, train_test_split
from sklearn.preprocessing import StandardScaler

try:
    from imblearn.over_sampling import SMOTE
    HAS_SMOTE = True
except ImportError:
    HAS_SMOTE = False

MODEL_DIR = os.path.join(os.path.dirname(__file__), "model")

# Columns to always exclude from features
META_COLS = {
    "experiment_id", "timestamp", "scenario", "label", "run",
    "fault_type", "fault_service", "fault_delay_ms",
    "anomaly", "anomaly_cols", "max_zscore",
}


def load_dataset(path: str) -> pd.DataFrame:
    if not os.path.exists(path):
        print(f"Dataset not found: {path}")
        print("Run data-collection/collect_dataset.py first.")
        sys.exit(1)
    df = pd.read_csv(path)
    print(f"Loaded dataset: {len(df)} rows, {len(df.columns)} columns")
    return df


def prepare_features(df: pd.DataFrame):
    """Select numeric feature columns, impute, return X, y, feature_names."""
    feature_cols = [
        c for c in df.columns
        if c not in META_COLS
        and df[c].dtype in [np.float64, np.float32, np.int64, np.int32]
    ]

    X = df[feature_cols].copy()
    y = df["label"].values

    # Impute: replace NaN/inf with column median
    X = X.replace([np.inf, -np.inf], np.nan)
    for col in X.columns:
        med = X[col].median()
        X[col] = X[col].fillna(med if not np.isnan(med) else 0)

    print(f"Features selected: {len(feature_cols)}")
    print(f"Class distribution: {dict(zip(*np.unique(y, return_counts=True)))}")

    return X.values, y, feature_cols


def train(dataset_path: str):
    os.makedirs(MODEL_DIR, exist_ok=True)

    df = load_dataset(dataset_path)

    if "label" not in df.columns:
        print("ERROR: 'label' column missing from dataset.")
        sys.exit(1)

    X, y, feature_names = prepare_features(df)

    # ── Scale ────────────────────────────────────────────────────────────────
    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)

    # ── Train / test split ───────────────────────────────────────────────────
    X_train, X_test, y_train, y_test = train_test_split(
        X_scaled, y, test_size=0.2, random_state=42, stratify=y
    )
    print(f"Train: {len(X_train)} | Test: {len(X_test)}")

    # ── SMOTE oversampling on training set ───────────────────────────────────
    if HAS_SMOTE and len(np.unique(y_train)) > 1:
        min_class_count = min(np.bincount(y_train))
        k_neighbors = min(5, min_class_count - 1)
        if k_neighbors >= 1:
            sm = SMOTE(random_state=42, k_neighbors=k_neighbors)
            X_train, y_train = sm.fit_resample(X_train, y_train)
            print(f"After SMOTE — Train: {len(X_train)} | Distribution: {dict(zip(*np.unique(y_train, return_counts=True)))}")
    else:
        if not HAS_SMOTE:
            print("[INFO] imbalanced-learn not installed — skipping SMOTE. Run: pip install imbalanced-learn")

    # ── Hyperparameter search ─────────────────────────────────────────────────
    print("\nRunning GridSearchCV (this may take a minute)...")
    param_grid = {
        "n_estimators":      [100, 200],
        "max_depth":         [None, 10, 20],
        "min_samples_split": [2, 5],
        "min_samples_leaf":  [1, 2],
        "max_features":      ["sqrt", "log2"],
    }
    cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)
    rf_base = RandomForestClassifier(
        random_state=42,
        class_weight="balanced",
        n_jobs=-1,
    )
    grid_search = GridSearchCV(
        rf_base,
        param_grid,
        cv=cv,
        scoring="f1_weighted",
        n_jobs=-1,
        verbose=0,
    )
    grid_search.fit(X_train, y_train)
    best_rf = grid_search.best_estimator_
    print(f"Best params: {grid_search.best_params_}")
    print(f"Best CV F1: {grid_search.best_score_:.4f}")

    # ── Evaluate on test set ──────────────────────────────────────────────────
    y_pred = best_rf.predict(X_test)
    y_prob = best_rf.predict_proba(X_test)[:, 1] if len(np.unique(y)) == 2 else None

    report_lines = []
    report_lines.append("=" * 60)
    report_lines.append("Cascading Failure Prediction — Evaluation Report")
    report_lines.append("=" * 60)
    report_lines.append(f"\nDataset       : {dataset_path}")
    report_lines.append(f"Features      : {len(feature_names)}")
    report_lines.append(f"Train samples : {len(X_train)}")
    report_lines.append(f"Test samples  : {len(X_test)}")
    report_lines.append(f"\nBest hyperparameters:\n  {grid_search.best_params_}")
    report_lines.append(f"\nClassification Report:\n")
    report_lines.append(classification_report(y_test, y_pred,
                                               target_names=["Normal", "Cascade Failure"]))
    f1  = f1_score(y_test, y_pred, average="weighted")
    report_lines.append(f"Weighted F1   : {f1:.4f}")

    if y_prob is not None:
        auc = roc_auc_score(y_test, y_prob)
        report_lines.append(f"ROC-AUC       : {auc:.4f}")

    report_lines.append("\nConfusion Matrix (rows=Actual, cols=Predicted):")
    cm = confusion_matrix(y_test, y_pred)
    report_lines.append(str(cm))

    report_text = "\n".join(report_lines)
    print("\n" + report_text)

    report_path = os.path.join(MODEL_DIR, "evaluation_report.txt")
    with open(report_path, "w") as f:
        f.write(report_text)

    # ── Confusion matrix heatmap ──────────────────────────────────────────────
    plt.figure(figsize=(6, 5))
    sns.heatmap(cm, annot=True, fmt="d", cmap="Blues",
                xticklabels=["Normal", "Cascade"],
                yticklabels=["Normal", "Cascade"])
    plt.title("Confusion Matrix")
    plt.ylabel("Actual")
    plt.xlabel("Predicted")
    plt.tight_layout()
    plt.savefig(os.path.join(MODEL_DIR, "confusion_matrix.png"), dpi=150)
    plt.close()

    # ── Feature importance chart ──────────────────────────────────────────────
    importances = best_rf.feature_importances_
    indices = np.argsort(importances)[::-1][:30]
    top_features = [feature_names[i] for i in indices]
    top_scores   = importances[indices]

    plt.figure(figsize=(10, 8))
    plt.barh(range(len(top_features)), top_scores[::-1], color="#4f46e5")
    plt.yticks(range(len(top_features)), [f.replace("_", " ") for f in top_features[::-1]])
    plt.xlabel("Feature Importance")
    plt.title("Top-30 Feature Importances — Cascade Failure RF Model")
    plt.tight_layout()
    plt.savefig(os.path.join(MODEL_DIR, "feature_importance.png"), dpi=150)
    plt.close()

    # ── Save model artefacts ──────────────────────────────────────────────────
    joblib.dump(best_rf, os.path.join(MODEL_DIR, "cascade_rf_model.joblib"))
    joblib.dump(scaler,  os.path.join(MODEL_DIR, "scaler.joblib"))
    with open(os.path.join(MODEL_DIR, "features.json"), "w") as f:
        json.dump(feature_names, f, indent=2)

    print(f"\nModel saved       → {MODEL_DIR}/cascade_rf_model.joblib")
    print(f"Scaler saved      → {MODEL_DIR}/scaler.joblib")
    print(f"Features saved    → {MODEL_DIR}/features.json")
    print(f"Evaluation report → {MODEL_DIR}/evaluation_report.txt")
    print(f"Feature chart     → {MODEL_DIR}/feature_importance.png")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--dataset",
        default="../data-collection/dataset/dataset.csv",
        help="Path to the feature dataset CSV"
    )
    args = parser.parse_args()
    train(args.dataset)
