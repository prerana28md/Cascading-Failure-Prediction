import asyncio
import logging
import time
from typing import Dict, Any
from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

logger = logging.getLogger("fault-state")

class FaultState:
    def __init__(self, service_name: str):
        self.service_name = service_name
        self.active_fault = "NONE"
        self.delay_ms = 0
        self.last_modified = time.time()

    def configure(self, fault: str, delay_ms: int = 0):
        fault = fault.upper() if fault else "NONE"
        if fault not in ("NONE", "LATENCY", "ERROR", "DOWN"):
            raise ValueError(f"Invalid fault type: {fault}")
        self.active_fault = fault
        self.delay_ms = max(0, delay_ms)
        self.last_modified = time.time()
        logger.warning(f"[{self.service_name}] Fault configured: {self.active_fault}, delayMs: {self.delay_ms}")

    def reset(self):
        self.active_fault = "NONE"
        self.delay_ms = 0
        self.last_modified = time.time()
        logger.info(f"[{self.service_name}] Fault state reset to NONE")

    def status(self) -> Dict[str, Any]:
        return {
            "service": self.service_name,
            "fault": self.active_fault,
            "faultType": self.active_fault,
            "delayMs": self.delay_ms,
            "active": self.active_fault != "NONE",
            "lastModified": self.last_modified
        }


class FaultMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, fault_state: FaultState):
        super().__init__(app)
        self.fault_state = fault_state

    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        # Exclude administrative and observability endpoints from fault interception
        if path.startswith(("/fault", "/health", "/actuator", "/metrics", "/docs", "/openapi.json", "/favicon.ico")):
            return await call_next(request)

        # Check active fault
        fault = self.fault_state.active_fault
        if fault == "DOWN":
            logger.warning(f"[{self.fault_state.service_name}] Injected DOWN fault active -> returning HTTP 503")
            return JSONResponse(
                status_code=503,
                content={"error": "Injected fault: SERVICE_DOWN", "service": self.fault_state.service_name}
            )

        if fault == "ERROR":
            logger.warning(f"[{self.fault_state.service_name}] Injected ERROR fault active -> returning HTTP 500")
            return JSONResponse(
                status_code=500,
                content={"error": "Injected fault: SERVICE_ERROR", "service": self.fault_state.service_name}
            )

        if fault == "LATENCY":
            delay_sec = self.fault_state.delay_ms / 1000.0
            if delay_sec > 0:
                logger.warning(f"[{self.fault_state.service_name}] Injected LATENCY fault active -> sleeping {delay_sec:.2f}s")
                await asyncio.sleep(delay_sec)

        return await call_next(request)


def register_fault_endpoints(app: FastAPI, fault_state: FaultState):
    @app.post("/fault/configure")
    async def configure_fault(req: Request):
        body = await req.json()
        fault = body.get("faultType") or body.get("fault") or "NONE"
        delay = body.get("delayMs") or body.get("delay_ms") or 0
        try:
            fault_state.configure(str(fault), int(delay))
            return {
                "service": fault_state.service_name,
                "fault": fault_state.active_fault,
                "faultType": fault_state.active_fault,
                "delayMs": fault_state.delay_ms,
                "status": "APPLIED",
                "active": fault_state.active_fault != "NONE"
            }
        except Exception as e:
            return JSONResponse(status_code=400, content={"error": str(e)})

    @app.post("/fault/reset")
    async def reset_fault():
        fault_state.reset()
        return {
            "service": fault_state.service_name,
            "fault": "NONE",
            "faultType": "NONE",
            "delayMs": 0,
            "status": "RESET",
            "active": False
        }

    @app.get("/fault/status")
    async def get_fault_status():
        return fault_state.status()

    # Path-based compatibility routes (e.g. /fault/{service}/status)
    @app.get("/fault/{service_name}/status")
    async def get_fault_status_path(service_name: str):
        return fault_state.status()

    @app.post("/fault/{service_name}/configure")
    async def configure_fault_path(service_name: str, req: Request):
        return await configure_fault(req)

    @app.post("/fault/{service_name}/reset")
    async def reset_fault_path(service_name: str):
        return await reset_fault()
