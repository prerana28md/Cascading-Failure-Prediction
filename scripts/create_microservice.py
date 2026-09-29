"""
MovieStream & Cascading Failure Prediction Platform
Automated Microservice Generator CLI Tool

Creates, instruments, and auto-wires a new microservice in 3 seconds:
1. Generates production-ready FastAPI microservice
2. Instruments Prometheus metrics (/actuator/prometheus)
3. Instruments Fault Injection Middleware (/fault/inject)
4. Hooks into shared persistence (SQLite)
5. Auto-registers in start_services.py, config.py, and Vite proxy

Usage:
    python scripts/create_microservice.py --name <service-name> --port <port> [--desc <description>]

Example:
    python scripts/create_microservice.py --name review-service --port 8094 --desc "Movie ratings and reviews service"
"""

import sys
import re
import argparse
from pathlib import Path

WORKSPACE_ROOT = Path(__file__).resolve().parent.parent
MOVIESTREAM_SERVICES = WORKSPACE_ROOT / "moviestream" / "services"
CONFIG_FILE = MOVIESTREAM_SERVICES / "shared" / "config.py"
START_SERVICES_FILE = MOVIESTREAM_SERVICES / "start_services.py"
VITE_CONFIG_FILE = WORKSPACE_ROOT / "moviestream" / "frontend" / "vite.config.js"


SERVICE_TEMPLATE = '''import sys
from pathlib import Path
from typing import Dict, Any, List
from fastapi import FastAPI, HTTPException, Body
from fastapi.middleware.cors import CORSMiddleware

# Ensure shared package is importable
CURRENT_DIR = Path(__file__).resolve().parent
SERVICES_DIR = CURRENT_DIR.parent
if str(SERVICES_DIR) not in sys.path:
    sys.path.insert(0, str(SERVICES_DIR))

from shared.config import {port_var_name}
from shared.fault_state import FaultState, FaultMiddleware, register_fault_endpoints
from shared.metrics import ServiceMetrics, register_metrics_endpoints
from shared.persistence import init_db

SERVICE_NAME = "{service_name}"

app = FastAPI(
    title="MovieStream {title_name}",
    description="{description}",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 1. Fault Injection & Observability Instrumentation (Research Platform)
fault_state = FaultState(SERVICE_NAME)
app.add_middleware(FaultMiddleware, fault_state=fault_state)
register_fault_endpoints(app, fault_state)

# 2. Prometheus Real-Time Metrics (/actuator/prometheus)
metrics = ServiceMetrics(SERVICE_NAME)
register_metrics_endpoints(app, metrics)

# 3. Microservice Business Logic State
# Example in-memory store (or use SQLite via shared.persistence)
DATA_STORE: Dict[str, Any] = {{}}


@app.get("/{route_prefix}/health")
async def health_check():
    """Service health and diagnostic status."""
    return {{
        "status": "UP",
        "service": SERVICE_NAME,
        "port": {port_var_name},
        "version": "1.0.0"
    }}


@app.get("/{route_prefix}/items")
async def list_items():
    """Retrieve list of {route_prefix} entities."""
    return list(DATA_STORE.values())


@app.post("/{route_prefix}/items")
async def create_item(payload: Dict[str, Any] = Body(...)):
    """Create or update a {route_prefix} record."""
    item_id = payload.get("id") or str(len(DATA_STORE) + 1)
    payload["id"] = item_id
    DATA_STORE[item_id] = payload
    return {{"status": "CREATED", "item": payload}}


@app.get("/{route_prefix}/items/{{item_id}}")
async def get_item(item_id: str):
    """Retrieve specific item by ID."""
    if item_id not in DATA_STORE:
        raise HTTPException(status_code=404, detail=f"Item with ID {{item_id}} not found")
    return DATA_STORE[item_id]


if __name__ == "__main__":
    import uvicorn
    init_db()
    uvicorn.run(app, host="0.0.0.0", port={port_var_name})
'''


def register_in_config(service_name: str, port: int, port_var_name: str, url_var_name: str):
    """Appends configuration variables to shared/config.py."""
    if not CONFIG_FILE.exists():
        return
    content = CONFIG_FILE.read_text(encoding="utf-8")
    
    if port_var_name not in content:
        port_entry = f'{port_var_name} = int(os.getenv("{port_var_name}", "{port}"))\n'
        # Insert before Service Inter-communication URLs
        if "# Service Inter-communication URLs" in content:
            content = content.replace("# Service Inter-communication URLs", f"{port_entry}# Service Inter-communication URLs")
        else:
            content += f"\n{port_entry}"

    if url_var_name not in content:
        url_entry = f'{url_var_name} = os.getenv("{url_var_name}", f"http://localhost:{{{port_var_name}}}")\n'
        if "# Observability" in content:
            content = content.replace("# Observability", f"{url_entry}# Observability")
        else:
            content += f"\n{url_entry}"

    CONFIG_FILE.write_text(content, encoding="utf-8")
    print(f"[*] Registered {port_var_name} and {url_var_name} in shared/config.py")


