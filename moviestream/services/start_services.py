import subprocess
import sys
import time
import signal
from pathlib import Path

# Ensure UTF-8 output on Windows consoles
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

SERVICES_DIR = Path(__file__).resolve().parent

SERVICES = [
    {
        "name": "catalog-service",
        "port": 8087,
        "script": SERVICES_DIR / "catalog_service" / "main.py"
    },
    {
        "name": "user-service",
        "port": 8088,
        "script": SERVICES_DIR / "user_service" / "main.py"
    },
    {
        "name": "watchlist-service",
        "port": 8089,
        "script": SERVICES_DIR / "watchlist_service" / "main.py"
    },
    {
        "name": "history-service",
        "port": 8092,
        "script": SERVICES_DIR / "history_service" / "main.py"
    },
    {
        "name": "recommendation-service",
        "port": 8093,
        "script": SERVICES_DIR / "recommendation_service" / "main.py"
    }
]

processes = []

def signal_handler(sig, frame):
    print("\n[MovieStream Orchestrator] Stopping all MovieStream microservices...")
    for p in processes:
        try:
            p.terminate()
        except Exception:
            pass
    sys.exit(0)

signal.signal(signal.SIGINT, signal_handler)
signal.signal(signal.SIGTERM, signal_handler)

def start_all():
    print("=" * 70)
    print("[MovieStream] Distributed Microservices Orchestrator")
    print("=" * 70)
    
    python_exe = sys.executable

    logs_dir = SERVICES_DIR / "logs"
    logs_dir.mkdir(exist_ok=True)

    for svc in SERVICES:
        name = svc["name"]
        port = svc["port"]
        script = str(svc["script"])
        print(f"[*] Starting {name:<24} on port {port}...")
        
        log_file = open(logs_dir / f"{name}.log", "a", encoding="utf-8")
        proc = subprocess.Popen(
            [python_exe, script],
            cwd=str(SERVICES_DIR),
            stdout=log_file,
            stderr=subprocess.STDOUT,
            text=True
        )
        processes.append(proc)
        time.sleep(0.4)

    print("\n[OK] All 5 MovieStream microservices launched successfully:")
    print("   - Catalog Service:        http://localhost:8087")
    print("   - User Service:           http://localhost:8088")
    print("   - Watchlist Service:      http://localhost:8089")
    print("   - History Service:        http://localhost:8092")
    print("   - Recommendation Service: http://localhost:8093")
    print("=" * 70)
    print("Observability & Prometheus Endpoints:")
    for svc in SERVICES:
        print(f"   - {svc['name']:<24} -> http://localhost:{svc['port']}/actuator/prometheus")
    print("=" * 70)

    # Monitor loop
    try:
        while True:
            for i, p in enumerate(processes):
                ret = p.poll()
                if ret is not None:
                    svc = SERVICES[i]
                    print(f"[!] Warning: {svc['name']} exited with return code {ret}")
            time.sleep(2)
    except KeyboardInterrupt:
        signal_handler(None, None)

if __name__ == "__main__":
    start_all()
