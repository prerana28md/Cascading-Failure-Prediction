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

from shared.config import HISTORY_PORT
from shared.fault_state import FaultState, FaultMiddleware, register_fault_endpoints
from shared.metrics import ServiceMetrics, register_metrics_endpoints
from shared.persistence import db_save_history, db_get_history

SERVICE_NAME = "history-service"

app = FastAPI(
    title="MovieStream History Service",
    description="Playback progress tracking, resume points, and watch history",
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

# In-memory History & Continue Watching Store: userId -> list of history entries
HISTORY_DB: Dict[str, List[Dict[str, Any]]] = {
    "alice": [
        {
            "id": 1083637,
            "title": "Kantara",
            "progressSeconds": 4200,
            "durationSeconds": 8880,
            "percentage": 47,
            "completed": False,
            "poster_path": "/w57nxiBIODAYHLRs1xmrCY9zEFe.jpg",
            "backdrop_path": "/w57nxiBIODAYHLRs1xmrCY9zEFe.jpg",
            "lastWatched": time.time() - 900
        },
        {
            "id": 66732,
            "title": "Stranger Things",
            "progressSeconds": 2100,
            "durationSeconds": 3000,
            "percentage": 70,
            "completed": False,
            "poster_path": "/49WJfeN0moxb9IPfGn8AIqMGskD.jpg",
            "backdrop_path": "/56v2KjBlU4XaOv9rVYEQypROD7P.jpg",
            "lastWatched": time.time() - 3600
        },
        {
            "id": 579974,
            "title": "RRR",
            "progressSeconds": 6100,
            "durationSeconds": 11220,
            "percentage": 54,
            "completed": False,
            "poster_path": "/i0Y0wP8H6SRgjr6QmuwbtQbS24D.jpg",
            "backdrop_path": "/i0Y0wP8H6SRgjr6QmuwbtQbS24D.jpg",
            "lastWatched": time.time() - 7200
        },
        {
            "id": 693134,
            "title": "Dune: Part Two",
            "progressSeconds": 3200,
            "durationSeconds": 9960,
            "percentage": 32,
            "completed": False,
            "poster_path": "/1pdfLvkbY9ohJlCjQH2CZjjYVvJ.jpg",
            "backdrop_path": "/xOMo8BRK7PfcJv9JCnx7s520DRq.jpg",
            "lastWatched": time.time() - 14400
        },
        {
            "id": 1396,
            "title": "Breaking Bad",
            "progressSeconds": 2820,
            "durationSeconds": 2820,
            "percentage": 100,
            "completed": True,
            "poster_path": "/ztkUQFLlC19CCMYHW9o1zWhJRNq.jpg",
            "backdrop_path": "/ztkUQFLlC19CCMYHW9o1zWhJRNq.jpg",
            "lastWatched": time.time() - 86400
        }
    ],
    "bob": [
        {
            "id": 603,
            "title": "The Matrix",
            "progressSeconds": 3200,
            "durationSeconds": 8160,
            "percentage": 39,
            "completed": False,
            "poster_path": "/f89U3ADr1oiB1s9GkdPOEpXUk5H.jpg",
            "backdrop_path": "/l4QHerTSbflqOWv4EV26Q3y3aao.jpg",
            "lastWatched": time.time() - 3600
        }
    ],
    "demo": [
        {
            "id": 157336,
            "title": "Interstellar",
            "progressSeconds": 6200,
            "durationSeconds": 10140,
            "percentage": 61,
            "completed": False,
            "poster_path": "/gEU2QniE6E77NI6lCU6MxlNBvIx.jpg",
            "backdrop_path": "/rAiYTgg0kWnJHHaV9vD63XZusQ7.jpg",
            "lastWatched": time.time() - 900
        },
        {
            "id": 872585,
            "title": "Oppenheimer",
            "progressSeconds": 2400,
            "durationSeconds": 10860,
            "percentage": 22,
            "completed": False,
            "poster_path": "/8Gxv8gSFCU0XGDykEGv7zR1n2ua.jpg",
            "backdrop_path": "/fm6K9vYvt39mgrVI3xMYE48Y9Z8.jpg",
            "lastWatched": time.time() - 5400
        }
    ]
}


@app.get("/history/{user_id}")
async def get_history(user_id: str):
    """Full chronological playback history with SQLite persistence."""
    uid = user_id.lower()
    persisted = db_get_history(uid)
    if persisted:
        return persisted
    # Initial seed into SQLite
    items = HISTORY_DB.get(uid, [])
    for it in items:
        db_save_history(uid, it)
    return sorted(items, key=lambda x: x.get("lastWatched", 0), reverse=True)


@app.get("/history/{user_id}/continue-watching")
async def get_continue_watching(user_id: str):
    """Retrieve movies currently in progress (not completed, 1% - 95%)."""
    uid = user_id.lower()
    persisted = db_get_history(uid)
    items = persisted if persisted else HISTORY_DB.get(uid, [])
    in_progress = [
        item for item in items
        if not item.get("completed", False) and 1 <= item.get("percentage", 0) <= 95
    ]
    return sorted(in_progress, key=lambda x: x.get("lastWatched", 0), reverse=True)


@app.post("/history/{user_id}/progress")
async def update_progress(user_id: str, payload: Dict[str, Any] = Body(...)):
    """Update active playback position, progress percentage, resume point and persist to disk."""
    uid = user_id.lower()
    if uid not in HISTORY_DB:
        HISTORY_DB[uid] = []

    movie_id = payload.get("id") or payload.get("movieId")
    if not movie_id:
        raise HTTPException(status_code=400, detail="Movie ID is required")

    progress = int(payload.get("progressSeconds", 0))
    duration = max(1, int(payload.get("durationSeconds", 7200)))
    percentage = min(100, max(0, int((progress / duration) * 100)))
    completed = percentage >= 95 or bool(payload.get("completed", False))

    entry = {
        "id": int(movie_id),
        "movieId": int(movie_id),
        "title": payload.get("title", "Untitled"),
        "progressSeconds": progress,
        "durationSeconds": duration,
        "percentage": percentage,
        "completed": completed,
        "poster_path": payload.get("poster_path", ""),
        "backdrop_path": payload.get("backdrop_path", ""),
        "lastWatched": time.time()
    }

    # Persist directly into SQLite database on disk
    db_save_history(uid, entry)

    # In-memory fast cache
    existing = next((m for m in HISTORY_DB[uid] if m.get("id") == movie_id), None)
    if existing:
        existing.update(entry)
    else:
        HISTORY_DB[uid].insert(0, entry)

    return {"status": "UPDATED", "entry": entry}


@app.post("/history/{user_id}/complete/{movie_id}")
async def mark_completed(user_id: str, movie_id: int):
    """Mark a title as completed."""
    uid = user_id.lower()
    if uid in HISTORY_DB:
        for m in HISTORY_DB[uid]:
            if m.get("id") == movie_id:
                m["completed"] = True
                m["percentage"] = 100
                m["lastWatched"] = time.time()
    return {"status": "MARKED_COMPLETED", "movieId": movie_id}


@app.delete("/history/{user_id}/remove/{movie_id}")
async def remove_history_item(user_id: str, movie_id: int):
    """Remove item from user's watch history."""
    uid = user_id.lower()
    if uid in HISTORY_DB:
        HISTORY_DB[uid] = [m for m in HISTORY_DB[uid] if m.get("id") != movie_id]
    return {"status": "REMOVED", "history": HISTORY_DB.get(uid, [])}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=HISTORY_PORT)
