"""Run this to find the exact crash in predict_api.py metrics/live"""
import sys, traceback

# Execute all code except the __main__ block
src = open('predict_api.py').read()
src = src.split("if __name__")[0]

try:
    exec(src, globals())
    print("Module loaded OK")
except Exception as e:
    print("LOAD ERROR:", e)
    traceback.print_exc()
    sys.exit(1)

print("Testing scrape_live_metrics...")
try:
    raw = scrape_live_metrics()
    print(f"  OK — {len(raw)} keys")
except Exception as e:
    print("  FAIL:", e); traceback.print_exc(); sys.exit(1)

print("Testing identify_root_cause...")
try:
    causes = identify_root_cause(raw)
    print(f"  OK — {causes}")
except Exception as e:
    print("  FAIL:", e); traceback.print_exc(); sys.exit(1)

print("Testing compute_zscore_analysis...")
try:
    z = compute_zscore_analysis(raw)
    print(f"  OK — flagged: {z['flagged_count']}")
except Exception as e:
    print("  FAIL:", e); traceback.print_exc(); sys.exit(1)

print("Testing compute_temporal_analysis...")
try:
    t = compute_temporal_analysis(raw)
    print(f"  OK — history: {t['history_length']}")
except Exception as e:
    print("  FAIL:", e); traceback.print_exc(); sys.exit(1)

print("Testing build_networkx_graph...")
try:
    nx_data = build_networkx_graph(raw, causes)
    print(f"  OK — nodes: {nx_data['graph_data']['node_count']}")
except Exception as e:
    print("  FAIL:", e); traceback.print_exc(); sys.exit(1)

print("Testing safe_json serialization...")
try:
    import json
    payload = safe_json({
        "prediction": "NORMAL",
        "cascade_risk": 0.05,
        "risk_level": "LOW",
        "root_cause": causes,
        "cascade_path": nx_data["cascade_path"],
        "z_score_analysis": z,
        "temporal_analysis": t,
        "networkx_graph": nx_data["graph_data"],
        "feature_importances": get_feature_importances(),
        "live_metrics": {
            svc: {
                "error_rate_5xx": raw.get(f"{svc}_error_rate_5xx", 0),
                "p99_latency_s":  raw.get(f"{svc}_p99_latency_s", 0),
                "service_up":     int(raw.get(f"{svc}_service_up", 1)),
                "request_rate":   raw.get(f"{svc}_request_rate", 0),
            } for svc in SERVICES_SHORT
        },
        "system": {
            "mean_error_rate": raw.get("system_mean_error_rate", 0),
            "max_p99_latency": raw.get("system_max_p99_latency", 0),
            "num_services_down": int(raw.get("num_services_down", 0)),
        }
    })
    serialized = json.dumps(payload)
    print(f"  OK — {len(serialized)} bytes")
except Exception as e:
    print("  FAIL:", e); traceback.print_exc(); sys.exit(1)

print("\n✅ ALL STEPS PASSED — bug is in Flask route wiring")
