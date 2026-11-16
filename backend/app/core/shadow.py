"""Geometric shadow casting for buildings, trees and shade structures.

Method (geometric, no radiative model):
  * Sun position from pvlib (NREL SPA) for Kadıköy at the chosen local time.
  * A prism of height h casts its footprint translated by h / tan(elevation) away from the sun;
    the shadow is the union of the footprint, its translate and the quads swept by every edge.
  * Trees are spheres (crown diameter D, centre at H − D/2): shadow is an ellipse whose minor
    semi-axis is D/2 and major semi-axis (D/2)/sin(elevation), centred at the projected crown centre.
  * Shadows fall on a horizontal plane at each object's base; terrain slope is ignored.
"""
import math
from functools import lru_cache

import numpy as np
import pandas as pd
import pvlib
import shapely
from shapely import affinity
from shapely.geometry import MultiPolygon, Point, Polygon
from shapely.ops import unary_union

from .data import LAT, LON, TZ


@lru_cache(maxsize=512)
def sun_position(iso_local: str) -> dict:
    t = pd.DatetimeIndex([pd.Timestamp(iso_local).tz_localize(TZ)])
    sp = pvlib.solarposition.get_solarposition(t, LAT, LON)
    el = float(sp["apparent_elevation"].iloc[0])
    az = float(sp["azimuth"].iloc[0])
    return {"elevation": el, "azimuth": az, "time": iso_local}


def _offset(h: float, sun: dict):
    """Shadow translation vector (dx, dy) in metres for an object of height h (TM30: x=east, y=north)."""
    el = math.radians(max(sun["elevation"], 0.5))
    L = h / math.tan(el)
    az = math.radians(sun["azimuth"])  # clockwise from north, towards the sun
    return -L * math.sin(az), -L * math.cos(az)


def prism_shadow(poly: Polygon, h: float, sun: dict):
    if h <= 0 or sun["elevation"] <= 0:
        return Polygon()
    dx, dy = _offset(h, sun)
    moved = affinity.translate(poly, dx, dy)
    parts = [poly, moved]
    rings = [poly.exterior] if isinstance(poly, Polygon) else [g.exterior for g in poly.geoms]
    for ring in rings:
        c = list(ring.coords)
        for (x0, y0), (x1, y1) in zip(c[:-1], c[1:]):
            q = Polygon([(x0, y0), (x1, y1), (x1 + dx, y1 + dy), (x0 + dx, y0 + dy)])
            if q.is_valid and q.area > 0:
                parts.append(q)
    return shapely.union_all(parts)


def tree_shadow(x: float, y: float, height: float, crown_d: float, sun: dict):
    if sun["elevation"] <= 0:
        return Polygon()
    r = max(crown_d, 0.5) / 2
    zc = max(height - r, r)
    dx, dy = _offset(zc, sun)
    el = math.radians(max(sun["elevation"], 0.5))
    stretch = 1 / math.sin(el)
    circle = Point(0, 0).buffer(r, 16)
    ell = affinity.scale(circle, xfact=1, yfact=min(stretch, 20), origin=(0, 0))
    # rotate so the long axis follows the sun azimuth (rotation is counter-clockwise from +y)
    ell = affinity.rotate(ell, -sun["azimuth"], origin=(0, 0))
    return affinity.translate(ell, x + dx, y + dy)


def building_shadows(buildings, sun: dict):
    geoms = [prism_shadow(g, h, sun) for g, h in zip(buildings.geometry, buildings["yukseklik_m"])]
    return shapely.union_all([g for g in geoms if not g.is_empty]) if geoms else Polygon()


def trees_shadows(trees, sun: dict):
    geoms = [tree_shadow(p.x, p.y, h, d, sun) for p, h, d in zip(trees.geometry, trees["boy_m"], trees["tac_cap_m"])]
    return shapely.union_all([g for g in geoms if not g.is_empty]) if geoms else Polygon()


def structures_shadows(structs, sun: dict):
    """structs: iterable of (polygon, height_m, opacity 0..1). Returns (union, effective_area_weight list)."""
    out = []
    for poly, h, op in structs:
        g = prism_shadow(poly, h, sun) if h > 0 else poly
        # only the translated canopy footprint shades the ground for a raised roof, not the swept volume
        if h > 0 and sun["elevation"] > 0:
            dx, dy = _offset(h, sun)
            g = affinity.translate(poly, dx, dy)
        out.append((g, op))
    return out
