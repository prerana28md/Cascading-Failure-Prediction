import os
import sys
from unittest.mock import patch
sys.path.insert(0, 'ml')
import predict_api as api

def verify_all():
    print("=" * 60)
    print("RUNNING COMPREHENSIVE ARCHITECTURAL VERIFICATION SUITE")
    print("=" * 60)

    services = api.WORKLOAD_SERVICES["omnistore"]
    raw_base = {f"{s}_service_up": 1.0 for s in services}
    for s in services:
        raw_base[f"{s}_error_rate_5xx"] = 0.0
        raw_base[f"{s}_p99_latency_s"] = 0.05
        raw_base[f"{s}_fault"] = "NONE"
        raw_base[f"{s}_fault_delay_ms"] = 0

    # 1. Healthy Baseline
    api.FAULT_EVENTS.clear()
    imp_h = api.impact_analysis(raw_base)
    crit_h = api.criticality_analysis(raw_base, imp_h)
    print(f"[TEST 1] Healthy Baseline:")
    print(f"         Criticality: {crit_h['percentage']}%, Severity: {crit_h['severity']}")
    assert crit_h['percentage'] == 5.0, f"Expected 5.0, got {crit_h['percentage']}"
    assert crit_h['severity'] == "INFORMATIONAL"

    # 2. Scenario 1: Notification Down (should NOT be Critical!)
    raw_notif = dict(raw_base, notification_fault="DOWN", notification_service_up=0.0)
    imp_notif = api.impact_analysis(raw_notif)
    crit_notif = api.criticality_analysis(raw_notif, imp_notif)
    print(f"\n[TEST 2] Scenario 1: Notification Down:")
    print(f"         Criticality: {crit_notif['percentage']}%, Severity: {crit_notif['severity']}")
    print(f"         Affected services: {imp_notif['services']}")
    assert crit_notif['severity'] in ("LOW", "MODERATE"), f"Expected LOW or MODERATE, got {crit_notif['severity']}"
    assert imp_notif['services']['order'] == 0.0, "Notification down must not affect order"
    assert imp_notif['services']['payment'] == 0.0, "Notification down must not affect payment"

    # 3. Scenario 2: Payment Down (should be CRITICAL!)
    raw_pay = dict(raw_base, payment_fault="DOWN", payment_service_up=0.0)
    imp_pay = api.impact_analysis(raw_pay)
    crit_pay = api.criticality_analysis(raw_pay, imp_pay)
    graph_pay = api.dependency_graph(raw_pay, [], "omnistore", imp_pay)
    print(f"\n[TEST 3] Scenario 2: Payment Down:")
    print(f"         Criticality: {crit_pay['percentage']}%, Severity: {crit_pay['severity']}")
    print(f"         Cascade Path: {graph_pay['cascade_path']}")
    print(f"         Affected services: {imp_pay['services']}")
    assert crit_pay['severity'] == "CRITICAL", f"Payment down must be CRITICAL, got {crit_pay['severity']}"
    assert imp_pay['services']['order'] >= 75.0, "Order must be directly impacted when payment fails"
    assert imp_pay['services']['inventory'] == 0.0, "Inventory must remain healthy when payment fails"
    assert graph_pay['cascade_path'] == ['payment', 'order', 'shipping']

    # 4. Scenario 3: Inventory Down (should be HIGH!)
    raw_inv = dict(raw_base, inventory_fault="DOWN", inventory_service_up=0.0)
    imp_inv = api.impact_analysis(raw_inv)
    crit_inv = api.criticality_analysis(raw_inv, imp_inv)
    print(f"\n[TEST 4] Scenario 3: Inventory Down:")
    print(f"         Criticality: {crit_inv['percentage']}%, Severity: {crit_inv['severity']}")
    print(f"         Affected services: {imp_inv['services']}")
    assert crit_inv['severity'] == "HIGH", f"Inventory down must be HIGH, got {crit_inv['severity']}"

    # 5. Scenario 4: Order Down (should be CRITICAL!)
    raw_ord = dict(raw_base, order_fault="DOWN", order_service_up=0.0)
    imp_ord = api.impact_analysis(raw_ord)
    crit_ord = api.criticality_analysis(raw_ord, imp_ord)
    print(f"\n[TEST 5] Scenario 4: Order Down:")
    print(f"         Criticality: {crit_ord['percentage']}%, Severity: {crit_ord['severity']}")
    print(f"         Affected services: {imp_ord['services']}")
    assert crit_ord['severity'] == "CRITICAL", f"Order down must be CRITICAL, got {crit_ord['severity']}"

    # 6. Scenario 5: Delivery Down (should be MODERATE / MEDIUM!)
    raw_del = dict(raw_base, delivery_fault="DOWN", delivery_service_up=0.0)
    imp_del = api.impact_analysis(raw_del)
    crit_del = api.criticality_analysis(raw_del, imp_del)
    print(f"\n[TEST 6] Scenario 5: Delivery Down:")
    print(f"         Criticality: {crit_del['percentage']}%, Severity: {crit_del['severity']}")
    print(f"         Affected services: {imp_del['services']}")
    assert crit_del['severity'] in ("MODERATE", "MEDIUM"), f"Delivery down must be MODERATE or MEDIUM, got {crit_del['severity']}"

    # 7. MovieStream: Recommendation Down (should be MODERATE!)
    movie_services = api.WORKLOAD_SERVICES["moviestream"]
    raw_rec = {f"{s}_service_up": 1.0 for s in movie_services}
    for s in movie_services:
        raw_rec[f"{s}_error_rate_5xx"] = 0.0
        raw_rec[f"{s}_p99_latency_s"] = 0.05
        raw_rec[f"{s}_fault"] = "NONE"
        raw_rec[f"{s}_fault_delay_ms"] = 0
    raw_rec["recommendation_fault"] = "DOWN"
    raw_rec["recommendation_service_up"] = 0.0
    imp_rec = api.impact_analysis(raw_rec, "moviestream")
    crit_rec = api.criticality_analysis(raw_rec, imp_rec, "moviestream")
    print(f"\n[TEST 7] MovieStream Recommendation Down:")
    print(f"         Criticality: {crit_rec['percentage']}%, Severity: {crit_rec['severity']}")
    print(f"         Affected services: {imp_rec['services']}")
    assert crit_rec['severity'] in ("LOW", "MODERATE")
    assert imp_rec['services']['catalog'] == 0.0
    assert imp_rec['services']['user'] == 0.0

    # 8. MovieStream: Catalog Down (should be CRITICAL!)
    raw_cat = dict(raw_rec, recommendation_fault="NONE", recommendation_service_up=1.0, catalog_fault="DOWN", catalog_service_up=0.0)
    imp_cat = api.impact_analysis(raw_cat, "moviestream")
    crit_cat = api.criticality_analysis(raw_cat, imp_cat, "moviestream")
    print(f"\n[TEST 8] MovieStream Catalog Down:")
    print(f"         Criticality: {crit_cat['percentage']}%, Severity: {crit_cat['severity']}")
    print(f"         Affected services: {imp_cat['services']}")
    assert crit_cat['severity'] == "CRITICAL"
    assert imp_cat['services']['recommendation'] >= 75.0

    print("\n" + "=" * 60)
    print("ALL 8 ARCHITECTURAL SCENARIOS VERIFIED AND 100% PASSING!")
    print("=" * 60)

if __name__ == "__main__":
    verify_all()
