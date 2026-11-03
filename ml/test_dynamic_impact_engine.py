import os
import sys
sys.path.insert(0, 'ml')
import predict_api as api

def test_dynamic_engine():
    print("Testing Dynamic Request-Level Impact Engine...")

    # Test 1: Calculation Math
    from test_math import calculate_service_impact
    r1 = calculate_service_impact(1000, failed_requests=200, timed_out_requests=50, delayed_requests=50)
    assert r1['affected_requests'] == 300
    assert r1['actual_impact_pct'] == 30.0
    assert r1['calculation_display'] == "(300 / 1000) × 100 = 30.00%"
    print("[PASS] History Service 300/1000 = 30.00% calculation verified")

    # Test 2: Zero Traffic
    r_zero = calculate_service_impact(0, failed_requests=0)
    assert r_zero['actual_impact_pct'] is None
    assert "Insufficient telemetry" in r_zero['calculation_display']
    print("[PASS] Zero traffic returns N/A – Insufficient telemetry")

    # Test 3: Known counts from Section 11
    assert calculate_service_impact(1000, unique_affected=0)['actual_impact_pct'] == 0.0
    assert calculate_service_impact(1000, unique_affected=100)['actual_impact_pct'] == 10.0
    assert calculate_service_impact(1000, unique_affected=300)['actual_impact_pct'] == 30.0
    assert calculate_service_impact(1000, unique_affected=500)['actual_impact_pct'] == 50.0
    assert calculate_service_impact(1000, unique_affected=750)['actual_impact_pct'] == 75.0
    assert calculate_service_impact(1000, unique_affected=1000)['actual_impact_pct'] == 100.0
    print("[PASS] All Section 11 test counts verified (0%, 10%, 30%, 50%, 75%, 100%)")

if __name__ == "__main__":
    test_dynamic_engine()
