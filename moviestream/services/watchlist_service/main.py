import sys
import time
from pathlib import Path
from typing import Dict, Any, List
from fastapi import FastAPI, HTTPException, Body
from fastapi.middleware.cors import CORSMiddleware

# Ensure shared package is importable
CURRENT_DIR = Path(__file__).resolve().parent
SERVICES_DIR = CURRENT_DIR.parent
if str(SERVICES_DIR) not in sys.path:
    sys.path.insert(0, str(SERVICES_DIR))

from shared.config import WATCHLIST_PORT
from shared.fault_state import FaultState, FaultMiddleware, register_fault_endpoints
from shared.metrics import ServiceMetrics, register_metrics_endpoints
from shared.persistence import db_add_watchlist, db_remove_watchlist, db_get_watchlist

SERVICE_NAME = "watchlist-service"

app = FastAPI(
    title="MovieStream Watchlist Service",
    description="User saved movies, series, and 'My List' management",
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

# In-memory Watchlist Store: userId -> list of movie items
WATCHLIST_DB: Dict[str, List[Dict[str, Any]]] = {
    "alice": [
        {
            "id": 157336,
            "title": "Interstellar",
            "vote_average": 8.4,
            "poster_path": "/gEU2QniE6E77NI6lCU6MxlNBvIx.jpg",
            "backdrop_path": "/rAiYTgg0kWnJHHaV9vD63XZusQ7.jpg",
            "addedAt": time.time() - 86400
        },
        {
            "id": 335984,
            "title": "Blade Runner 2049",
            "vote_average": 7.6,
            "poster_path": "/gajva2L0rPYkEWjzgFlBXCAVBE5.jpg",
            "backdrop_path": "/ilRyASDvt7v5o1lwOSXQ3m62Fvm.jpg",
            "addedAt": time.time() - 43200
        }
    ],
    "bob": [
        {
            "id": 155,
            "title": "The Dark Knight",
            "vote_average": 8.5,
            "poster_path": "/qJ2tW6WMUDux911r6m7haRef0WH.jpg",
            "backdrop_path": "/dqK9Hag1054tghRQSqLSfrkvQnA.jpg",
            "addedAt": time.time() - 172800
        }
    ],
    "demo": [
        {
            "id": 693134,
            "title": "Dune: Part Two",
            "vote_average": 8.2,
            "poster_path": "/1pdfLvkbY9ohJlCjQH2CZjjYVvJ.jpg",
            "backdrop_path": "/xOMo8BRK7PfcJv9JCnx7s520DRq.jpg",
            "addedAt": time.time() - 3600
        },
        {
            "id": 872585,
            "title": "Oppenheimer",
            "vote_average": 8.1,
            "poster_path": "/8Gxv8gSFCU0XGDykEGv7zR1n2ua.jpg",
            "backdrop_path": "/fm6K9vYvt39mgrVI3xMYE48Y9Z8.jpg",
            "addedAt": time.time() - 7200
        }
    ]
}


@app.get("/watchlist/{user_id}")
async def get_watchlist(user_id: str):
    """Retrieve full watchlist for specified user with SQLite persistence."""
    uid = user_id.lower()
    persisted = db_get_watchlist(uid)
    if persisted:
        return persisted
    # Initial seed
    items = WATCHLIST_DB.get(uid, [])
    for it in items:
        db_add_watchlist(uid, it)
    return items


@app.post("/watchlist/{user_id}/add")
async def add_to_watchlist(user_id: str, movie: Dict[str, Any] = Body(...)):
    """Add a movie or series to user's saved list and persist to disk."""
    uid = user_id.lower()
    movie_id = movie.get("id")
    if not movie_id:
        raise HTTPException(status_code=400, detail="Movie ID is required")

    entry = {
        "id": int(movie_id),
        "title": movie.get("title", "Untitled"),
        "vote_average": movie.get("vote_average", 7.5),
        "poster_path": movie.get("poster_path", ""),
        "backdrop_path": movie.get("backdrop_path", ""),
        "genres": movie.get("genres", []),
        "addedAt": time.time()
    }

    db_add_watchlist(uid, entry)
    
    if uid not in WATCHLIST_DB:
        WATCHLIST_DB[uid] = []
    
    # Update memory
    WATCHLIST_DB[uid] = [m for m in WATCHLIST_DB[uid] if m.get("id") != movie_id]
    WATCHLIST_DB[uid].insert(0, entry)

    return {"status": "ADDED", "watchlist": db_get_watchlist(uid)}


@app.delete("/watchlist/{user_id}/remove/{movie_id}")
async def remove_from_watchlist(user_id: str, movie_id: int):
    """Remove a movie from user's watchlist in SQLite."""
    uid = user_id.lower()
    db_remove_watchlist(uid, int(movie_id))
    if uid in WATCHLIST_DB:
        WATCHLIST_DB[uid] = [m for m in WATCHLIST_DB[uid] if m.get("id") != movie_id]
    return {"status": "REMOVED", "watchlist": db_get_watchlist(uid)}


@app.get("/watchlist/{user_id}/check/{movie_id}")
async def check_in_watchlist(user_id: str, movie_id: int):
    """Check if movie is saved in user's watchlist."""
    uid = user_id.lower()
    items = WATCHLIST_DB.get(uid, [])
    in_list = any(m.get("id") == movie_id for m in items)
    return {"inWatchlist": in_list, "movieId": movie_id}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=WATCHLIST_PORT)
