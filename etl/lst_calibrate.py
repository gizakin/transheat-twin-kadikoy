"""Local calibration of LST vs. vegetation cover for the literature-based heat simulation.

For every LST pixel inside the orthophoto extent (≈1.2 × 2.1 km of Kadıköy), vegetation cover is measured from the
orthophoto (ExG > 0.05, the same index used for the existing-state green layer), building cover from the base map,
and distance to the masked area (sea). A linear model LST ~ veg + building + min(dist, 300 m) gives the local
cross-sectional association of LST with vegetation cover; a bootstrap gives its 95 % interval.
Output: work/lst/calibration.json (read by export_static.py → the in-browser simulation).
"""
import json

import numpy as np
import rasterio
from ezdxf import recover
from rasterio import features
from rasterio.warp import Resampling, reproject
from scipy import ndimage
from shapely.geometry import Polygon
from shapely.validation import make_valid

from build_layers import BUILDING_LAYERS
from config import CAD, CRS_TM30, RASTERS, ROOT

OUT = ROOT / "work" / "lst"


def main():
    with rasterio.open(RASTERS / "lst_2025.tif") as r:
        lst = r.read(1).astype("float64"); tr, crs, H, W = r.transform, r.crs, r.height, r.width
    valid = np.isfinite(lst)
    px_m = abs(tr.a) * 111320 * np.cos(np.radians(41))
    dist = ndimage.distance_transform_edt(valid) * px_m  # distance to masked (sea) pixels

    # vegetation fraction per LST pixel: ortho ExG at 10× supersampling of the LST grid
    sub = 10
    trs = tr * rasterio.Affine.scale(1 / sub)
    rgb = np.zeros((3, H * sub, W * sub), "float32")
    cover = np.zeros((H * sub, W * sub), "float32")
    with rasterio.open(RASTERS / "ortho.tif") as o:
        for i in range(3):
            reproject(rasterio.band(o, i + 1), rgb[i], dst_transform=trs, dst_crs=crs, resampling=Resampling.average, dst_nodata=0)
    R, G, B = rgb
    inortho = (R + G + B) > 10
    exg = (2 * G - R - B) / (R + G + B + 1e-6)
    veg = ((exg > 0.05) & inortho).astype("float32")
    vegf = veg.reshape(H, sub, W, sub).mean(axis=(1, 3))
    orthof = inortho.reshape(H, sub, W, sub).mean(axis=(1, 3))

    doc, _ = recover.readfile(str(CAD / "halihazir.dxf"))
    polys = []
    for e in doc.modelspace():
        if e.dxf.layer in BUILDING_LAYERS and e.dxftype() in ("LWPOLYLINE", "POLYLINE"):
            pts = [(p[0], p[1]) for p in (e.get_points() if e.dxftype() == "LWPOLYLINE" else [v.dxf.location for v in e.vertices])]
            if len(pts) >= 3:
                g = make_valid(Polygon(pts)); b = g.bounds
                if g.area > 8 and 415500 < b[0] and b[2] < 420500 and 4537500 < b[1] and b[3] < 4542500:
                    polys.append(g)
    import geopandas as gpd
    bg = gpd.GeoSeries(polys, crs=CRS_TM30).to_crs(crs)
    bm = features.rasterize([(g, 1) for g in bg], out_shape=(H * sub, W * sub), transform=trs, fill=0).astype("float32")
    bldf = bm.reshape(H, sub, W, sub).mean(axis=(1, 3))

    use = valid & (orthof > 0.99) & (dist > 60)  # fully inside the orthophoto, away from the coastal mixed pixels
    y = lst[use]
    X = np.column_stack([vegf[use], bldf[use], np.minimum(dist[use], 300) / 100, np.ones(use.sum())])
    beta = np.linalg.lstsq(X, y, rcond=None)[0]
    r2 = 1 - ((y - X @ beta) ** 2).sum() / ((y - y.mean()) ** 2).sum()
    rng = np.random.default_rng(42)
    boots = []
    for _ in range(500):
        k = rng.integers(0, len(y), len(y))
        boots.append(np.linalg.lstsq(X[k], y[k], rcond=None)[0][0])
    lo, hi = np.percentile(boots, [2.5, 97.5])
    # simple contrast for reporting: mostly-vegetated vs mostly-paved/built pixels (same distance band)
    band = use & (dist > 120)
    green = band & (vegf >= 0.5)
    grey = band & (vegf <= 0.1)
    out = {"n_piksel": int(use.sum()), "r2": round(float(r2), 3),
           "beta_veg_C_per_full_cover": round(float(beta[0]), 2), "beta_veg_ci95": [round(float(lo), 2), round(float(hi), 2)],
           "beta_bina_C_per_full_cover": round(float(beta[1]), 2), "beta_kiyi_C_per_100m": round(float(beta[2]), 2),
           "kontrast_yesil50_vs_gri10": {"yesil_n": int(green.sum()), "yesil_ort": round(float(lst[green].mean()), 2) if green.any() else None,
                                         "gri_n": int(grey.sum()), "gri_ort": round(float(lst[grey].mean()), 2) if grey.any() else None},
           "yontem": "LST ~ bitki örtüsü payı (ortofoto ExG>0,05) + bina payı + min(kıyıya uzaklık, 300 m); ortofoto kapsamındaki, kıyıya >60 m kara pikselleri; "
                     "%95 aralık: 500 tekrarlı bootstrap."}
    (OUT / "calibration.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps(out, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
