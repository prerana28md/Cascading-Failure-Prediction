"""
Dependency Graph Analysis
=========================
Builds a weighted directed graph of inter-service dependencies from the
metric correlation data.  High correlation between service error metrics
indicates a propagation path.

Outputs:
  - A NetworkX graph object (used by the ML pipeline)
  - PNG visualisation of the dependency graph
  - CSV of edge weights (correlation strengths)

Usage
-----
  python dependency_graph.py --input ../data-collection/dataset/dataset.csv
"""

import argparse
import os
import sys

import matplotlib
matplotlib.use("Agg")   # Non-interactive backend for headless runs
import matplotlib.pyplot as plt
import networkx as nx
import numpy as np
import pandas as pd

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "output")

# Known architectural dependencies from the codebase
# (direction: caller → callee)
ARCHITECTURAL_EDGES = [
    ("order",        "inventory",     "inventory_deduct"),
    ("order",        "payment",       "process_payment"),
    ("order",        "shipping",      "create_shipment"),
    ("order",        "notification",  "order_success_notify"),
    ("shipping",     "delivery",      "assign_delivery"),
    ("shipping",     "notification",  "shipping_notify"),
    ("payment",      "notification",  "payment_notify"),
]

SERVICES_SHORT = [
    "order", "payment", "inventory", "shipping", "delivery", "notification"
]


def build_correlation_graph(df: pd.DataFrame, corr_threshold: float = 0.5) -> nx.DiGraph:
    """
    Build a directed graph where edges represent correlated failure propagation.
    We correlate the 5xx error rates of all service pairs.  A high correlation
    between service A (as cause) and service B (as effect) is interpreted as a
    dependency edge A→B.
    """
    G = nx.DiGraph()

    # Add all service nodes
    for svc in SERVICES_SHORT:
        G.add_node(svc, service=svc)

    # Add known architectural edges (structural prior)
    for src, dst, label in ARCHITECTURAL_EDGES:
        G.add_edge(src, dst, type="architectural", label=label, weight=1.0)

    # Compute data-driven correlations from failure-only rows
    failure_df = df[df["label"] == 1].copy()
    error_cols = {
        svc: f"{svc}_error_rate_5xx"
        for svc in SERVICES_SHORT
        if f"{svc}_error_rate_5xx" in failure_df.columns
    }

    if len(error_cols) < 2:
        print("[WARN] Not enough error rate columns for correlation analysis.")
        return G

    # Correlation matrix
    corr_data = failure_df[[col for col in error_cols.values()]].copy().fillna(0)
    corr_matrix = corr_data.corr()

    for svc_a in SERVICES_SHORT:
        for svc_b in SERVICES_SHORT:
            if svc_a == svc_b:
                continue
            col_a = error_cols.get(svc_a)
            col_b = error_cols.get(svc_b)
            if col_a is None or col_b is None:
                continue
            corr_val = corr_matrix.loc[col_a, col_b]
            if abs(corr_val) >= corr_threshold:
                if G.has_edge(svc_a, svc_b):
                    G[svc_a][svc_b]["correlation"] = round(float(corr_val), 4)
                    G[svc_a][svc_b]["weight"] = max(G[svc_a][svc_b]["weight"],
                                                    abs(float(corr_val)))
                else:
                    G.add_edge(svc_a, svc_b,
                               type="data_driven",
                               correlation=round(float(corr_val), 4),
                               weight=abs(float(corr_val)))
    return G


