"""In-memory access to the processed layers (EPSG:5254) and their provenance metadata."""
import json
from functools import lru_cache
from pathlib import Path

import geopandas as gpd
import yaml

ROOT = Path(__file__).resolve().parents[3]
PROCESSED = ROOT / "data" / "processed"
WEB = ROOT / "data" / "web"
RASTERS = ROOT / "data" / "rasters"
UPLOADS = ROOT / "data" / "uploads"
GPKG = PROCESSED / "kadikoy.gpkg"
LIT = Path(__file__).resolve().parents[1] / "literature" / "params.yaml"
CRS = "EPSG:5254"

# Kadıköy Meydanı reference point for solar geometry
LAT, LON, TZ = 40.9905, 29.0230, "Europe/Istanbul"

UPLOADS.mkdir(parents=True, exist_ok=True)


@lru_cache(maxsize=None)
def layer(lid: str) -> gpd.GeoDataFrame:
    return gpd.read_file(GPKG, layer=lid)


@lru_cache(maxsize=1)
def layers_meta() -> dict:
    return json.loads((PROCESSED / "layers.json").read_text(encoding="utf-8"))


@lru_cache(maxsize=1)
def literature() -> dict:
    return yaml.safe_load(LIT.read_text(encoding="utf-8"))


def lit_param(pid: str) -> dict:
    lit = literature()
    for p in lit["parameters"]:
        if p["id"] == pid:
            out = dict(p)
            src = lit["sources"].get(p.get("kaynak") or "", {})
            out["kaynak_kunye"] = src.get("kunye")
            out["kaynak_doi"] = src.get("doi")
            out["calisma_alani"] = src.get("calisma_alani")
            return out
    return {"id": pid, "tanimlanmamis": True, "parametre": pid}


def assumption(aid: str) -> dict:
    for a in literature()["assumptions"]:
        if a["id"] == aid:
            return a
    raise KeyError(aid)


@lru_cache(maxsize=1)
def boundary():
    return layer("boundary").geometry.iloc[0]


@lru_cache(maxsize=1)
def land():
    return layer("land").geometry.iloc[0]
