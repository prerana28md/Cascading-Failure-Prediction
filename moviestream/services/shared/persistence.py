"""
MovieStream Persistent Storage Engine
Provides zero-dependency persistent storage on disk for:
1. SQLite Database: `moviestream/data/moviestream.db`
   - User Profiles & Preferences
   - Watch History & Playback Progress (resume points)
   - Watchlist (My List)
2. JSON Disk Cache: `moviestream/data/catalog_cache.json`
   - Real-time live API catalog persistence across restarts
"""

import os
import json
import sqlite3
import logging
from pathlib import Path
from typing import Dict, List, Any, Optional

logger = logging.getLogger("moviestream-storage")

DATA_DIR = Path(__file__).resolve().parent.parent.parent / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)

DB_PATH = DATA_DIR / "moviestream.db"
CATALOG_CACHE_PATH = DATA_DIR / "catalog_cache.json"


def get_db_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    """Initializes SQLite schema for users, history, and watchlist."""
    with get_db_connection() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                username TEXT NOT NULL,
                display_name TEXT NOT NULL,
                avatar_url TEXT,
                plan TEXT,
                data_json TEXT NOT NULL,
                updated_at REAL NOT NULL
            )
        """)

        conn.execute("""
            CREATE TABLE IF NOT EXISTS watch_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL,
                movie_id INTEGER NOT NULL,
                title TEXT NOT NULL,
                progress_seconds INTEGER NOT NULL,
                duration_seconds INTEGER NOT NULL,
                percentage INTEGER NOT NULL,
                completed INTEGER NOT NULL,
                poster_path TEXT,
                backdrop_path TEXT,
                last_watched REAL NOT NULL,
                UNIQUE(user_id, movie_id)
            )
        """)

        conn.execute("""
            CREATE TABLE IF NOT EXISTS watchlist (
                user_id TEXT NOT NULL,
                movie_id INTEGER NOT NULL,
                movie_data_json TEXT NOT NULL,
                added_at REAL NOT NULL,
                PRIMARY KEY(user_id, movie_id)
            )
        """)
        conn.commit()


# ── User Profiles ─────────────────────────────────────────────────────────────

def db_save_profile(user_id: str, profile: Dict[str, Any]):
    init_db()
    with get_db_connection() as conn:
        conn.execute("""
            INSERT INTO users (id, username, display_name, avatar_url, plan, data_json, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
            ON CONFLICT(id) DO UPDATE SET
                username=excluded.username,
                display_name=excluded.display_name,
                avatar_url=excluded.avatar_url,
                plan=excluded.plan,
                data_json=excluded.data_json,
                updated_at=datetime('now')
        """, (
            user_id.lower(),
            profile.get("username", user_id),
            profile.get("displayName", user_id.capitalize()),
            profile.get("avatarUrl", ""),
            profile.get("plan", "Standard"),
            json.dumps(profile)
        ))
        conn.commit()


def db_get_profiles() -> Dict[str, Dict[str, Any]]:
    init_db()
    profiles = {}
    with get_db_connection() as conn:
        cursor = conn.execute("SELECT id, data_json FROM users")
        for row in cursor.fetchall():
            try:
                profiles[row["id"]] = json.loads(row["data_json"])
            except Exception:
                pass
    return profiles


# ── Watch History ─────────────────────────────────────────────────────────────

def db_save_history(user_id: str, entry: Dict[str, Any]):
    init_db()
    with get_db_connection() as conn:
        conn.execute("""
            INSERT INTO watch_history (
                user_id, movie_id, title, progress_seconds, duration_seconds,
                percentage, completed, poster_path, backdrop_path, last_watched
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(user_id, movie_id) DO UPDATE SET
                title=excluded.title,
                progress_seconds=excluded.progress_seconds,
                duration_seconds=excluded.duration_seconds,
                percentage=excluded.percentage,
                completed=excluded.completed,
                poster_path=excluded.poster_path,
                backdrop_path=excluded.backdrop_path,
                last_watched=excluded.last_watched
        """, (
            user_id.lower(),
            int(entry["id"]),
            entry.get("title", "Untitled"),
            int(entry.get("progressSeconds", 0)),
            int(entry.get("durationSeconds", 7200)),
            int(entry.get("percentage", 0)),
            1 if entry.get("completed") else 0,
            entry.get("poster_path", ""),
            entry.get("backdrop_path", ""),
            float(entry.get("lastWatched", 0.0))
        ))
        conn.commit()


def db_get_history(user_id: str) -> List[Dict[str, Any]]:
    init_db()
    items = []
    with get_db_connection() as conn:
        cursor = conn.execute("""
            SELECT movie_id, title, progress_seconds, duration_seconds, percentage,
                   completed, poster_path, backdrop_path, last_watched
            FROM watch_history
            WHERE user_id = ?
            ORDER BY last_watched DESC
        """, (user_id.lower(),))
        for row in cursor.fetchall():
            items.append({
                "id": row["movie_id"],
                "movieId": row["movie_id"],
                "title": row["title"],
                "progressSeconds": row["progress_seconds"],
                "durationSeconds": row["duration_seconds"],
                "percentage": row["percentage"],
                "completed": bool(row["completed"]),
                "poster_path": row["poster_path"],
                "backdrop_path": row["backdrop_path"],
                "lastWatched": row["last_watched"]
            })
    return items


# ── Watchlist ─────────────────────────────────────────────────────────────────

def db_add_watchlist(user_id: str, movie: Dict[str, Any]):
    init_db()
    with get_db_connection() as conn:
        conn.execute("""
            INSERT OR REPLACE INTO watchlist (user_id, movie_id, movie_data_json, added_at)
            VALUES (?, ?, ?, ?)
        """, (
            user_id.lower(),
            int(movie["id"]),
            json.dumps(movie),
            float(movie.get("added_at", 0.0) or 0.0)
        ))
        conn.commit()


def db_remove_watchlist(user_id: str, movie_id: int):
    init_db()
    with get_db_connection() as conn:
        conn.execute("DELETE FROM watchlist WHERE user_id = ? AND movie_id = ?", (user_id.lower(), int(movie_id)))
        conn.commit()


def db_get_watchlist(user_id: str) -> List[Dict[str, Any]]:
    init_db()
    items = []
    with get_db_connection() as conn:
        cursor = conn.execute("""
            SELECT movie_data_json FROM watchlist
            WHERE user_id = ?
            ORDER BY added_at DESC
        """, (user_id.lower(),))
        for row in cursor.fetchall():
            try:
                items.append(json.loads(row["movie_data_json"]))
            except Exception:
                pass
    return items


# ── Disk Catalog Cache (Live Ingested API Data) ───────────────────────────────

def save_catalog_cache(catalog_list: List[Dict[str, Any]]):
    """Saves the active catalog to disk so live-collected items persist across restarts."""
    try:
        with open(CATALOG_CACHE_PATH, "w", encoding="utf-8") as f:
            json.dump(catalog_list, f, indent=2)
        logger.info(f"Persisted {len(catalog_list)} catalog items to {CATALOG_CACHE_PATH}")
    except Exception as e:
        logger.warning(f"Failed to persist catalog cache to disk: {e}")


def load_catalog_cache() -> List[Dict[str, Any]]:
    """Loads previously persisted live catalog from disk cache if present."""
    if CATALOG_CACHE_PATH.exists():
        try:
            with open(CATALOG_CACHE_PATH, "r", encoding="utf-8") as f:
                data = json.load(f)
                if isinstance(data, list) and len(data) > 0:
                    try:
                        from .trailer_resolver import resolve_trailer_key
                        for item in data:
                            title = item.get("title", "")
                            t_key = item.get("trailer_key")
                            if not t_key or (t_key == "Way9Dexny3w" and "dune: part two" not in title.lower() and "dune 2" not in title.lower()):
                                item["trailer_key"] = resolve_trailer_key(title)
                    except Exception as ex:
                        logger.warning(f"Error sanitizing cached trailer keys: {ex}")
                    logger.info(f"Loaded {len(data)} cached catalog titles from {CATALOG_CACHE_PATH}")
                    return data
        except Exception as e:
            logger.warning(f"Failed to read catalog cache: {e}")
    return []
