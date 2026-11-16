"""Shared paths and constants for the ETL pipeline."""
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
# raw competition data (not redistributed — see VERI.md); set TRANSHEAT_RAW / TRANSHEAT_INSITU to local copies
RAW = Path(os.environ.get("TRANSHEAT_RAW", ROOT / "raw" / "2_Yarisma_Alanina_Iliskin_Bilgi_ve_Belgeler"))
INSITU_PDF = Path(os.environ.get("TRANSHEAT_INSITU", ROOT / "raw" / "Insitu_A0_Pafta_12_HpRev.pdf"))
WORK = ROOT / "work"
CAD = WORK / "cad"
PROCESSED = ROOT / "data" / "processed"
WEB = ROOT / "data" / "web"          # WGS84 GeoJSON served to the frontend
RASTERS = ROOT / "data" / "rasters"  # COGs served as XYZ tiles
LIBREDWG = ROOT / "tools" / "libredwg"

CRS_TM30 = "EPSG:5254"   # TUREF / TM30 — every source layer uses this (or an equivalent definition)
CRS_WEB = "EPSG:4326"

GPKG = PROCESSED / "kadikoy.gpkg"

for p in (WORK, CAD, PROCESSED, WEB, RASTERS):
    p.mkdir(parents=True, exist_ok=True)
