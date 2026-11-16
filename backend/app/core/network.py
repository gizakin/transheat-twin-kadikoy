"""Walking distances on the walkable surface (land − sea − buildings, piers included), 2 m cost grid.

Derived approximation: carriageways are not separated in the source data, so distances are
an optimistic lower bound of real walking distance (pedestrians may not be able to cross everywhere).
"""
from functools import lru_cache

import numpy as np
import rasterio
from rasterio import features
from skimage.graph import MCP_Geometric

from .data import boundary, land, layer

RES = 2.0


@lru_cache(maxsize=1)
def grid():
    b = boundary().buffer(60)
    xmin, ymin, xmax, ymax = b.bounds
    w, h = int((xmax - xmin) / RES) + 1, int((ymax - ymin) / RES) + 1
    tr = rasterio.transform.from_origin(xmin, ymax, RES, RES)
    # walkable = (land ∪ 150 m context around the site) − sea − buildings, plus piers (they lie over water)
    walk = features.rasterize([(land().union(boundary().buffer(150)), 1)], out_shape=(h, w), transform=tr, fill=0).astype(bool)
    water = layer("water").geometry.iloc[0]
    walk &= ~features.rasterize([(water, 1)], out_shape=(h, w), transform=tr, fill=0).astype(bool)
    bld = layer("buildings")
    bmask = features.rasterize([(g, 1) for g in bld.geometry], out_shape=(h, w), transform=tr, fill=0).astype(bool)
    walk &= ~bmask
    piers = layer("piers").geometry.iloc[0].buffer(2)  # 2 m so a pier always connects to the quay
    walk |= features.rasterize([(piers, 1)], out_shape=(h, w), transform=tr, fill=0).astype(bool)
    cost = np.where(walk, 1.0, np.inf)
    return cost, tr


def _rc(tr, x, y, cost):
    r, c = rasterio.transform.rowcol(tr, x, y)
    r = int(np.clip(r, 0, cost.shape[0] - 1)); c = int(np.clip(c, 0, cost.shape[1] - 1))
    if np.isinf(cost[r, c]):  # snap to nearest walkable cell
        rr, cc = np.nonzero(np.isfinite(cost))
        k = np.argmin((rr - r) ** 2 + (cc - c) ** 2)
        r, c = int(rr[k]), int(cc[k])
    return r, c


def distances_from(x, y, targets):
    """Shortest walking distance (m) and path (list of xy) from (x, y) to each target (x, y)."""
    cost, tr = grid()
    m = MCP_Geometric(cost, fully_connected=True)
    start = _rc(tr, x, y, cost)
    cum, _ = m.find_costs([start])
    out = []
    for tx, ty in targets:
        end = _rc(tr, tx, ty, cost)
        d = cum[end] * RES
        if not np.isfinite(d):
            out.append((None, None)); continue
        path = m.traceback(end)
        xy = [rasterio.transform.xy(tr, r, c) for r, c in path]
        out.append((float(d), xy))
    return out
