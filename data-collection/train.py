"""
Leakage-aware Random Forest training for cascading-failure prediction.

Compatible with the corrected collect_dataset.py:
  dataset/dataset.csv
  dataset/experiment_log.csv (not required for training)

Key safeguards:
- One row per experiment is expected.
- Splits by scenario group so runs from the same scenario cannot appear
  in both train and test.
- Fits median imputation on training data only.
- Uses class_weight="balanced" instead of applying SMOTE before splitting.
- Excludes experiment metadata, labels, scenario names and fault descriptions
  from model features.
- Saves model, imputer, scaler and feature schema for predict_api.py.

Run from the data-collection folder:
    python train.py

Optional:
    python train.py --dataset dataset/dataset.csv --test-size 0.25
"""

import argparse
import json
import os
import warnings

import joblib
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt

from sklearn.ensemble import RandomForestClassifier
from sklearn.impute import SimpleImputer
from sklearn.metrics import (
    accuracy_score,
    classification_report,
    confusion_matrix,
    ConfusionMatrixDisplay,
    f1_score,
    precision_score,
    recall_score,
    roc_auc_score,
)
from sklearn.model_selection import StratifiedGroupKFold
from sklearn.preprocessing import StandardScaler


RANDOM_STATE = 42

# These are identifiers, outcomes, or experiment descriptors—not telemetry.
EXCLUDED_COLUMNS = {
    "experiment_id",
    "timestamp",
    "scenario",
    "label",
    "label_evidence",
    "fault_type",
    "fault_service",
    "fault_delay_ms",
    "fault_injection_success",
    "reset_success",
    "recovery_verified",
    "orders_sent",
    "orders_succeeded",
    "run",
}


def load_dataset(path):
    if not os.path.exists(path):
        raise FileNotFoundError(
            f"Dataset not found: {path}\n"
            "Run collect_dataset.py first."
        )

    df = pd.read_csv(path)
    if df.empty:
        raise ValueError("dataset.csv is empty. Collect experiments first.")

    required = {"label", "scenario"}
    missing = required - set(df.columns)
    if missing:
        raise ValueError(f"dataset.csv is missing required columns: {sorted(missing)}")

    # Only rows with explicitly valid binary labels are used.
    df["label"] = pd.to_numeric(df["label"], errors="coerce")
    df = df[df["label"].isin([0, 1])].copy()
    df["label"] = df["label"].astype(int)

    if df.empty:
        raise ValueError("No rows with label 0 or 1 were found.")

    if df["scenario"].isna().any():
        raise ValueError("Some rows have no scenario group; fix dataset.csv first.")

    return df


def prepare_features(df):
    candidate_columns = [
        column for column in df.columns
        if column not in EXCLUDED_COLUMNS
    ]

    # Convert candidate feature columns to numeric; non-numeric columns are
    # excluded rather than encoded as hidden metadata.
    X = df[candidate_columns].copy()
    for column in X.columns:
        X[column] = pd.to_numeric(X[column], errors="coerce")

    # Remove columns with no observed values and constant columns.
    X = X.dropna(axis=1, how="all")
    constant_columns = [
        column for column in X.columns
        if X[column].nunique(dropna=True) <= 1
    ]
    X = X.drop(columns=constant_columns)

    if X.shape[1] == 0:
        raise ValueError("No usable numeric telemetry features were found.")

    if X.isna().all(axis=1).any():
        # Keep rows: the imputer handles missing values using training medians.
        pass

    return X, list(X.columns), constant_columns


def choose_grouped_split(X, y, groups, test_size=0.25):
    """
    Find a stratified group split. A scenario group is kept entirely in
    train or test. Requires at least two distinct scenario groups per class.
    """
    group_table = pd.DataFrame({"group": groups, "label": y})
    group_class_counts = group_table.drop_duplicates().groupby("label")["group"].nunique()

    for class_value in (0, 1):
        count = int(group_class_counts.get(class_value, 0))
        if count < 2:
            raise ValueError(
                f"Grouped evaluation needs at least 2 distinct scenario groups "
                f"for class {class_value}, but found {count}. "
                "Collect more independently designed scenarios whose measured "
                "outcomes produce this class. Do not split repeated runs "
                "randomly just to obtain a score."
            )

    # Try multiple deterministic stratified group folds and select the fold
    # whose test fraction is closest to the requested test_size.
    n_groups_per_class = int(group_class_counts.min())
    n_splits = min(5, n_groups_per_class)
    splitter = StratifiedGroupKFold(
        n_splits=n_splits, shuffle=True, random_state=RANDOM_STATE
    )

    best = None
    best_distance = float("inf")

    for train_idx, test_idx in splitter.split(X, y, groups):
        y_train = y.iloc[train_idx]
        y_test = y.iloc[test_idx]
        if y_train.nunique() < 2 or y_test.nunique() < 2:
            continue

        fraction = len(test_idx) / len(y)
        distance = abs(fraction - test_size)
        if distance < best_distance:
            best = (train_idx, test_idx)
            best_distance = distance

    if best is None:
        raise ValueError(
            "Could not create a grouped train/test split containing both classes "
            "in train and test. Add more independent scenario groups for each "
            "class, then rerun training."
        )

    return best


