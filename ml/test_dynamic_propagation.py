import sys
sys.path.insert(0, 'ml')
import predict_api as api

def test_full_pipeline_with_dynamic_counts():
    raw_test = {}
    for s in api.SERVICES:
        raw_test[f"{s}_service_up"] = 1.0
        raw_test[f"{s}_error_rate_5xx"] = 0.0
        raw_test[f"{s}_p99_latency_s"] = 0.05
        raw_test[f"{s}_fault"] = "NONE"
        raw_test[f"{s}_fault_delay_ms"] = 0
        raw_test[f"{s}_request_rate"] = 1000.0 / 60.0  # 1000 requests in 60s window
    
    # Test healthy pipeline
    print("Testing pipeline with 1000 reqs per service...")

if __name__ == "__main__":
    test_full_pipeline_with_dynamic_counts()
