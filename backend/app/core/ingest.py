"""Upload ingestion: detect type, check CRS, register metadata. Never guesses a missing CRS silently."""
import json
import shutil
import zipfile
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
import rasterio
from rasterio.warp import transform_bounds

from .data import CRS, UPLOADS, boundary

VECTOR = {".geojson", ".json", ".gpkg", ".kml", ".kmz", ".zip", ".shp"}
TABLE = {".csv", ".xlsx", ".xls"}
RASTER = {".tif", ".tiff"}
DOC = {".png", ".jpg", ".jpeg", ".pdf"}


def _site_overlap(bounds_wgs):
    b = gpd.GeoSeries([boundary()], crs=CRS).to_crs("EPSG:4326").total_bounds
    ix = max(0, min(b[2], bounds_wgs[2]) - max(b[0], bounds_wgs[0])) * max(0, min(b[3], bounds_wgs[3]) - max(b[1], bounds_wgs[1]))
    return ix > 0


def ingest(tmp: Path, name: str, assumed_crs: str | None = None):
    ext = tmp.suffix.lower()
    meta = {"dosya": name, "uzanti": ext, "uyarilar": []}
    if ext in RASTER:
        with rasterio.open(tmp) as r:
            meta.update(tur="raster", bant=r.count, boyut=[r.width, r.height], dtype=r.dtypes[0],
                        crs=str(r.crs) if r.crs else None, cozunurluk=list(r.res), nodata=r.nodata,
                        tags=r.tags())
            if not r.crs:
                meta["uyarilar"].append("Raster CRS içermiyor; haritaya eklenmedi. Koordinat sistemi tanımlı GeoTIFF yükleyin.")
                return "document", meta
            wb = transform_bounds(r.crs, "EPSG:4326", *r.bounds)
            meta["sinirlar_wgs84"] = list(wb)
            meta["alanla_cakisma"] = _site_overlap(wb)
            if r.count == 1:
                a = r.read(1, masked=True).astype("float64")
                meta["istatistik"] = {"min": float(a.min()), "max": float(a.max()), "ortalama": float(a.mean()),
                                      "p2": float(np.percentile(a.compressed(), 2)), "p98": float(np.percentile(a.compressed(), 98))}
        return "raster", meta
    if ext in DOC:
        meta["tur"] = "belge"
        meta["uyarilar"].append("Görsel/PDF belge olarak kaydedildi. Haritada göstermek için köşe noktalarıyla elle konumlandırma gerekir.")
        return "document", meta
    if ext in TABLE:
        df = pd.read_csv(tmp) if ext == ".csv" else pd.read_excel(tmp)
        cols = {c.lower(): c for c in df.columns}
        xy = next(((cols[a], cols[b]) for a, b in (("lon", "lat"), ("longitude", "latitude"), ("boylam", "enlem"), ("x", "y")) if a in cols and b in cols), None)
        meta.update(tur="tablo", satir=len(df), sutunlar=list(df.columns))
        if not xy:
            meta["uyarilar"].append("Koordinat sütunu bulunamadı (lon/lat, x/y). Tablo olarak kaydedildi.")
            return "table", meta
        crs = "EPSG:4326" if xy[0].lower() in ("lon", "longitude", "boylam") else (assumed_crs or None)
        if crs is None:
            meta["uyarilar"].append("x/y sütunları için CRS belirtilmedi; haritaya eklenmedi.")
            return "table", meta
        g = gpd.GeoDataFrame(df, geometry=gpd.points_from_xy(df[xy[0]], df[xy[1]]), crs=crs)
    else:
        if ext == ".kmz":
            d = tmp.with_suffix("")
            zipfile.ZipFile(tmp).extractall(d)
            tmp = next(d.rglob("*.kml"))
        if ext == ".zip":
            d = tmp.with_suffix("")
            zipfile.ZipFile(tmp).extractall(d)
            cand = list(d.rglob("*.shp")) + list(d.rglob("*.gpkg")) + list(d.rglob("*.geojson"))
            if not cand:
                raise ValueError("ZIP içinde SHP/GPKG/GeoJSON bulunamadı")
            tmp = cand[0]
            if tmp.suffix == ".shp" and not tmp.with_suffix(".prj").exists():
                meta["uyarilar"].append(".prj dosyası yok; CRS bilinmiyor.")
        g = gpd.read_file(tmp)
        meta["tur"] = "vektör"
        if g.crs is None:
            if assumed_crs:
                g = g.set_crs(assumed_crs)
                meta["uyarilar"].append(f"CRS dosyada yok; kullanıcının belirttiği {assumed_crs} atandı.")
            else:
                meta["uyarilar"].append("CRS tanımsız; haritaya eklenmedi. Yüklerken CRS belirtin.")
                return "vector_nocrs", meta
    meta.update(crs=str(g.crs), obje=len(g), geometri=g.geom_type.value_counts().to_dict(),
                sutunlar=[c for c in g.columns if c != "geometry"])
    w = g.to_crs("EPSG:4326")
    meta["sinirlar_wgs84"] = list(map(float, w.total_bounds))
    meta["alanla_cakisma"] = _site_overlap(w.total_bounds)
    if not meta["alanla_cakisma"]:
        meta["uyarilar"].append("Veri çalışma alanıyla çakışmıyor; CRS hatalı olabilir.")
    for c in w.columns:
        if c != "geometry" and (w[c].dtype == object or str(w[c].dtype).startswith("datetime")):
            w[c] = w[c].astype(str)
    return "vector", {**meta, "_geojson": w.to_json(drop_id=True)}
