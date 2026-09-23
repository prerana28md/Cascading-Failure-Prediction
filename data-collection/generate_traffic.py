#!/usr/bin/env python3
"""
Continuous / Burst Traffic Generator for Cascading Failure Prediction Project
=============================================================================
Sends real HTTP traffic through the API Gateway (or directly to services) so
Spring Boot Micrometer timers and Prometheus metrics genuinely observe:
  - Request rates (http_server_requests_seconds_count)
  - Latency distributions (http_server_requests_seconds_bucket)
  - Error rates (5xx / 4xx)

Usage:
  python generate_traffic.py                  # runs continuously at 2 req/s
  python generate_traffic.py --burst 20       # send 20 requests immediately
  python generate_traffic.py --rate 5 --duration 60   # 5 req/s for 60 seconds
  python generate_traffic.py --service order  # hit only order service
"""

import argparse
import random
import sys
import time
import requests

GATEWAY_URL = "http://localhost:8080"

SERVICES = {
    "order":        "http://localhost:8081",
    "payment":      "http://localhost:8082",
    "inventory":    "http://localhost:8083",
    "shipping":     "http://localhost:8084",
    "delivery":     "http://localhost:8085",
    "notification": "http://localhost:8086",
}


def send_inventory_read(base_url: str):
    """GET /inventory - lightweight query"""
    try:
        r = requests.get(f"{base_url}/inventory", timeout=5)
        return r.status_code, r.elapsed.total_seconds()
    except Exception as e:
        return 0, 0.0


def send_order_create(base_url: str):
    """POST /orders - triggers full cascade: inventory -> payment -> shipping -> notification"""
    payload = {
        "customerId": random.randint(100, 999),
        "productId": random.choice([101, 102, 103, 104, 105]),
        "quantity": random.randint(1, 2),
        "amount": round(random.uniform(19.99, 199.99), 2),
        "shippingAddress": f"{random.randint(1, 99)} Main Street, City"
    }
    try:
        r = requests.post(f"{base_url}/orders", json=payload, timeout=8)
        return r.status_code, r.elapsed.total_seconds()
    except Exception as e:
        return 0, 0.0


def send_payment_create(base_url: str):
    """POST /payments"""
    payload = {
        "orderId": random.randint(1000, 9999),
        "amount": round(random.uniform(10.0, 150.0), 2),
        "paymentMethod": "CREDIT_CARD",
        "status": "PENDING"
    }
    try:
        r = requests.post(f"{base_url}/payments", json=payload, timeout=5)
        return r.status_code, r.elapsed.total_seconds()
    except Exception:
        return 0, 0.0


def send_shipping_create(base_url: str):
    """POST /shipping or /shipments"""
    payload = {
        "orderId": random.randint(1000, 9999),
        "address": "456 Oak Avenue",
        "carrier": "FedEx",
        "status": "PROCESSING"
    }
    try:
        r = requests.post(f"{base_url}/shipping", json=payload, timeout=5)
        return r.status_code, r.elapsed.total_seconds()
    except Exception:
        return 0, 0.0


def run_burst(count: int, gateway: str):
    print(f"\n[INFO] Sending burst of {count} requests to {gateway}...")
    success = 0
    errors = 0
    latencies = []

    for i in range(count):
        # 60% orders, 20% inventory reads, 10% payment, 10% shipping
        roll = random.random()
        if roll < 0.60:
            status, duration = send_order_create(gateway)
            op = "POST /orders"
        elif roll < 0.80:
            status, duration = send_inventory_read(gateway)
            op = "GET /inventory"
        elif roll < 0.90:
            status, duration = send_payment_create(gateway)
            op = "POST /payments"
        else:
            status, duration = send_shipping_create(gateway)
            op = "POST /shipping"

        latencies.append(duration)
        if 200 <= status < 400:
            success += 1
            print(f"  [{i+1}/{count}] {op} -> HTTP {status} ({duration*1000:.1f}ms)")
        else:
            errors += 1
            print(f"  [{i+1}/{count}] {op} -> HTTP {status} (ERROR/TIMEOUT, {duration*1000:.1f}ms)")

        time.sleep(0.1)

    avg_lat = (sum(latencies) / len(latencies) * 1000) if latencies else 0.0
    print(f"\n[SUMMARY] Sent: {count} | Success: {success} | Errors: {errors} | Avg Latency: {avg_lat:.1f}ms\n")


def run_continuous(rate: float, duration: float, gateway: str):
    interval = 1.0 / max(rate, 0.1)
    end_time = (time.time() + duration) if duration > 0 else float("inf")
    print(f"\n[INFO] Running continuous traffic generator at {rate:.1f} req/s against {gateway}")
    if duration > 0:
        print(f"[INFO] Will run for {duration} seconds")
    print("Press Ctrl+C to stop.\n")

    count = 0
    success = 0
    errors = 0

    try:
        while time.time() < end_time:
            t0 = time.time()
            roll = random.random()
            if roll < 0.60:
                status, dur = send_order_create(gateway)
                op = "POST /orders"
            elif roll < 0.85:
                status, dur = send_inventory_read(gateway)
                op = "GET /inventory"
            else:
                status, dur = send_payment_create(gateway)
                op = "POST /payments"

            count += 1
            if 200 <= status < 400:
                success += 1
            else:
                errors += 1

            if count % 10 == 0:
                print(f"[Traffic] Sent {count} requests (OK: {success}, Err: {errors}) - Latest: {op} HTTP {status} in {dur*1000:.1f}ms")

            elapsed = time.time() - t0
            sleep_time = max(0.0, interval - elapsed)
            time.sleep(sleep_time)

    except KeyboardInterrupt:
        print("\n[INFO] Stopped by user.")

    print(f"\n[SUMMARY] Total: {count} | Success: {success} | Errors: {errors}\n")


def main():
    parser = argparse.ArgumentParser(description="Traffic Generator for Microservices Telemetry")
    parser.add_argument("--gateway", default=GATEWAY_URL, help="Gateway URL (default: http://localhost:8080)")
    parser.add_argument("--rate", type=float, default=2.0, help="Requests per second for continuous mode (default: 2.0)")
    parser.add_argument("--duration", type=float, default=0.0, help="Duration in seconds (0 = infinite)")
    parser.add_argument("--burst", type=int, default=0, help="Send a single burst of N requests and exit")

    args = parser.parse_args()

    if args.burst > 0:
        run_burst(args.burst, args.gateway)
    else:
        run_continuous(args.rate, args.duration, args.gateway)


if __name__ == "__main__":
    main()
