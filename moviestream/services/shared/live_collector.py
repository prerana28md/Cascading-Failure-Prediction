"""
MovieStream Live API Catalog Collector
Automatically collects, streams, and ingests live data continuously from:
- Cinemeta Live Streaming API (Open IMDb / TMDB real-world metadata)
- TVMaze Live Television API (Airing schedules, episodes, posters)
- TheMovieDatabase v3 Official API (when TMDB_API_KEY is configured)

Features:
- Continuous background polling worker (every 10 minutes)
- Startup automated auto-ingestion
- Dynamic real-time search that queries the live API on-the-fly for any searched title
- Deduplication and schema normalization
- Live sync telemetry & status reporting
"""

import os
import sys
import time
import asyncio
import hashlib
import logging
from datetime import datetime, timezone
from typing import Dict, List, Any, Optional
import httpx

from .config import TMDB_API_KEY, TMDB_BASE_URL
from .persistence import save_catalog_cache, load_catalog_cache
from .trailer_resolver import resolve_trailer_key

logger = logging.getLogger("live-catalog-collector")

GENRE_MAP = {
    "Action": 28,
    "Adventure": 12,
    "Animation": 16,
    "Comedy": 35,
    "Crime": 80,
    "Documentary": 99,
    "Drama": 18,
    "Family": 10751,
    "Fantasy": 14,
    "History": 36,
    "Horror": 27,
    "Music": 10402,
    "Mystery": 9648,
    "Romance": 10749,
    "Science Fiction": 878,
    "Sci-Fi": 878,
    "TV Movie": 10770,
    "Thriller": 53,
    "War": 10752,
    "Western": 37,
    "Action & Adventure": 10759,
    "Sci-Fi & Fantasy": 10765,
}

# Regional detection keywords
KANNADA_KEYWORDS = ["kantara", "k.g.f", "kgf", "777 charlie", "garuda gamana", "sapta sagaradaache", "vikrant rona", "sandalwood", "kannada", "charlie 777", "rishab shetty", "rakshit shetty", "yash", "shivarajkumar"]
TELUGU_KEYWORDS = ["rrr", "baahubali", "pushpa", "salaar", "hanu-man", "hanuman", "kalki", "devara", "tollywood", "telugu", "prabhas", "allu arjun", "ram charan", "jr ntr", "ss rajamouli", "mahesh babu"]
HINDI_KEYWORDS = ["jawan", "animal", "pathaan", "stree", "dangal", "bollywood", "hindi", "shah rukh khan", "ranbir kapoor", "amitabh bachchan"]
ORIGINALS_KEYWORDS = ["stranger things", "wednesday", "squid game", "money heist", "dark", "black mirror", "the queen's gambit", "peaky blinders", "the witcher", "narcos", "the crown", "ozark", "daredevil"]


