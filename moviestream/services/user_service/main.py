import sys
from pathlib import Path
from typing import Dict, Any, List
from fastapi import FastAPI, HTTPException, Body
from fastapi.middleware.cors import CORSMiddleware

# Ensure shared package is importable
CURRENT_DIR = Path(__file__).resolve().parent
SERVICES_DIR = CURRENT_DIR.parent
if str(SERVICES_DIR) not in sys.path:
    sys.path.insert(0, str(SERVICES_DIR))

from shared.config import USER_PORT
from shared.fault_state import FaultState, FaultMiddleware, register_fault_endpoints
from shared.metrics import ServiceMetrics, register_metrics_endpoints

SERVICE_NAME = "user-service"

app = FastAPI(
    title="MovieStream User Service",
    description="User profile, preferences, and streaming account management",
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

# Pre-seeded active streaming user profiles
PROFILES_DB: Dict[str, Dict[str, Any]] = {
    "alice": {
        "id": "alice",
        "username": "alice",
        "displayName": "Alice Reynolds",
        "avatarUrl": "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=150&q=80",
        "plan": "Ultra HD 4K Premium",
        "preferredGenres": [878, 12, 14],  # Sci-Fi, Adventure, Fantasy
        "streamingQuality": "4K_HDR",
        "autoplayPreviews": True,
        "matureAllowed": True
    },
    "bob": {
        "id": "bob",
        "username": "bob",
        "displayName": "Bob Sterling",
        "avatarUrl": "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=150&q=80",
        "plan": "Standard HD",
        "preferredGenres": [28, 53, 80],  # Action, Thriller, Crime
        "streamingQuality": "1080P",
        "autoplayPreviews": False,
        "matureAllowed": True
    },
    "demo": {
        "id": "demo",
        "username": "demo",
        "displayName": "Demo Viewer",
        "avatarUrl": "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=150&q=80",
        "plan": "Research Demonstration Profile",
        "preferredGenres": [878, 28, 18],  # Sci-Fi, Action, Drama
        "streamingQuality": "AUTO",
        "autoplayPreviews": True,
        "matureAllowed": True
    }
}


@app.get("/user/profiles")
async def list_profiles():
    """List all available viewer profiles."""
    return list(PROFILES_DB.values())


@app.get("/user/profile/{user_id}")
async def get_profile(user_id: str):
    """Retrieve full profile details and preferences for a user."""
    profile = PROFILES_DB.get(user_id.lower())
    if not profile:
        # Fallback to demo profile for unfamiliar user IDs
        return PROFILES_DB["demo"]
    return profile


@app.put("/user/profile/{user_id}/preferences")
async def update_preferences(user_id: str, prefs: Dict[str, Any] = Body(...)):
    """Update streaming preferences or favorite genres."""
    uid = user_id.lower()
    if uid not in PROFILES_DB:
        raise HTTPException(status_code=404, detail="User profile not found")

    profile = PROFILES_DB[uid]
    if "preferredGenres" in prefs:
        profile["preferredGenres"] = prefs["preferredGenres"]
    if "streamingQuality" in prefs:
        profile["streamingQuality"] = prefs["streamingQuality"]
    if "autoplayPreviews" in prefs:
        profile["autoplayPreviews"] = bool(prefs["autoplayPreviews"])

    return profile


@app.post("/user/login")
async def login_user(payload: Dict[str, str] = Body(...)):
    """Switch active profile or authenticate."""
    username = payload.get("username", "demo").lower()
    profile = PROFILES_DB.get(username, PROFILES_DB["demo"])
    return {
        "status": "AUTHENTICATED",
        "profile": profile,
        "sessionToken": f"moviestream-jwt-{username}-2026"
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=USER_PORT)
