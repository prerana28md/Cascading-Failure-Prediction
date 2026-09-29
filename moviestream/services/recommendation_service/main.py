import sys
import logging
from pathlib import Path
from typing import Dict, Any, List
import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

# Ensure shared package is importable
CURRENT_DIR = Path(__file__).resolve().parent
SERVICES_DIR = CURRENT_DIR.parent
if str(SERVICES_DIR) not in sys.path:
    sys.path.insert(0, str(SERVICES_DIR))

from shared.config import (
    RECOMMENDATION_PORT,
    CATALOG_SERVICE_URL,
    HISTORY_SERVICE_URL,
    USER_SERVICE_URL,
    WATCHLIST_SERVICE_URL
)
from shared.fault_state import FaultState, FaultMiddleware, register_fault_endpoints
from shared.metrics import ServiceMetrics, register_metrics_endpoints
from shared.tmdb_client import REAL_TMDB_CATALOG

logger = logging.getLogger("recommendation-service")
SERVICE_NAME = "recommendation-service"

app = FastAPI(
    title="MovieStream Recommendation Service",
    description="Personalized streaming recommendation engine with multi-service dependencies",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Fault Injection & Observability Instrumentation
fault_state = FaultState(SERVICE_NAME)
app.add_middleware(FaultMiddleware, fault_state=fault_state)
register_fault_endpoints(app, fault_state)

metrics = ServiceMetrics(SERVICE_NAME)
register_metrics_endpoints(app, metrics)


@app.get("/recommendations/{user_id}")
async def get_personalized_recommendations(user_id: str):
    """
    Computes personalized recommendation rows for user.
    Architectural dependencies:
      1. Calls user-service to fetch favorite genres
      2. Calls history-service to get recently watched items
      3. Calls watchlist-service to inspect saved items
      4. Calls catalog-service to retrieve similar titles
    
    If catalog-service or history-service experiences LATENCY or FAILURE,
    this orchestrator experiences cascading latency or degradation!
    """
    uid = user_id.lower()
    user_genres = [878, 28]  # Defaults to Sci-Fi, Action
    history_items = []
    watchlist_items = []
    catalog_similar = []
    upstream_errors = []

    # 1. Fetch User Profile
    async with httpx.AsyncClient(timeout=3.0) as client:
        try:
            r = await client.get(f"{USER_SERVICE_URL}/user/profile/{uid}")
            if r.status_code == 200:
                profile = r.json()
                user_genres = profile.get("preferredGenres", user_genres)
        except Exception as e:
            logger.warning(f"Failed to fetch user profile from {USER_SERVICE_URL}: {e}")
            upstream_errors.append(f"user-service: {str(e)}")

        # 2. Fetch History (Recent Watches)
        try:
            r = await client.get(f"{HISTORY_SERVICE_URL}/history/{uid}")
            if r.status_code == 200:
                history_items = r.json()
        except Exception as e:
            logger.warning(f"Failed to fetch history from {HISTORY_SERVICE_URL}: {e}")
            upstream_errors.append(f"history-service: {str(e)}")

        # 3. Fetch Watchlist
        try:
            r = await client.get(f"{WATCHLIST_SERVICE_URL}/watchlist/{uid}")
            if r.status_code == 200:
                watchlist_items = r.json()
        except Exception as e:
            logger.warning(f"Failed to fetch watchlist from {WATCHLIST_SERVICE_URL}: {e}")
            upstream_errors.append(f"watchlist-service: {str(e)}")

        # 4. Dependency Cascade Anchor: Call Catalog Service for similar titles to last watched
        last_watched_id = history_items[0]["id"] if history_items else 693134  # Dune 2 default
        last_watched_title = history_items[0].get("title", "Dune: Part Two") if history_items else "Dune: Part Two"

        try:
            r = await client.get(f"{CATALOG_SERVICE_URL}/catalog/movie/{last_watched_id}/similar")
            if r.status_code == 200:
                catalog_similar = r.json()
            elif r.status_code == 503:
                # Downstream impact of Catalog Service DOWN
                raise HTTPException(status_code=503, detail="Catalog Service is DOWN: Recommendation engine cannot resolve titles")
        except httpx.TimeoutException:
            # Downstream impact of Catalog Service LATENCY
            logger.error(f"Catalog service timed out while generating recommendations for {last_watched_id}")
            upstream_errors.append("catalog-service: TimeoutException (>3.0s)")
        except Exception as e:
            logger.warning(f"Failed to fetch similar movies from {CATALOG_SERVICE_URL}: {e}")
            upstream_errors.append(f"catalog-service: {str(e)}")

    # Score and assemble recommendations
    seen_ids = {item["id"] for item in history_items} | {item["id"] for item in watchlist_items}

    # "Top Picks for You" based on favorite genre match
    top_picks = []
    for m in REAL_TMDB_CATALOG:
        if m["id"] not in seen_ids:
            score = sum(1 for g in m.get("genre_ids", []) if g in user_genres)
            if score > 0:
                top_picks.append((score, m))
    top_picks.sort(key=lambda x: (x[0], x[1].get("vote_average", 0)), reverse=True)
    top_picks_items = [m for _, m in top_picks[:8]]
    if not top_picks_items:
        top_picks_items = REAL_TMDB_CATALOG[:6]

    # "Because You Watched {last_watched_title}"
    because_watched_items = catalog_similar[:6] if catalog_similar else [m for m in REAL_TMDB_CATALOG if m["id"] != last_watched_id][:6]

    return {
        "userId": uid,
        "recommendations": top_picks_items,
        "lastWatchedTitle": last_watched_title,
        "becauseWatched": because_watched_items,
        "sections": [
            {
                "id": "top_picks",
                "title": f"✨ Top Picks for {uid.capitalize()}",
                "subtitle": "Personalized based on your viewing taste & preferred genres",
                "items": top_picks_items
            },
            {
                "id": "because_watched",
                "title": f"🍿 Because You Watched {last_watched_title}",
                "subtitle": f"Similar titles from Catalog Service",
                "items": because_watched_items
            }
        ],
        "meta": {
            "upstreamDependencies": ["user-service", "history-service", "watchlist-service", "catalog-service"],
            "upstreamErrors": upstream_errors,
            "cascadeResilience": "ACTIVE"
        }
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=RECOMMENDATION_PORT)
