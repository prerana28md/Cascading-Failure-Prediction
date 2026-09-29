import os

# Service Ports
CATALOG_PORT = int(os.getenv("CATALOG_PORT", "8087"))
USER_PORT = int(os.getenv("USER_PORT", "8088"))
WATCHLIST_PORT = int(os.getenv("WATCHLIST_PORT", "8089"))
HISTORY_PORT = int(os.getenv("HISTORY_PORT", "8092"))
RECOMMENDATION_PORT = int(os.getenv("RECOMMENDATION_PORT", "8093"))

# Service Inter-communication URLs
CATALOG_SERVICE_URL = os.getenv("CATALOG_SERVICE_URL", f"http://localhost:{CATALOG_PORT}")
USER_SERVICE_URL = os.getenv("USER_SERVICE_URL", f"http://localhost:{USER_PORT}")
WATCHLIST_SERVICE_URL = os.getenv("WATCHLIST_SERVICE_URL", f"http://localhost:{WATCHLIST_PORT}")
HISTORY_SERVICE_URL = os.getenv("HISTORY_SERVICE_URL", f"http://localhost:{HISTORY_PORT}")
RECOMMENDATION_SERVICE_URL = os.getenv("RECOMMENDATION_SERVICE_URL", f"http://localhost:{RECOMMENDATION_PORT}")

# Observability
JAEGER_OTLP_ENDPOINT = os.getenv("JAEGER_OTLP_ENDPOINT", "http://localhost:4318")
PROMETHEUS_GATEWAY_URL = os.getenv("PROMETHEUS_GATEWAY_URL", "http://localhost:9090")

# TMDB API
TMDB_API_KEY = os.getenv("TMDB_API_KEY", "")
TMDB_BASE_URL = "https://api.themoviedb.org/3"
TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p"
