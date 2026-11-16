"""Raster serving (XYZ tiles via rio-tiler) and zonal statistics for heat maps."""
import io
from functools import lru_cache

import numpy as np
import rasterio
from rasterio import features
from rasterio.mask import mask as rio_mask
from rasterio.warp import transform_geom
from rio_tiler.colormap import cmap
from rio_tiler.errors import TileOutsideBounds
from rio_tiler.io import Reader
from shapely.geometry import mapping, shape
from shapely.ops import unary_union

from .data import CRS, RASTERS


def tile(path: str, z: int, x: int, y: int, rescale=None, colormap=None):
    try:
        with Reader(path) as src:
            img = src.tile(x, y, z, tilesize=256)
    except TileOutsideBounds:
        return None
    if img.count == 1:
        lo, hi = rescale if rescale else (float(img.data.min()), float(img.data.max()))
        img.rescale(in_range=((lo, hi),))
        return img.render(img_format="PNG", colormap=cmap.get(colormap or "rdylbu_r"))
    return img.render(img_format="PNG")


def zonal_mean(path: str, geom_tm):
    with rasterio.open(path) as r:
        g = transform_geom(CRS, r.crs, mapping(geom_tm))
        try:
            arr, _ = rio_mask(r, [g], crop=True, filled=False)
        except ValueError:
            return None
        a = arr[0].astype("float64")
        return round(float(a.mean()), 2) if a.count() else None


def stats_and_hotspots(path: str, geom_tm, pct=90):
    """Min/max/mean inside the study area and hotspot polygons (pixels ≥ given percentile)."""
    with rasterio.open(path) as r:
        g = transform_geom(CRS, r.crs, mapping(geom_tm))
        arr, tr = rio_mask(r, [g], crop=True, filled=False)
        a = arr[0].astype("float64")
        if not a.count():
            return {"bos": True}
        thr = float(np.percentile(a.compressed(), pct))
        hot = (a.filled(np.nan) >= thr)
        polys = [shape(s) for s, v in features.shapes(hot.astype("uint8"), mask=hot, transform=tr) if v == 1]
        hs = unary_union(polys) if polys else None
        hs_wgs = transform_geom(r.crs, "EPSG:4326", mapping(hs)) if hs is not None else None
        return {"min": float(a.min()), "max": float(a.max()), "ortalama": float(a.mean()), "std": float(a.std()),
                "esik_p": pct, "esik_deger": thr, "piksel": int(a.count()), "cozunurluk": list(r.res),
                "hotspots": hs_wgs, "crs": str(r.crs)}


def ortho_path():
    return str(RASTERS / "ortho.tif")
