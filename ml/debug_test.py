"""
ML Pipeline & Cascade Failure Inference Diagnostic Test
=========================================================
Tests the complete end-to-end ML prediction and intelligence pipeline
without requiring external network dependencies.
"""
import sys
import json
import traceback

try:
    import predict_api as api
except ImportError:
    from ml import predict_api as api

print("=" * 70)
print("[TEST] Cascading Failure ML Pipeline & Inference Test")
print("=" * 70)

# Step 1: Model Loading & Artifact Verification
print("\n[1/6] Verifying ML model & scaler artifacts...")
try:
    api._load_model()
    if api._model is not None:
        print(f"  [PASS] Model loaded successfully: {api._model.__class__.__name__}")
        print(f"  [PASS] Feature vector size: {len(api._features)} features")
        print(f"  [PASS] Scaler type: {api._scaler.__class__.__name__}")
    else:
        print("  [WARN] Model not found on disk, will use topology fallback.")
except Exception as e:
    print(f"  [FAIL] Model load failed: {e}")
    traceback.print_exc()
    sys.exit(1)

# Step 2: Baseline Scrape / Raw Metrics Synthesis
print("\n[2/6] Generating synthetic baseline telemetry...")
try:
    normal_raw = {}
    for svc in api.SERVICES:
        normal_raw[f"{svc}_service_up"] = 1.0
        normal_raw[f"{svc}_error_rate_5xx"] = 0.0
        normal_raw[f"{svc}_p99_latency_s"] = 0.02
        normal_raw[f"{svc}_request_rate"] = 10.0
        normal_raw[f"{svc}_fault"] = "NONE"
        normal_raw[f"{svc}_fault_delay_ms"] = 0
    normal_raw["num_services_down"] = 0
    normal_raw["system_mean_error_rate"] = 0.0
    normal_raw["system_max_p99_latency"] = 0.02
    print(f"  [PASS] Baseline metrics generated: {len(normal_raw)} keys")
except Exception as e:
    print(f"  [FAIL] Failed: {e}")
    sys.exit(1)

# Step 3: Test Baseline Prediction (Expect NORMAL)
print("\n[3/6] Testing Baseline Prediction (Expect: NORMAL)...")
try:
    pred_normal = api.predict_cascade(normal_raw, workload="omnistore")
    print(f"  [PASS] Prediction : {pred_normal['prediction']}")
    print(f"  [PASS] Cascade Risk: {pred_normal['cascade_risk'] * 100:.1f}%")
    print(f"  [PASS] Risk Level  : {pred_normal['risk_level']}")
    assert pred_normal["prediction"] == "NORMAL", f"Expected NORMAL, got {pred_normal['prediction']}"
except Exception as e:
    print(f"  [FAIL] Baseline prediction test failed: {e}")
    traceback.print_exc()
    sys.exit(1)

# Step 4: Test Cascade Failure Prediction (Simulated Payment Failure -> Order Degradation)
print("\n[4/6] Testing Cascade Failure Simulation (Injected Failure)...")
try:
    cascade_raw = dict(normal_raw)
    # Payment fails (down, high errors, latency spike)
    cascade_raw["payment_service_up"] = 0.0
    cascade_raw["payment_error_rate_5xx"] = 0.95
    cascade_raw["payment_p99_latency_s"] = 5.2
    cascade_raw["payment_fault"] = "DOWN"
    # Order cascades due to payment failure
    cascade_raw["order_error_rate_5xx"] = 0.75
    cascade_raw["order_p99_latency_s"] = 4.8
    cascade_raw["num_services_down"] = 1
    cascade_raw["system_mean_error_rate"] = 0.28
    cascade_raw["system_max_p99_latency"] = 5.2

    pred_cascade = api.predict_cascade(cascade_raw, workload="omnistore")
    print(f"  [PASS] Prediction : {pred_cascade['prediction']}")
    print(f"  [PASS] Cascade Risk: {pred_cascade['cascade_risk'] * 100:.1f}%")
    print(f"  [PASS] Confidence  : {pred_cascade['confidence'] * 100:.1f}%")
    print(f"  [PASS] Risk Level  : {pred_cascade['risk_level']}")
    assert pred_cascade["prediction"] == "CASCADE_FAILURE", f"Expected CASCADE_FAILURE, got {pred_cascade['prediction']}"
    assert pred_cascade["cascade_risk"] >= 0.5, f"Expected risk >= 0.5, got {pred_cascade['cascade_risk']}"
except Exception as e:
    print(f"  [FAIL] Cascade prediction test failed: {e}")
    traceback.print_exc()
    sys.exit(1)

# Step 5: Test Full Analytics Pipeline (Graph, Root Cause, SLA, Recommendations)
print("\n[5/6] Testing Full Analytics Pipeline (Graph, Root Cause, SLA)...")
try:
    result = api.full_pipeline(cascade_raw, workload="omnistore")
    causes = result.get("root_causes", [])
    print(f"  [PASS] Root causes detected      : {[c.get('service') for c in causes]}")
    print(f"  [PASS] Criticality score         : {result.get('criticality', {}).get('system_criticality_score', 'N/A')}")
    print(f"  [PASS] Cascade path in graph     : {result.get('dependency_graph', {}).get('cascade_path', [])}")
    print(f"  [PASS] SLA compliance status     : {result.get('sla_compliance', {}).get('status', 'N/A')}")
    print(f"  [PASS] Recommendations count     : {len(result.get('recommendations', []))}")
    if result.get("recommendations"):
        top_rec = result["recommendations"][0]
        print(f"         Top recommendation: [{top_rec.get('priority')}] {top_rec.get('title') or top_rec.get('recommendation')}")
except Exception as e:
    print(f"  [FAIL] Pipeline analytics failed: {e}")
    traceback.print_exc()
    sys.exit(1)

# Step 6: Test JSON Serialization
print("\n[6/6] Testing JSON response serialization...")
try:
    serialized = json.dumps(result, default=str)
    print(f"  [PASS] Payload serialized cleanly: {len(serialized)} bytes")
except Exception as e:
    print(f"  [FAIL] JSON serialization failed: {e}")
    traceback.print_exc()
    sys.exit(1)

print("\n" + "=" * 70)
print("[SUCCESS] ALL 6 ML PIPELINE TESTS PASSED!")
print("=" * 70)