def save_evaluation(y_test, predictions, probabilities, output_dir):
    cm = confusion_matrix(y_test, predictions, labels=[0, 1])

    report = classification_report(
        y_test,
        predictions,
        labels=[0, 1],
        target_names=["No observed cascade", "Observed cascade"],
        zero_division=0,
    )

    accuracy = accuracy_score(y_test, predictions)
    precision = precision_score(y_test, predictions, zero_division=0)
    recall = recall_score(y_test, predictions, zero_division=0)
    f1 = f1_score(y_test, predictions, zero_division=0)

    try:
        roc_auc = roc_auc_score(y_test, probabilities)
    except ValueError:
        roc_auc = None

    metrics = {
        "accuracy": float(accuracy),
        "precision": float(precision),
        "recall": float(recall),
        "f1": float(f1),
        "roc_auc": float(roc_auc) if roc_auc is not None else None,
        "test_samples": int(len(y_test)),
        "confusion_matrix": cm.tolist(),
    }

    with open(os.path.join(output_dir, "metrics.json"), "w", encoding="utf-8") as f:
        json.dump(metrics, f, indent=4)

    report_text = (
        "CASCADING FAILURE RANDOM FOREST EVALUATION\n"
        "==========================================\n\n"
        f"Test samples: {len(y_test)}\n"
        f"Accuracy:  {accuracy:.4f}\n"
        f"Precision: {precision:.4f}\n"
        f"Recall:    {recall:.4f}\n"
        f"F1-score:  {f1:.4f}\n"
        f"ROC-AUC:   {roc_auc:.4f}\n" if roc_auc is not None else
        "CASCADING FAILURE RANDOM FOREST EVALUATION\n"
        "==========================================\n\n"
        f"Test samples: {len(y_test)}\n"
        f"Accuracy:  {accuracy:.4f}\n"
        f"Precision: {precision:.4f}\n"
        f"Recall:    {recall:.4f}\n"
        f"F1-score:  {f1:.4f}\n"
        "ROC-AUC:   Not available\n"
    )
    report_text += "\nClassification report\n---------------------\n"
    report_text += report
    report_text += "\nConfusion matrix (rows=true, columns=predicted; labels 0,1)\n"
    report_text += np.array2string(cm)

    with open(
        os.path.join(output_dir, "evaluation_report.txt"), "w", encoding="utf-8"
    ) as f:
        f.write(report_text)

    fig, ax = plt.subplots(figsize=(6, 5))
    ConfusionMatrixDisplay(
        confusion_matrix=cm,
        display_labels=["No cascade", "Cascade"],
    ).plot(ax=ax, values_format="d", colorbar=False)
    ax.set_title("Random Forest — Grouped Test Set")
    fig.tight_layout()
    fig.savefig(os.path.join(output_dir, "confusion_matrix.png"), dpi=160)
    plt.close(fig)

    return metrics


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--dataset", default=os.path.join("dataset", "dataset.csv")
    )
    parser.add_argument("--output-dir", default=os.path.join("model"))
    parser.add_argument("--test-size", type=float, default=0.25)
    parser.add_argument("--trees", type=int, default=300)
    args = parser.parse_args()

    if not 0.1 <= args.test_size <= 0.5:
        raise ValueError("--test-size must be between 0.1 and 0.5")

    os.makedirs(args.output_dir, exist_ok=True)

    df = load_dataset(args.dataset)
    X, feature_names, dropped_constants = prepare_features(df)
    y = df["label"].reset_index(drop=True)
    groups = df["scenario"].astype(str).reset_index(drop=True)
    X = X.reset_index(drop=True)

    print("\n================ DATASET OVERVIEW ================")
    print(f"Valid experiments : {len(df)}")
    print(f"Telemetry features: {len(feature_names)}")
    print(f"Scenario groups   : {groups.nunique()}")
    print(f"Class 0           : {(y == 0).sum()}")
    print(f"Class 1           : {(y == 1).sum()}")
    print("\nScenario group counts:")
    print(pd.DataFrame({"scenario": groups, "label": y})
          .groupby(["scenario", "label"]).size().to_string())
    print("==================================================\n")

    train_idx, test_idx = choose_grouped_split(
        X, y, groups, test_size=args.test_size
    )

    X_train = X.iloc[train_idx]
    X_test = X.iloc[test_idx]
    y_train = y.iloc[train_idx]
    y_test = y.iloc[test_idx]

    train_groups = set(groups.iloc[train_idx])
    test_groups = set(groups.iloc[test_idx])
    overlap = train_groups.intersection(test_groups)
    if overlap:
        raise RuntimeError(f"Scenario leakage detected: {sorted(overlap)}")

    print(f"Training experiments: {len(train_idx)}")
    print(f"Testing experiments : {len(test_idx)}")
    print(f"Training scenarios  : {sorted(train_groups)}")
    print(f"Testing scenarios   : {sorted(test_groups)}")

    # Fit preprocessing only on training data.
    imputer = SimpleImputer(strategy="median")
    X_train_imputed = imputer.fit_transform(X_train)
    X_test_imputed = imputer.transform(X_test)

    # Scaling is retained for compatibility with the existing prediction API.
    # Random Forest itself does not require feature scaling.
    scaler = StandardScaler()
    X_train_scaled = scaler.fit_transform(X_train_imputed)
    X_test_scaled = scaler.transform(X_test_imputed)

    model = RandomForestClassifier(
        n_estimators=args.trees,
        random_state=RANDOM_STATE,
        class_weight="balanced",
        max_features="sqrt",
        min_samples_leaf=1,
        n_jobs=-1,
    )
    model.fit(X_train_scaled, y_train)

    predictions = model.predict(X_test_scaled)
    probabilities = model.predict_proba(X_test_scaled)[:, list(model.classes_).index(1)]

    metrics = save_evaluation(
        y_test.reset_index(drop=True),
        predictions,
        probabilities,
        args.output_dir,
    )

    # Feature importance is for interpretation, not proof of causality.
    importance = pd.DataFrame({
        "feature": feature_names,
        "importance": model.feature_importances_,
    }).sort_values("importance", ascending=False)
    importance.to_csv(
        os.path.join(args.output_dir, "feature_importance.csv"), index=False
    )

    top = importance.head(20).sort_values("importance")
    fig, ax = plt.subplots(figsize=(9, 7))
    ax.barh(top["feature"], top["importance"])
    ax.set_title("Top Random Forest Feature Importances")
    ax.set_xlabel("Importance")
    fig.tight_layout()
    fig.savefig(
        os.path.join(args.output_dir, "feature_importance.png"), dpi=160
    )
    plt.close(fig)

    # Persist inference artifacts. predict_api.py must load all three
    # preprocessing/model objects and apply them in this exact order.
    joblib.dump(model, os.path.join(args.output_dir, "cascade_rf_model.joblib"))
    joblib.dump(imputer, os.path.join(args.output_dir, "imputer.joblib"))
    joblib.dump(scaler, os.path.join(args.output_dir, "scaler.joblib"))

    with open(
        os.path.join(args.output_dir, "features.json"), "w", encoding="utf-8"
    ) as f:
        json.dump(feature_names, f, indent=4)

    metadata = {
        "model_type": "RandomForestClassifier",
        "target": "measured_downstream_cascade",
        "label_definition": {
            "0": "No downstream propagation observed by configured telemetry checks",
            "1": "At least one configured downstream dependent showed measured impact",
        },
        "feature_count": len(feature_names),
        "training_samples": int(len(train_idx)),
        "test_samples": int(len(test_idx)),
        "training_scenarios": sorted(train_groups),
        "test_scenarios": sorted(test_groups),
        "random_state": RANDOM_STATE,
        "preprocessing_order": [
            "reorder input columns using features.json",
            "imputer.transform",
            "scaler.transform",
            "model.predict or model.predict_proba",
        ],
        "metrics": metrics,
    }
    with open(
        os.path.join(args.output_dir, "model_metadata.json"),
        "w", encoding="utf-8"
    ) as f:
        json.dump(metadata, f, indent=4)

    print("\n================ MODEL RESULTS ==================")
    for key in ("accuracy", "precision", "recall", "f1", "roc_auc"):
        print(f"{key:12s}: {metrics[key]}")
    print("\nConfusion matrix:")
    print(np.array(metrics["confusion_matrix"]))
    print("\nTop 10 features:")
    print(importance.head(10).to_string(index=False))
    print("\nSaved artifacts to:", os.path.abspath(args.output_dir))
    print("==================================================")
    print(
        "\nIMPORTANT: these are grouped holdout results from the collected "
        "scenarios. They do not establish production accuracy or generalization "
        "to other deployments."
    )


if __name__ == "__main__":
    warnings.filterwarnings("ignore", category=UserWarning)
    main()
