def calculate_service_impact(
    total_requests: int,
    failed_requests: int = 0,
    timed_out_requests: int = 0,
    delayed_requests: int = 0,
    dependency_failed_requests: int = 0,
    unique_affected: int = None
):
    if total_requests <= 0:
        return {
            "total_requests": 0,
            "affected_requests": 0,
            "failed_requests": 0,
            "timed_out_requests": 0,
            "delayed_requests": 0,
            "successful_requests": 0,
            "actual_impact_pct": None,
            "calculation_display": "N/A – Insufficient telemetry",
            "status": "INSUFFICIENT_TELEMETRY"
        }
    
    if unique_affected is None:
        unique_affected = min(total_requests, failed_requests + timed_out_requests + delayed_requests + dependency_failed_requests)
    else:
        unique_affected = min(total_requests, max(0, unique_affected))
        
    successful = max(0, total_requests - unique_affected)
    impact_pct = round((unique_affected / total_requests) * 100.0, 2)
    calc_str = f"({unique_affected} / {total_requests}) × 100 = {impact_pct:.2f}%"
    
    return {
        "total_requests": total_requests,
        "affected_requests": unique_affected,
        "failed_requests": failed_requests,
        "timed_out_requests": timed_out_requests,
        "delayed_requests": delayed_requests,
        "successful_requests": successful,
        "actual_impact_pct": impact_pct,
        "calculation_display": calc_str,
        "status": "MEASURED"
    }

# Test User Section 11 test cases
test_cases = [
    (1000, 0, 0.0),
    (1000, 100, 10.0),
    (1000, 300, 30.0),
    (1000, 500, 50.0),
    (1000, 750, 75.0),
    (1000, 1000, 100.0),
    (0, 0, None),
]

for total, aff, expected in test_cases:
    res = calculate_service_impact(total, unique_affected=aff)
    print(f"Total: {total}, Affected: {aff} -> Impact: {res['actual_impact_pct']} (Expected: {expected})")
    assert res['actual_impact_pct'] == expected

# Test History Service illustrative example from prompt:
# Total requests: 1,000 | Failed requests: 200 | Timed-out requests: 50 | Delayed requests: 50 | Unique affected requests: 300 -> Actual impact = 30%
res_hist = calculate_service_impact(1000, failed_requests=200, timed_out_requests=50, delayed_requests=50)
print(f"History Example: {res_hist['actual_impact_pct']}% - {res_hist['calculation_display']}")
assert res_hist['actual_impact_pct'] == 30.0
assert res_hist['affected_requests'] == 300

print("ALL 7 TEST CASES AND HISTORY EXAMPLE PASSED 100%!")