def register_in_start_services(service_name: str, folder_name: str, port: int):
    """Appends new microservice to SERVICES array in start_services.py."""
    if not START_SERVICES_FILE.exists():
        return
    content = START_SERVICES_FILE.read_text(encoding="utf-8")
    if f'"{service_name}"' in content:
        return

    entry = f'''    {{
        "name": "{service_name}",
        "port": {port},
        "script": SERVICES_DIR / "{folder_name}" / "main.py"
    }},
'''
    # Insert right before process array or closing of SERVICES = [...]
    if "SERVICES = [" in content:
        # Match right after SERVICES = [
        content = content.replace("SERVICES = [", f"SERVICES = [\n{entry}")
        START_SERVICES_FILE.write_text(content, encoding="utf-8")
        print(f"[*] Registered {service_name} in moviestream/services/start_services.py")


def register_in_vite_proxy(service_name: str, port: int):
    """Adds Vite proxy configuration for frontend integration."""
    if not VITE_CONFIG_FILE.exists():
        return
    content = VITE_CONFIG_FILE.read_text(encoding="utf-8")
    route_key = service_name.replace("-service", "").replace("_service", "")
    proxy_path = f"'/api/{route_key}'"
    if proxy_path in content:
        return

    proxy_entry = f'''      {proxy_path}: {{
        target: 'http://localhost:{port}',
        changeOrigin: true,
        rewrite: path => path.replace(/^\\/api\\/{route_key}/, ''),
      }},
'''
    if "proxy: {" in content:
        content = content.replace("proxy: {", f"proxy: {{\n{proxy_entry}")
        VITE_CONFIG_FILE.write_text(content, encoding="utf-8")
        print(f"[*] Registered frontend proxy {proxy_path} -> http://localhost:{port} in vite.config.js")


def main():
    parser = argparse.ArgumentParser(description="Create a new microservice in 3 seconds")
    parser.add_argument("--name", required=True, help="Microservice name, e.g. review-service")
    parser.add_argument("--port", type=int, required=True, help="Port number, e.g. 8094")
    parser.add_argument("--desc", default="Microservice component for research platform", help="Service description")
    
    args = parser.parse_args()
    
    raw_name = args.name.strip().lower()
    if not raw_name.endswith("-service") and not raw_name.endswith("_service"):
        service_name = f"{raw_name}-service"
        folder_name = f"{raw_name}_service"
    else:
        service_name = raw_name.replace("_", "-")
        folder_name = raw_name.replace("-", "_")

    route_prefix = service_name.replace("-service", "")
    port = args.port
    port_var_name = f"{route_prefix.upper()}_PORT"
    url_var_name = f"{route_prefix.upper()}_SERVICE_URL"
    title_name = " ".join(w.capitalize() for w in route_prefix.split("-")) + " Service"

    service_dir = MOVIESTREAM_SERVICES / folder_name
    service_dir.mkdir(parents=True, exist_ok=True)
    main_file = service_dir / "main.py"

    if main_file.exists():
        print(f"[!] Warning: {main_file} already exists. Skipping file creation.")
    else:
        code = SERVICE_TEMPLATE.format(
            service_name=service_name,
            title_name=title_name,
            description=args.desc,
            port_var_name=port_var_name,
            route_prefix=route_prefix
        )
        main_file.write_text(code, encoding="utf-8")
        print(f"[+] Created microservice file: {main_file}")

    # Register in config, start_services, and vite proxy
    register_in_config(service_name, port, port_var_name, url_var_name)
    register_in_start_services(service_name, folder_name, port)
    register_in_vite_proxy(service_name, port)

    print("\n" + "=" * 75)
    print(f"🎉 SUCCESS! Microservice '{service_name}' is fully scaffolded and registered!")
    print("=" * 75)
    print(f"Service Path:      {main_file}")
    print(f"Port:              {port}")
    print(f"Endpoints Created:")
    print(f"  - Health Check:  GET  http://localhost:{port}/{route_prefix}/health")
    print(f"  - List Items:    GET  http://localhost:{port}/{route_prefix}/items")
    print(f"  - Create Item:   POST http://localhost:{port}/{route_prefix}/items")
    print(f"  - Prometheus:    GET  http://localhost:{port}/actuator/prometheus")
    print(f"  - Fault Inject:  POST http://localhost:{port}/fault/inject")
    print(f"  - Frontend API:  GET  http://localhost:3002/api/{route_prefix}/items")
    print("\nTo start your new service:")
    print(f"  python moviestream/services/start_services.py")
    print("=" * 75)


if __name__ == "__main__":
    main()
