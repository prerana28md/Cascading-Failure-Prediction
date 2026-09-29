import os
import sys
from pathlib import Path
from fastapi import FastAPI, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware

# Ensure shared package is importable
CURRENT_DIR = Path(__file__).resolve().parent
SERVICES_DIR = CURRENT_DIR.parent
if str(SERVICES_DIR) not in sys.path:
    sys.path.insert(0, str(SERVICES_DIR))

from shared.config import CATALOG_PORT
from shared.fault_state import FaultState, FaultMiddleware, register_fault_endpoints
from shared.metrics import ServiceMetrics, register_metrics_endpoints
from shared.tmdb_client import tmdb_client, REAL_TMDB_CATALOG
from shared.trailer_resolver import resolve_trailer_key

SERVICE_NAME = "catalog-service"

app = FastAPI(
    title="MovieStream Catalog Service",
    description="Real TMDB movie and television metadata catalog service",
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


@app.on_event("startup")
async def on_startup():
    """Starts automated live catalog collector background polling worker."""
    tmdb_client.start_live_collector()


@app.get("/catalog/sync/status")
async def get_sync_status():
    """Live telemetry and status of automated API catalog collector."""
    return tmdb_client.get_sync_status()


@app.post("/catalog/sync/trigger")
async def trigger_live_sync():
    """Immediately triggers on-demand live API synchronization."""
    result = await tmdb_client.trigger_live_sync()
    return result


@app.get("/catalog/billboard")
async def get_billboard():
    """Featured hero billboard movie for top of home page."""
    return tmdb_client.get_billboard()


@app.get("/catalog/trending")
async def get_trending():
    """Trending movies & series this week from TMDB."""
    return await tmdb_client.get_trending()


@app.get("/catalog/popular")
async def get_popular():
    """Popular movies from TMDB."""
    return await tmdb_client.get_popular()


@app.get("/catalog/top-rated")
async def get_top_rated():
    """Top-rated movies from TMDB."""
    return await tmdb_client.get_top_rated()


@app.get("/catalog/genres")
async def get_genres():
    """Available movie & television genres."""
    return tmdb_client.get_genres()


@app.get("/catalog/genre/{genre_id}")
async def get_by_genre(genre_id: int):
    """Movies filtered by genre ID."""
    return await tmdb_client.get_by_genre(genre_id)


@app.get("/catalog/movie/{movie_id}")
async def get_movie(movie_id: int):
    """Detailed metadata for a specific movie or series."""
    movie = await tmdb_client.get_movie_details(movie_id)
    if not movie:
        raise HTTPException(status_code=404, detail=f"Movie with ID {movie_id} not found")
    title = movie.get("title", "")
    t_key = movie.get("trailer_key")
    if not t_key or (t_key == "Way9Dexny3w" and "dune: part two" not in title.lower() and "dune 2" not in title.lower()):
        movie["trailer_key"] = resolve_trailer_key(title)
    return movie


@app.get("/catalog/movie/{movie_id}/trailer")
async def get_movie_trailer(movie_id: int):
    """Returns the authentic verified YouTube trailer key for a movie or TV show."""
    movie = await tmdb_client.get_movie_details(movie_id)
    if not movie:
        raise HTTPException(status_code=404, detail=f"Movie with ID {movie_id} not found")
    title = movie.get("title", "")
    t_key = movie.get("trailer_key")
    if not t_key or (t_key == "Way9Dexny3w" and "dune: part two" not in title.lower() and "dune 2" not in title.lower()):
        t_key = resolve_trailer_key(title)
        movie["trailer_key"] = t_key
    return {"movieId": movie_id, "title": title, "trailerKey": t_key}


@app.get("/catalog/movie/{movie_id}/similar")
async def get_similar(movie_id: int):
    """Similar movies based on genre and thematic attributes."""
    return await tmdb_client.get_similar(movie_id)


@app.get("/catalog/search")
async def search_movies(q: str = Query(..., min_length=1)):
    """Search movies and TV shows by keyword, cast or title."""
    return await tmdb_client.search(q)


@app.get("/catalog/tv")
async def get_tv_shows():
    """TV Series and multi-episode shows."""
    return await tmdb_client.get_tv_shows()


@app.get("/catalog/movies")
async def get_movies():
    """Full-length feature movies."""
    return await tmdb_client.get_movies()


@app.get("/catalog/top10")
async def get_top10():
    """Top 10 most-watched titles in India Today (ranked 1-10)."""
    return await tmdb_client.get_top_10_india()


@app.get("/catalog/originals")
async def get_originals():
    """Netflix Global Originals."""
    return await tmdb_client.get_netflix_originals()


@app.get("/catalog/regional/kannada")
async def get_kannada_movies():
    """Authentic Kannada cinema from TMDB (Sandalwood blockbusters)."""
    return await tmdb_client.get_kannada_movies()


@app.get("/catalog/regional/telugu")
async def get_telugu_movies():
    """Authentic Telugu cinema from TMDB (Tollywood & Pan-India blockbusters)."""
    return await tmdb_client.get_telugu_movies()


@app.get("/catalog/indian")
async def get_indian_cinema():
    """Pan-India Blockbusters (Kannada, Telugu, Hindi)."""
    kannada = await tmdb_client.get_kannada_movies()
    telugu = await tmdb_client.get_telugu_movies()
    hindi = [m for m in REAL_TMDB_CATALOG if m.get("original_language") == "hi" or "Hindi" in m.get("region", "")]
    return kannada + telugu + hindi


@app.get("/catalog/rows")
async def get_home_rows():
    """Aggregated catalog rows for the streaming application homepage."""
    top10 = await tmdb_client.get_top_10_india()
    trending = await tmdb_client.get_trending()
    kannada = await tmdb_client.get_kannada_movies()
    telugu = await tmdb_client.get_telugu_movies()
    hindi = [m for m in REAL_TMDB_CATALOG if m.get("original_language") == "hi" or "Hindi" in m.get("region", "")]
    indian = kannada + telugu + hindi
    originals = await tmdb_client.get_netflix_originals()
    top_rated = await tmdb_client.get_top_rated()
    scifi = await tmdb_client.get_by_genre(878)
    action = await tmdb_client.get_by_genre(28)

    return [
        {"id": "top10", "title": "🏆 Top 10 in India Today", "items": top10, "isTop10": True},
        {"id": "trending", "title": "🔥 Trending Now", "items": trending},
        {"id": "indian_cinema", "title": "👑 Blockbusters of Indian Cinema", "items": indian},
        {"id": "originals", "title": "🔴 Netflix Global Originals", "items": originals},
        {"id": "top_rated", "title": "⭐ Critically Acclaimed Masterpieces", "items": top_rated},
        {"id": "scifi", "title": "🚀 Sci-Fi & Speculative Fiction", "items": scifi},
        {"id": "action", "title": "💥 High-Octane Action & Thrills", "items": action}
    ]


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=CATALOG_PORT)
