import os
import time

try:
    import psutil
except ImportError:
    psutil = None
from fastapi import FastAPI, Request, Response
from prometheus_client import (
    CollectorRegistry,
    Counter,
    Histogram,
    Gauge,
    generate_latest,
    CONTENT_TYPE_LATEST
)
from starlette.middleware.base import BaseHTTPMiddleware

class ServiceMetrics:
    def __init__(self, service_name: str):
        self.service_name = service_name
        self.app_name = f"{service_name}-service" if not service_name.endswith("-service") else service_name
        self.registry = CollectorRegistry(auto_describe=True)

        # Standard Prometheus metrics matching Spring Boot Micrometer conventions
        self.http_requests_seconds = Histogram(
            "http_server_requests_seconds",
            "HTTP request duration in seconds",
            ["application", "status", "uri", "method"],
            registry=self.registry,
            buckets=(0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 0.75, 1.0, 2.5, 5.0, 10.0)
        )

        self.memory_used_bytes = Gauge(
            "jvm_memory_used_bytes",
            "Memory used in bytes (simulated heap compatibility)",
            ["application", "area"],
            registry=self.registry
        )

        self.busy_threads = Gauge(
            "tomcat_threads_busy_threads",
            "Busy worker threads",
            ["application"],
            registry=self.registry
        )

        # Initialize base gauges
        self.memory_used_bytes.labels(application=self.app_name, area="heap").set(48 * 1024 * 1024)
        self.busy_threads.labels(application=self.app_name).set(1)

    def record_request(self, uri: str, method: str, status_code: int, duration_seconds: float):
        # Normalize URI to avoid cardinality explosion
        clean_uri = uri.split("?")[0]
        self.http_requests_seconds.labels(
            application=self.app_name,
            status=str(status_code),
            uri=clean_uri,
            method=method
        ).observe(duration_seconds)

        # Update process metrics
        try:
            if psutil:
                mem = psutil.Process().memory_info().rss
                self.memory_used_bytes.labels(application=self.app_name, area="heap").set(mem)
        except Exception:
            pass

    def export(self) -> Response:
        return Response(content=generate_latest(self.registry), media_type=CONTENT_TYPE_LATEST)


class MetricsMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, metrics: ServiceMetrics):
        super().__init__(app)
        self.metrics = metrics

    async def dispatch(self, request: Request, call_next):
        start = time.time()
        try:
            response = await call_next(request)
            duration = time.time() - start
            self.metrics.record_request(request.url.path, request.method, response.status_code, duration)
            return response
        except Exception as exc:
            duration = time.time() - start
            self.metrics.record_request(request.url.path, request.method, 500, duration)
            raise exc


def register_metrics_endpoints(app: FastAPI, metrics: ServiceMetrics):
    app.add_middleware(MetricsMiddleware, metrics=metrics)

    @app.get("/actuator/prometheus")
    async def actuator_prometheus():
        return metrics.export()

    @app.get("/metrics")
    async def prometheus_metrics():
        return metrics.export()

    @app.get("/actuator/health")
    async def actuator_health():
        return {"status": "UP", "service": metrics.service_name}

    @app.get("/health")
    async def health():
        return {"status": "UP", "service": metrics.service_name}