def graph_features(G: nx.DiGraph, df: pd.DataFrame) -> pd.DataFrame:
    """
    Extract per-service graph features:
      - in_degree:    number of services that depend on this one
      - out_degree:   number of services this one depends on
      - pagerank:     importance in the dependency graph
      - betweenness:  how often this node is on a shortest dependency path
    """
    pagerank    = nx.pagerank(G, weight="weight")
    betweenness = nx.betweenness_centrality(G, weight="weight")

    rows = []
    for svc in SERVICES_SHORT:
        rows.append({
            "service":         svc,
            "in_degree":       G.in_degree(svc),
            "out_degree":      G.out_degree(svc),
            "pagerank":        round(pagerank.get(svc, 0), 6),
            "betweenness":     round(betweenness.get(svc, 0), 6),
        })

    feat_df = pd.DataFrame(rows)

    # Merge per-service graph features back into the dataset (broadcast per row)
    enriched = df.copy()
    for _, r in feat_df.iterrows():
        svc = r["service"]
        enriched[f"{svc}_pagerank"]    = r["pagerank"]
        enriched[f"{svc}_betweenness"] = r["betweenness"]
        enriched[f"{svc}_in_degree"]   = r["in_degree"]
        enriched[f"{svc}_out_degree"]  = r["out_degree"]

    return enriched, feat_df


def visualise(G: nx.DiGraph, path: str):
    """Render the dependency graph and save as PNG."""
    plt.figure(figsize=(12, 8))
    plt.title("OmniStore Service Dependency Graph", fontsize=16, fontweight="bold")

    # Layout
    pos = {
        "order":        (0,    1),
        "inventory":    (-2,   0),
        "payment":      (-0.5, 0),
        "shipping":     (1,    0),
        "notification": (0,   -1),
        "delivery":     (2,   -0.5),
    }

    # Separate architectural vs data-driven edges
    arch_edges = [(u, v) for u, v, d in G.edges(data=True) if d.get("type") == "architectural"]
    data_edges = [(u, v) for u, v, d in G.edges(data=True) if d.get("type") == "data_driven"]

    nx.draw_networkx_nodes(G, pos, node_size=2000, node_color="#4f46e5", alpha=0.9)
    nx.draw_networkx_labels(G, pos, font_color="white", font_size=9, font_weight="bold")
    nx.draw_networkx_edges(G, pos, edgelist=arch_edges,
                           edge_color="#6366f1", arrows=True,
                           arrowsize=20, width=2, connectionstyle="arc3,rad=0.1")
    nx.draw_networkx_edges(G, pos, edgelist=data_edges,
                           edge_color="#ef4444", style="dashed", arrows=True,
                           arrowsize=15, width=1.5, connectionstyle="arc3,rad=0.2")

    # Legend
    from matplotlib.lines import Line2D
    legend = [
        Line2D([0],[0], color="#6366f1", linewidth=2, label="Architectural"),
        Line2D([0],[0], color="#ef4444", linewidth=2, linestyle="dashed", label="Data-driven correlation"),
    ]
    plt.legend(handles=legend, loc="lower left")
    plt.axis("off")
    plt.tight_layout()
    plt.savefig(path, dpi=150, bbox_inches="tight")
    plt.close()
    print(f"Graph visualisation -> {path}")


def main(input_path: str, corr_threshold: float):
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    if not os.path.exists(input_path):
        print(f"Dataset not found: {input_path}")
        sys.exit(1)

    df = pd.read_csv(input_path)
    print(f"Loaded: {len(df)} rows")

    # Build graph
    G = build_correlation_graph(df, corr_threshold)
    print(f"Graph: {G.number_of_nodes()} nodes, {G.number_of_edges()} edges")

    # Extract features
    enriched, feat_df = graph_features(G, df)

    # Save
    feat_df.to_csv(os.path.join(OUTPUT_DIR, "graph_node_features.csv"), index=False)
    enriched.to_csv(os.path.join(OUTPUT_DIR, "graph_enriched_dataset.csv"), index=False)
    visualise(G, os.path.join(OUTPUT_DIR, "dependency_graph.png"))

    print("\nNode centrality metrics:")
    print(feat_df.to_string(index=False))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--input",     default="../data-collection/dataset/dataset.csv")
    parser.add_argument("--threshold", type=float, default=0.5,
                        help="Correlation threshold for data-driven edges (default: 0.5)")
    args = parser.parse_args()
    main(args.input, args.threshold)