class LiveCatalogCollector:
    def __init__(self, target_catalog_list: List[Dict[str, Any]]):
        self.target_catalog = target_catalog_list
        self.catalog_map: Dict[int, Dict[str, Any]] = {}
        self.imdb_map: Dict[str, int] = {}
        self.title_map: Dict[str, int] = {}
        
        # Populate initial index from existing catalog
        for item in self.target_catalog:
            mid = item["id"]
            self.catalog_map[mid] = item
            self.title_map[item.get("title", "").lower().strip()] = mid
            if "imdb_id" in item:
                self.imdb_map[item["imdb_id"]] = mid

        self.api_key = TMDB_API_KEY
        self.sync_interval = 600  # 10 minutes
        self.sync_running = False
        self.last_sync_time: Optional[str] = None
        self.sync_count = 0
        self.live_added_count = 0
        self.worker_task: Optional[asyncio.Task] = None
        self.active_providers = [
            "Cinemeta Live TMDB/IMDb API (v3-cinemeta.strem.io)",
            "TVMaze Live Streaming API (api.tvmaze.com)"
        ]
        if self.api_key:
            self.active_providers.append("TheMovieDatabase v3 Official API")

        # Ingest previously cached titles from disk for instant warm start
        cached = load_catalog_cache()
        if cached:
            for item in cached:
                self.ingest_movie(item)

    def _generate_numeric_id(self, raw_id: Any, title: str) -> int:
        """Deterministically generates a safe, clean integer ID."""
        if isinstance(raw_id, int):
            return raw_id
        if isinstance(raw_id, str) and raw_id.isdigit():
            return int(raw_id)
        # Hash string (e.g. 'tt15327088' or title) to 7-digit integer
        seed = f"{raw_id}:{title}"
        h = int(hashlib.md5(seed.encode("utf-8")).hexdigest()[:8], 16)
        return abs(h) % 9000000 + 1000000

    def _detect_regional_attributes(self, title: str, overview: str, genres_str: str) -> Dict[str, Any]:
        """Detects Kannada, Telugu, Hindi, or Netflix Original attributes."""
        combined = f"{title.lower()} {overview.lower()} {genres_str.lower()}"
        
        # Check Kannada
        if any(k in combined for k in KANNADA_KEYWORDS):
            return {
                "original_language": "kn",
                "region": "Kannada Sandalwood",
                "is_original": False
            }
        # Check Telugu
        if any(k in combined for k in KANNADA_KEYWORDS) or any(k in combined for k in TELUGU_KEYWORDS):
            return {
                "original_language": "te",
                "region": "Telugu Tollywood",
                "is_original": False
            }
        # Check Hindi
        if any(k in combined for k in HINDI_KEYWORDS):
            return {
                "original_language": "hi",
                "region": "Hindi Bollywood",
                "is_original": False
            }
        # Check Netflix Original
        if any(k in combined for k in ORIGINALS_KEYWORDS) or "netflix" in combined:
            return {
                "original_language": "en",
                "region": "Netflix Global Original",
                "is_original": True
            }
            
        return {
            "original_language": "en",
            "region": "Global Cinema",
            "is_original": False
        }

    def _normalize_cinemeta_item(self, item: Dict[str, Any], media_type: str = "movie") -> Optional[Dict[str, Any]]:
        """Converts raw Cinemeta meta into MovieStream standard movie schema."""
        title = item.get("name") or item.get("title")
        if not title:
            return None
            
        imdb_id = item.get("id") or item.get("imdb_id") or ""
        moviedb_id = item.get("moviedb_id")
        num_id = self._generate_numeric_id(moviedb_id or imdb_id, title)

        poster = item.get("poster") or ""
        background = item.get("background") or poster or ""
        if not poster:
            poster = background
        if not poster:
            return None

        # Year and release date
        year = str(item.get("releaseInfo") or item.get("year") or "2024").strip()
        if len(year) > 4:
            year = year[:4]
        release_date = f"{year}-01-01"

        # Rating
        raw_rating = item.get("imdbRating") or item.get("rating") or 7.8
        try:
            vote_avg = round(float(raw_rating), 1)
        except Exception:
            vote_avg = 7.8

        overview = item.get("description") or item.get("overview") or f"{title} ({year}) - High-definition streaming feature presentation."
        
        # Cast and director
        cast = item.get("cast") or ["Featured Cast"]
        if isinstance(cast, str):
            cast = [cast]
        director = item.get("director") or "Acclaimed Filmmaker"
        if isinstance(director, list):
            director = director[0] if director else "Acclaimed Filmmaker"

        # Genres
        raw_genres = item.get("genres") or item.get("genre") or ["Drama"]
        if isinstance(raw_genres, str):
            raw_genres = [raw_genres]
        
        genre_objs = []
        genre_ids = []
        for g in raw_genres:
            gid = GENRE_MAP.get(g, 18)
            genre_objs.append({"id": gid, "name": g})
            if gid not in genre_ids:
                genre_ids.append(gid)

        # YouTube Trailer: Use authentic verified resolver first, or live trailerStreams
        trailer_key = resolve_trailer_key(title)
        trailers = item.get("trailerStreams") or []
        if trailers and isinstance(trailers, list):
            for t in trailers:
                if isinstance(t, dict) and t.get("ytId"):
                    trailer_key = t["ytId"]
                    break

        regional_info = self._detect_regional_attributes(title, overview, " ".join(raw_genres))

        return {
            "id": num_id,
            "imdb_id": imdb_id,
            "title": title,
            "tagline": item.get("tagline", "Now Streaming in 4K Ultra HD"),
            "overview": overview,
            "release_date": release_date,
            "vote_average": vote_avg,
            "vote_count": int(item.get("vote_count", 2400)),
            "runtime": 135,
            "poster_path": poster,
            "backdrop_path": background,
            "genres": genre_objs,
            "genre_ids": genre_ids,
            "media_type": media_type,
            "director": director,
            "cast": cast[:6],
            "trailer_key": trailer_key,
            "original_language": regional_info["original_language"],
            "region": regional_info["region"],
            "is_original": regional_info["is_original"],
            "source": "LIVE_API_CINEMETA"
        }

    def _normalize_tvmaze_show(self, item: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Converts TVMaze show JSON into MovieStream standard schema."""
        title = item.get("name")
        if not title:
            return None
        
        show_id = item.get("id")
        num_id = self._generate_numeric_id(show_id, title)

        images = item.get("image") or {}
        poster = images.get("original") or images.get("medium") or ""
        if not poster:
            return None

        rating_data = item.get("rating") or {}
        vote_avg = round(float(rating_data.get("average") or 8.0), 1)

        raw_summary = item.get("summary") or f"{title} - Premier TV series streaming live."
        # Strip HTML tags from TVMaze summary
        clean_summary = raw_summary.replace("<p>", "").replace("</p>", "").replace("<b>", "").replace("</b>", "").replace("<i>", "").replace("</i>", "")

        raw_genres = item.get("genres") or ["Drama"]
        genre_objs = []
        genre_ids = []
        for g in raw_genres:
            gid = GENRE_MAP.get(g, 18)
            genre_objs.append({"id": gid, "name": g})
            if gid not in genre_ids:
                genre_ids.append(gid)

        premiered = item.get("premiered") or "2023-01-01"
        regional_info = self._detect_regional_attributes(title, clean_summary, " ".join(raw_genres))

        return {
            "id": num_id,
            "title": title,
            "tagline": "Acclaimed Television Series",
            "overview": clean_summary,
            "release_date": premiered,
            "vote_average": vote_avg,
            "vote_count": 3500,
            "runtime": item.get("runtime") or 50,
            "poster_path": poster,
            "backdrop_path": poster,
            "genres": genre_objs,
            "genre_ids": genre_ids,
            "media_type": "tv",
            "director": "Television Producer",
            "cast": ["Series Cast"],
            "trailer_key": resolve_trailer_key(title),
            "original_language": regional_info["original_language"],
            "region": regional_info["region"],
            "is_original": regional_info["is_original"],
            "source": "LIVE_API_TVMAZE"
        }

    def ingest_movie(self, movie: Dict[str, Any]) -> bool:
        """Ingests and deduplicates a movie item into the catalog."""
        mid = movie["id"]
        title_key = movie.get("title", "").lower().strip()
        imdb_id = movie.get("imdb_id")

        # If already exists, update properties with live metadata
        if mid in self.catalog_map:
            self.catalog_map[mid].update(movie)
            return False

        if title_key and title_key in self.title_map:
            existing_id = self.title_map[title_key]
            self.catalog_map[existing_id].update(movie)
            return False

        if imdb_id and imdb_id in self.imdb_map:
            existing_id = self.imdb_map[imdb_id]
            self.catalog_map[existing_id].update(movie)
            return False

        # New live item!
        self.catalog_map[mid] = movie
        if title_key:
            self.title_map[title_key] = mid
        if imdb_id:
            self.imdb_map[imdb_id] = mid
        
        # Append to the shared in-memory list so all other services see it immediately
        self.target_catalog.append(movie)
        self.live_added_count += 1
        return True

    # ── Live API Fetchers ──────────────────────────────────────────────────────

    async def fetch_cinemeta_catalog(self, path: str, media_type: str = "movie") -> List[Dict[str, Any]]:
        """Fetches catalog items from Cinemeta Live API."""
        url = f"https://v3-cinemeta.strem.io{path}"
        try:
            async with httpx.AsyncClient(timeout=8.0) as client:
                res = await client.get(url, headers={"User-Agent": "Mozilla/5.0 (MovieStream/2.0)"})
                if res.status_code == 200:
                    data = res.json()
                    metas = data.get("metas", [])
                    items = []
                    for m in metas:
                        normalized = self._normalize_cinemeta_item(m, media_type)
                        if normalized:
                            items.append(normalized)
                    return items
        except Exception as e:
            logger.warning(f"Cinemeta fetch error for {path}: {e}")
        return []

    async def fetch_cinemeta_search(self, query: str, media_type: str = "movie") -> List[Dict[str, Any]]:
        """Searches Cinemeta live API for specific titles or franchises."""
        path = f"/catalog/{media_type}/top/search={query}.json"
        return await self.fetch_cinemeta_catalog(path, media_type)

    async def fetch_tvmaze_shows(self) -> List[Dict[str, Any]]:
        """Fetches popular television shows live from TVMaze."""
        url = "https://api.tvmaze.com/shows?page=0"
        try:
            async with httpx.AsyncClient(timeout=8.0) as client:
                res = await client.get(url, headers={"User-Agent": "Mozilla/5.0 (MovieStream/2.0)"})
                if res.status_code == 200:
                    shows = res.json()
                    items = []
                    for s in shows[:35]:
                        normalized = self._normalize_tvmaze_show(s)
                        if normalized:
                            items.append(normalized)
                    return items
        except Exception as e:
            logger.warning(f"TVMaze shows fetch error: {e}")
        return []

    async def fetch_tmdb_trending(self) -> List[Dict[str, Any]]:
        """Fetches trending movies from TMDB if API key is provided."""
        if not self.api_key:
            return []
        url = f"{TMDB_BASE_URL}/trending/all/week"
        try:
            async with httpx.AsyncClient(timeout=8.0) as client:
                res = await client.get(url, params={"api_key": self.api_key})
                if res.status_code == 200:
                    results = res.json().get("results", [])
                    items = []
                    for r in results:
                        mid = r.get("id")
                        title = r.get("title") or r.get("name")
                        poster = f"https://image.tmdb.org/t/p/w500{r.get('poster_path')}" if r.get("poster_path") else ""
                        backdrop = f"https://image.tmdb.org/t/p/original{r.get('backdrop_path')}" if r.get("backdrop_path") else poster
                        if not poster or not mid or not title:
                            continue
                        gids = r.get("genre_ids", [878])
                        items.append({
                            "id": mid,
                            "title": title,
                            "tagline": "TMDB Live Trending Hit",
                            "overview": r.get("overview", ""),
                            "release_date": r.get("release_date") or r.get("first_air_date") or "2024-01-01",
                            "vote_average": round(float(r.get("vote_average", 7.9)), 1),
                            "vote_count": int(r.get("vote_count", 5000)),
                            "runtime": 128,
                            "poster_path": poster,
                            "backdrop_path": backdrop,
                            "genres": [{"id": gid, "name": "Feature"} for gid in gids],
                            "genre_ids": gids,
                            "media_type": r.get("media_type", "movie"),
                            "director": "Hollywood Director",
                            "cast": ["Featured Stars"],
                            "trailer_key": resolve_trailer_key(title),
                            "original_language": r.get("original_language", "en"),
                            "region": "TMDB Global Trending",
                            "is_original": False,
                            "source": "LIVE_API_TMDB_V3"
                        })
                    return items
        except Exception as e:
            logger.warning(f"TMDB API trending fetch error: {e}")
        return []

    # ── Live Search Engine ─────────────────────────────────────────────────────

    async def live_search(self, query: str) -> List[Dict[str, Any]]:
        """
        Dynamically queries live APIs (Cinemeta + TVMaze) on-the-fly for any searched query,
        ingests newly discovered titles into the active catalog, and returns matched results.
        """
        if not query or len(query.strip()) < 2:
            return []

        q = query.strip()
        results = []

        # 1. Search in current memory catalog
        q_lower = q.lower()
        for item in self.target_catalog:
            title = item.get("title", "").lower()
            overview = item.get("overview", "").lower()
            region = item.get("region", "").lower()
            lang = item.get("original_language", "").lower()
            cast_str = " ".join(item.get("cast", [])).lower()
            if q_lower in title or q_lower in overview or q_lower in region or q_lower == lang or q_lower in cast_str:
                results.append(item)

        # 2. Concurrently query live APIs for the search term
        try:
            tasks = [
                self.fetch_cinemeta_search(q, "movie"),
                self.fetch_cinemeta_search(q, "series")
            ]
            live_batches = await asyncio.gather(*tasks, return_exceptions=True)
            for batch in live_batches:
                if isinstance(batch, list):
                    for movie in batch:
                        self.ingest_movie(movie)
                        if movie not in results:
                            results.append(movie)
        except Exception as e:
            logger.warning(f"Live search dispatch error for query '{q}': {e}")

        return results

    # ── Full Live Synchronization Routine ──────────────────────────────────────

    async def run_full_sync(self) -> Dict[str, Any]:
        """Runs complete live API harvesting across all categories concurrently."""
        t0 = time.time()
        logger.info("Starting automated live movie API synchronization...")

        regional_queries = [
            ("Kantara", "movie"),
            ("KGF", "movie"),
            ("RRR", "movie"),
            ("Baahubali", "movie"),
            ("Pushpa", "movie"),
            ("Salaar", "movie"),
            ("Hanu-Man", "movie"),
            ("Kalki", "movie"),
            ("Devara", "movie"),
            ("Jawan", "movie"),
            ("Animal", "movie"),
            ("777 Charlie", "movie"),
            ("Garuda Gamana", "movie"),
            ("Sapta Sagaradaache", "movie"),
            ("Dune", "movie"),
            ("Oppenheimer", "movie"),
            ("Interstellar", "movie"),
            ("Inception", "movie"),
            ("Deadpool", "movie"),
            ("Gladiator", "movie"),
            ("Stranger Things", "series"),
            ("Squid Game", "series"),
            ("Wednesday", "series"),
            ("Dark", "series"),
            ("Money Heist", "series"),
            ("Black Mirror", "series"),
            ("Peaky Blinders", "series"),
            ("The Queen's Gambit", "series"),
            ("Breaking Bad", "series")
        ]

        tasks = [
            self.fetch_cinemeta_catalog("/catalog/movie/top.json", "movie"),
            self.fetch_cinemeta_catalog("/catalog/series/top.json", "series"),
            self.fetch_cinemeta_catalog("/catalog/movie/top/genre=Action.json", "movie"),
            self.fetch_cinemeta_catalog("/catalog/movie/top/genre=Science Fiction.json", "movie"),
            self.fetch_cinemeta_catalog("/catalog/movie/top/genre=Drama.json", "movie"),
            self.fetch_cinemeta_catalog("/catalog/movie/top/genre=Comedy.json", "movie"),
            self.fetch_tvmaze_shows(),
            self.fetch_tmdb_trending()
        ]

        # Add regional queries
        for q, mtype in regional_queries:
            tasks.append(self.fetch_cinemeta_search(q, mtype))

        results = await asyncio.gather(*tasks, return_exceptions=True)

        new_count = 0
        total_fetched = 0
        for batch in results:
            if isinstance(batch, list):
                total_fetched += len(batch)
                for item in batch:
                    if self.ingest_movie(item):
                        new_count += 1

        duration_sec = round(time.time() - t0, 2)
        self.last_sync_time = datetime.now(timezone.utc).isoformat()
        self.sync_count += 1

        # Persist full updated catalog to disk
        save_catalog_cache(self.target_catalog)

        logger.info(
            f"Automated Live API Sync completed: {total_fetched} items processed, "
            f"{new_count} new live titles added, {len(self.target_catalog)} total catalog titles in {duration_sec}s."
        )

        return {
            "status": "SUCCESS",
            "durationSeconds": duration_sec,
            "totalProcessed": total_fetched,
            "newTitlesAdded": new_count,
            "totalCatalogTitles": len(self.target_catalog),
            "lastSyncedAt": self.last_sync_time,
            "syncCount": self.sync_count
        }

    # ── Background Worker Loop ────────────────────────────────────────────────

    async def _background_worker_loop(self):
        """Infinite asynchronous polling loop running every 10 minutes."""
        logger.info(f"MovieStream Live Data Collector worker initialized (Interval: {self.sync_interval}s)")
        # Run initial sync immediately on startup
        try:
            await self.run_full_sync()
        except Exception as e:
            logger.error(f"Error during initial live API sync: {e}")

        while self.sync_running:
            try:
                await asyncio.sleep(self.sync_interval)
                if not self.sync_running:
                    break
                await self.run_full_sync()
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Error during periodic live API sync: {e}")
                await asyncio.sleep(30)

    def start_background_worker(self) -> asyncio.Task:
        """Starts the background polling worker."""
        if not self.sync_running:
            self.sync_running = True
            self.worker_task = asyncio.create_task(self._background_worker_loop())
        return self.worker_task

    def stop_background_worker(self):
        """Stops the background polling worker."""
        self.sync_running = False
        if self.worker_task:
            self.worker_task.cancel()

    def get_status(self) -> Dict[str, Any]:
        """Returns live collector telemetry and status."""
        return {
            "status": "LIVE_AUTO_COLLECTING" if self.sync_running else "IDLE",
            "mode": "AUTOMATIC_BACKGROUND_POLLING",
            "intervalSeconds": self.sync_interval,
            "syncCount": self.sync_count,
            "lastSyncedAt": self.last_sync_time,
            "totalLiveTitles": len(self.target_catalog),
            "liveAddedCount": self.live_added_count,
            "providers": self.active_providers,
            "autoIngestionActive": self.sync_running,
            "architecture": "Live Multi-API Stream Aggregator"
        }
