import sys
import os

# Add ml dir to sys.path
sys.path.insert(0, os.path.abspath("ml"))
import predict_api as api

def run_tests():
    print("=================================================================")
    print("RUNTIME PROPAGATION & IMPACT ENGINE COMPREHENSIVE VERIFICATION")
    print("=================================================================\n")

    # -------------------------------------------------------------
    # Scenario 1: OmniStore Payment Service Outage (Single Root Cause)
    # -------------------------------------------------------------
    raw_payment = {
        "payment_fault": "DOWN",
        "payment_service_up": 0,
        "payment_request_rate": 20.0,
        "payment_total_requests": 1200,
        "order_request_rate": 25.0,
        "order_total_requests": 1500,
        "shipping_request_rate": 10.0,
        "shipping_total_requests": 600,
        "notification_request_rate": 30.0,
        "notification_total_requests": 1800,
        "inventory_request_rate": 22.0,
        "inventory_total_requests": 1320,
        "delivery_request_rate": 8.0,
        "delivery_total_requests": 480,
    }
    causes = api.root_cause(raw_payment, workload="omnistore")
    assert len(causes) == 1, f"Expected exactly 1 root cause, got {len(causes)}"
    assert causes[0]["service"] == "payment", f"Expected payment as root cause, got {causes[0]['service']}"
    print("[PASS] Payment outage: Exactly 1 root cause detected ('payment')")

    impact = api.impact_analysis(raw_payment, workload="omnistore", causes=causes)
    graph = api.dependency_graph(raw_payment, causes, workload="omnistore", impact=impact)
    nodes = {n["id"]: n for n in graph["graph_data"]["nodes"]}

    assert nodes["payment"]["status"] == "ROOT_CAUSE"
    assert nodes["payment"]["actual_impact_pct"] == 100.0
    assert nodes["payment"]["affected_requests"] == 1200
    assert nodes["payment"]["fault_intensity"] == "HTTP 503 Service Outage"

    assert nodes["order"]["status"] == "DIRECT"
    assert nodes["order"]["actual_impact_pct"] > 0
    assert nodes["order"]["fault_source"] == "payment"
    assert nodes["order"]["dependency_path"] == "payment -> order"

    assert nodes["shipping"]["status"] == "INDIRECT"
    assert nodes["shipping"]["actual_impact_pct"] > 0
    assert nodes["shipping"]["fault_source"] == "payment"
    assert nodes["shipping"]["dependency_path"] == "payment -> order -> shipping"

    assert nodes["notification"]["status"] == "HEALTHY"
    assert nodes["notification"]["queue_backlog"] > 0

    assert nodes["inventory"]["status"] == "HEALTHY"
    assert nodes["delivery"]["status"] == "HEALTHY"
    print("[PASS] OmniStore Payment Outage: Direct (Order) & Indirect (Shipping) propagation verified; Decoupled & Independent services (Notification, Inventory, Delivery) verified")

    # -------------------------------------------------------------
    # Scenario 2: OmniStore Notification Service (Asynchronous Decoupling)
    # -------------------------------------------------------------
    raw_notif = {
        "notification_fault": "DOWN",
        "notification_service_up": 0,
        "notification_request_rate": 30.0,
        "notification_total_requests": 1800,
        "order_request_rate": 25.0,
        "order_total_requests": 1500,
        "payment_request_rate": 20.0,
        "payment_total_requests": 1200,
        "inventory_request_rate": 22.0,
        "inventory_total_requests": 1320,
        "shipping_request_rate": 10.0,
        "shipping_total_requests": 600,
        "delivery_request_rate": 8.0,
        "delivery_total_requests": 480,
    }
    causes_notif = api.root_cause(raw_notif, workload="omnistore")
    assert len(causes_notif) == 1 and causes_notif[0]["service"] == "notification"
    impact_notif = api.impact_analysis(raw_notif, workload="omnistore", causes=causes_notif)
    assert impact_notif["direct_affected"] == [], "Notification is asynchronous; must NOT affect Order or Payment"
    assert impact_notif["indirect_affected"] == []
    print("[PASS] Notification Outage: Async decoupling verified (0 downstream affected services)")

    # -------------------------------------------------------------
    # Scenario 3: MovieStream User Service Outage (Single Root Cause)
    # -------------------------------------------------------------
    raw_user = {
        "user_fault": "DOWN",
        "user_service_up": 0,
        "user_request_rate": 40.0,
        "user_total_requests": 2400,
        "watchlist_request_rate": 15.0,
        "watchlist_total_requests": 900,
        "history_request_rate": 18.0,
        "history_total_requests": 1080,
        "recommendation_request_rate": 35.0,
        "recommendation_total_requests": 2100,
        "catalog_request_rate": 20.0,
        "catalog_total_requests": 1200,
    }
    causes_user = api.root_cause(raw_user, workload="moviestream")
    assert len(causes_user) == 1, f"Expected 1 root cause in MovieStream, got {len(causes_user)}"
    assert causes_user[0]["service"] == "user", f"Expected user as root cause, got {causes_user[0]['service']}"
    graph_user = api.dependency_graph(raw_user, causes_user, workload="moviestream")
    nodes_m = {n["id"]: n for n in graph_user["graph_data"]["nodes"]}
    assert nodes_m["user"]["status"] == "ROOT_CAUSE"
    assert nodes_m["recommendation"]["status"] in ("DIRECT", "INDIRECT")
    assert nodes_m["recommendation"]["status"] != "ROOT_CAUSE", "Recommendation must NOT be marked as ROOT_CAUSE when User fails"
    print("[PASS] MovieStream User Outage: Recommendation is correctly marked as dependent cascade, NOT duplicate ROOT_CAUSE")

    # -------------------------------------------------------------
    # Scenario 4: User Section 11 Example: History Service 300/1000
    # -------------------------------------------------------------
    raw_hist = {
        "history_total_requests": 1000,
        "history_failed_requests": 200,
        "history_timed_out_requests": 50,
        "history_delayed_requests": 50,
        "history_request_rate": 16.67,
    }
    req_hist = api.calculate_service_requests(raw_hist, "history", workload="moviestream", impact_type="ROOT_CAUSE")
    assert req_hist["total_requests"] == 1000
    assert req_hist["affected_requests"] == 300
    assert req_hist["actual_impact_pct"] == 30.00
    assert req_hist["calculation_display"] == "(300 / 1000) × 100 = 30.00%"
    print("[PASS] History Service 300/1000 = 30.00% exact runtime equation verified")

    # -------------------------------------------------------------
    # Scenario 5: User Section 11 Zero Traffic Requirement
    # -------------------------------------------------------------
    raw_zero = {
        "catalog_total_requests": 0,
        "catalog_request_rate": 0.0,
    }
    req_zero = api.calculate_service_requests(raw_zero, "catalog", workload="moviestream")
    assert req_zero["actual_impact_pct"] is None
    assert req_zero["calculation_display"] == "N/A – Insufficient telemetry"
    assert req_zero["status"] == "INSUFFICIENT_TELEMETRY"
    print("[PASS] Zero traffic service returns None with 'N/A – Insufficient telemetry'")

    print("\nALL RUNTIME PROPAGATION & IMPACT ENGINE TESTS PASSED 100%!")

if __name__ == "__main__":
    run_tests()
