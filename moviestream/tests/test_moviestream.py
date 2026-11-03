"""
MovieStream Microservices & Resilience Unit/Integration Tests
=============================================================
Tests:
  1. FaultState & Interception Lifecycle (NONE -> LATENCY -> ERROR -> DOWN -> RESET)
  2. Actuator & Health Endpoint Bypass Rules
  3. Trailer Resolver & Anti-Collision Verification (Ensuring non-Dune films don't get Dune 2 trailer)
  4. MovieStream Catalog Service Fast API HTTP Routes
"""
import sys
import unittest
from pathlib import Path
from fastapi.testclient import TestClient

# Ensure services directory is in path
CURRENT_DIR = Path(__file__).resolve().parent
SERVICES_DIR = CURRENT_DIR.parent / "services"
if str(SERVICES_DIR) not in sys.path:
    sys.path.insert(0, str(SERVICES_DIR))

from shared.fault_state import FaultState
from shared.trailer_resolver import resolve_trailer_key, VERIFIED_TRAILERS
from catalog_service.main import app as catalog_app


class TestMovieStreamFaultState(unittest.TestCase):
    def setUp(self):
        self.fault = FaultState("test-service")

    def test_default_state_is_none(self):
        status = self.fault.status()
        self.assertEqual(status["fault"], "NONE")
        self.assertEqual(status["delayMs"], 0)
        self.assertFalse(status["active"])

    def test_configure_latency_spike(self):
        self.fault.configure("LATENCY", 2000)
        status = self.fault.status()
        self.assertEqual(status["fault"], "LATENCY")
        self.assertEqual(status["delayMs"], 2000)
        self.assertTrue(status["active"])

    def test_configure_error_storm(self):
        self.fault.configure("ERROR")
        status = self.fault.status()
        self.assertEqual(status["fault"], "ERROR")
        self.assertTrue(status["active"])

    def test_configure_down_service(self):
        self.fault.configure("DOWN")
        status = self.fault.status()
        self.assertEqual(status["fault"], "DOWN")
        self.assertTrue(status["active"])

    def test_reset_fault(self):
        self.fault.configure("ERROR")
        self.assertTrue(self.fault.status()["active"])
        self.fault.reset()
        status = self.fault.status()
        self.assertEqual(status["fault"], "NONE")
        self.assertEqual(status["delayMs"], 0)
        self.assertFalse(status["active"])


class TestTrailerResolution(unittest.TestCase):
    def test_dune2_trailer_resolves_correctly(self):
        dune_key = resolve_trailer_key("Dune: Part Two")
        self.assertEqual(dune_key, "Way9Dexny3w")

    def test_other_movies_do_not_resolve_to_dune2(self):
        test_titles = [
            "Inception",
            "Interstellar",
            "The Dark Knight",
            "K.G.F: Chapter 2",
            "Salaar",
            "RRR",
            "Kantara",
            "Stranger Things"
        ]
        for title in test_titles:
            key = resolve_trailer_key(title)
            self.assertNotEqual(
                key,
                "Way9Dexny3w",
                f"Film '{title}' incorrectly resolved to Dune: Part Two trailer!"
            )
            self.assertTrue(len(key) >= 6, f"Trailer key for '{title}' is invalid: {key}")


class TestCatalogServiceEndpoints(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(catalog_app)
        # Ensure fault state is reset before each test
        self.client.post("/fault/reset")

    def tearDown(self):
        self.client.post("/fault/reset")

    def test_health_endpoint(self):
        res = self.client.get("/health")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data.get("status"), "UP")

    def test_actuator_prometheus_endpoint(self):
        res = self.client.get("/actuator/prometheus")
        self.assertEqual(res.status_code, 200)
        self.assertIn("http_server_requests_seconds", res.text)

    def test_fault_configuration_via_http(self):
        # Configure LATENCY
        res = self.client.post("/fault/configure", json={"faultType": "LATENCY", "delayMs": 500})
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data.get("fault"), "LATENCY")
        self.assertEqual(data.get("delayMs"), 500)

        # Verify status endpoint reflects fault
        status_res = self.client.get("/fault/status")
        self.assertEqual(status_res.status_code, 200)
        self.assertTrue(status_res.json().get("active"))

        # Reset fault
        reset_res = self.client.post("/fault/reset")
        self.assertEqual(reset_res.status_code, 200)
        self.assertFalse(reset_res.json().get("active"))

    def test_fault_interceptor_error_and_bypass(self):
        # Inject ERROR fault
        self.client.post("/fault/configure", json={"faultType": "ERROR"})

        # Normal business endpoints must be intercepted and return HTTP 500
        business_res = self.client.get("/catalog/top10")
        self.assertEqual(business_res.status_code, 500)
        self.assertIn("SERVICE_ERROR", business_res.text)

        # Health & fault endpoints MUST bypass interceptor and stay 200
        health_res = self.client.get("/health")
        self.assertEqual(health_res.status_code, 200)

        status_res = self.client.get("/fault/status")
        self.assertEqual(status_res.status_code, 200)

        # Reset fault and verify business route returns 200
        self.client.post("/fault/reset")
        recovered_res = self.client.get("/catalog/top10")
        self.assertEqual(recovered_res.status_code, 200)


if __name__ == "__main__":
    unittest.main()
