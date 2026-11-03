"""
seed_omnistore.py — Seeds OmniStore MongoDB with demo users and inventory.
Run once after docker-compose up -d to populate the store.
Usage: python seed_omnistore.py
"""
import requests, time, sys

GW = "http://localhost:8080"

# ── Demo users to create ─────────────────────────────────────────────────────
USERS = [
    {"username": "admin",    "password": "admin123",    "role": "ADMIN"},
    {"username": "alice",    "password": "password123", "role": "USER"},
    {"username": "bob",      "password": "password123", "role": "USER"},
    {"username": "charlie",  "password": "password123", "role": "USER"},
]

# ── Product catalog to seed ──────────────────────────────────────────────────
PRODUCTS = [
    # Audio & Sound
    {"productId": 101, "productName": "Wireless Noise-Canceling Headphones",   "price": 199.99, "quantity": 45},
    {"productId": 102, "productName": "Portable Bluetooth Speaker",             "price":  79.99, "quantity": 30},
    {"productId": 103, "productName": "Studio Monitor Earbuds",                 "price": 129.99, "quantity": 60},
    {"productId": 104, "productName": "USB Condenser Microphone",               "price":  89.99, "quantity": 25},
    # Monitors & Displays
    {"productId": 201, "productName": 'Ultra HD Curved Monitor 27"',            "price": 349.50, "quantity": 18},
    {"productId": 202, "productName": '4K IPS Gaming Monitor 32"',              "price": 499.00, "quantity": 12},
    {"productId": 203, "productName": 'Portable USB-C Display 15.6"',           "price": 219.99, "quantity": 20},
    # Keyboards & Mice
    {"productId": 301, "productName": "Mechanical RGB Gaming Keyboard",         "price":  89.99, "quantity": 60},
    {"productId": 302, "productName": "Wireless Ergonomic Keyboard",            "price":  59.99, "quantity": 40},
    {"productId": 303, "productName": "Ergonomic Vertical Gaming Mouse",        "price":  49.99, "quantity": 55},
    {"productId": 304, "productName": "Wireless Trackball Mouse",               "price":  64.99, "quantity": 35},
    # Hubs & Accessories
    {"productId": 401, "productName": "USB-C 12-in-1 Multi-Port Hub",          "price":  79.99, "quantity": 80},
    {"productId": 402, "productName": "Thunderbolt 4 Docking Station",         "price": 249.99, "quantity": 15},
    {"productId": 403, "productName": "Webcam 4K with Ring Light",              "price": 119.99, "quantity": 28},
    {"productId": 404, "productName": "Laptop Stand Adjustable Aluminium",      "price":  44.99, "quantity": 70},
    {"productId": 405, "productName": "Cable Management Kit 50pcs",             "price":  19.99, "quantity": 120},
]

def wait_for_gateway(timeout=60):
    print("Waiting for API Gateway…")
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            r = requests.get(f"{GW}/actuator/health", timeout=3)
            if r.status_code == 200:
                print("  Gateway is UP.")
                return True
        except Exception:
            pass
        time.sleep(3)
    print("  ERROR: Gateway did not respond within timeout.")
    return False

def register_user(user):
    try:
        r = requests.post(f"{GW}/auth/register",
                          json={"username": user["username"],
                                "password": user["password"],
                                "role":     user["role"]},
                          timeout=5)
        if r.status_code in (200, 201):
            print(f"  ✓ Created  {user['username']} ({user['role']})")
            return r.json().get("token")
        elif r.status_code in (400, 409) and ("exists" in r.text.lower() or "taken" in r.text.lower()):
            # Already exists — just login
            r2 = requests.post(f"{GW}/auth/login",
                               json={"username": user["username"],
                                     "password": user["password"]},
                               timeout=5)
            if r2.status_code in (200, 201):
                print(f"  ✓ Exists   {user['username']} ({user['role']}) — logged in")
                return r2.json().get("token")
        else:
            print(f"  ✗ Failed   {user['username']}: {r.status_code} {r.text[:80]}")
    except Exception as e:
        print(f"  ✗ Error    {user['username']}: {e}")
    return None

def seed_inventory(admin_token):
    if not admin_token:
        print("  Skipping inventory — no admin token")
        return
    headers = {"Authorization": f"Bearer {admin_token}",
               "Content-Type": "application/json"}
    ok = 0
    skip = 0
    for p in PRODUCTS:
        try:
            # Check if exists first
            chk = requests.get(f"{GW}/inventory/{p['productId']}", headers=headers, timeout=5)
            if chk.status_code == 200:
                skip += 1
                continue
        except Exception:
            pass
        try:
            r = requests.post(f"{GW}/inventory", json=p, headers=headers, timeout=5)
            if r.status_code in (200, 201):
                ok += 1
            else:
                print(f"  ✗ Product {p['productId']} failed: {r.status_code} {r.text[:60]}")
        except Exception as e:
            print(f"  ✗ Product {p['productId']} error: {e}")
    print(f"  ✓ Products: {ok} created, {skip} already existed")

def main():
    if not wait_for_gateway():
        sys.exit(1)

    print("\n── Creating demo users ──────────────────────────────────")
    admin_token = None
    for user in USERS:
        token = register_user(user)
        if user["username"] == "admin" and token:
            admin_token = token

    print("\n── Seeding inventory ────────────────────────────────────")
    seed_inventory(admin_token)

    print("\n── Done ─────────────────────────────────────────────────")
    print("OmniStore is ready.")
    print()
    print("Login credentials:")
    print("  admin    / admin123    (full admin access)")
    print("  alice    / password123 (customer)")
    print("  bob      / password123 (customer)")
    print("  charlie  / password123 (customer)")

if __name__ == "__main__":
    main()
