"""SQLite persistence for scenarios and uploaded datasets (swap for PostGIS by replacing this module)."""
import json
import sqlite3
import uuid
from datetime import datetime

from .data import ROOT

DB = ROOT / "data" / "transheat.sqlite"


def _conn():
    c = sqlite3.connect(DB)
    c.row_factory = sqlite3.Row
    c.execute("""CREATE TABLE IF NOT EXISTS scenarios (
        id TEXT PRIMARY KEY, name TEXT, created_at TEXT, definition TEXT, results TEXT)""")
    c.execute("""CREATE TABLE IF NOT EXISTS uploads (
        id TEXT PRIMARY KEY, name TEXT, kind TEXT, created_at TEXT, path TEXT, metadata TEXT)""")
    return c


def save_scenario(definition: dict, results: dict) -> dict:
    sid = definition.get("id") or uuid.uuid4().hex[:10]
    definition = {**definition, "id": sid, "created_at": definition.get("created_at") or datetime.now().isoformat(timespec="seconds")}
    with _conn() as c:
        c.execute("REPLACE INTO scenarios VALUES (?,?,?,?,?)",
                  (sid, definition.get("scenario_name", sid), definition["created_at"], json.dumps(definition, ensure_ascii=False),
                   json.dumps(results, ensure_ascii=False)))
    return definition


def list_scenarios():
    with _conn() as c:
        return [{"id": r["id"], "name": r["name"], "created_at": r["created_at"], "definition": json.loads(r["definition"])}
                for r in c.execute("SELECT id,name,created_at,definition FROM scenarios ORDER BY created_at")]


def get_scenario(sid):
    with _conn() as c:
        r = c.execute("SELECT * FROM scenarios WHERE id=?", (sid,)).fetchone()
    if not r:
        return None
    return {"id": r["id"], "name": r["name"], "created_at": r["created_at"],
            "definition": json.loads(r["definition"]), "results": json.loads(r["results"])}


def delete_scenario(sid):
    with _conn() as c:
        c.execute("DELETE FROM scenarios WHERE id=?", (sid,))


def add_upload(name, kind, path, metadata):
    uid = uuid.uuid4().hex[:10]
    with _conn() as c:
        c.execute("INSERT INTO uploads VALUES (?,?,?,?,?,?)",
                  (uid, name, kind, datetime.now().isoformat(timespec="seconds"), str(path), json.dumps(metadata, ensure_ascii=False)))
    return uid


def list_uploads():
    with _conn() as c:
        return [{"id": r["id"], "name": r["name"], "kind": r["kind"], "created_at": r["created_at"], "path": r["path"],
                 "metadata": json.loads(r["metadata"])} for r in c.execute("SELECT * FROM uploads ORDER BY created_at")]


def get_upload(uid):
    return next((u for u in list_uploads() if u["id"] == uid), None)


def delete_upload(uid):
    with _conn() as c:
        c.execute("DELETE FROM uploads WHERE id=?", (uid,))
