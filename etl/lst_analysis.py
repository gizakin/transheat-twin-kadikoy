"""Relate a user-supplied Landsat LST raster to the study-area surface classes.

For every LST pixel (≈30 m) the share of each surface class (0.5 m class raster), tree crowns and sea is computed,
then LST is summarised by dominant cover and with a simple linear model. This is an observational, cross-sectional
association — not a causal effect — and LST is a surface (skin) temperature, not air temperature.
Output: work/lst/lst_summary.json + figures, and data/rasters/lst_2025.tif (masked, °C) for the app.
"""
import json
import sys

import geopandas as gpd
import matplotlib
import numpy as np
import rasterio
from rasterio import features
from rasterio.warp import Resampling, reproject
from scipy import ndimage

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

from config import CRS_TM30, GPKG, RASTERS, ROOT  # noqa: E402

SRC = sys.argv[1] if len(sys.argv) > 1 else str(ROOT / "raw" / "LST_2025.tif")  # GeoTIFF exported by frontend/public/gee_landsat_lst.js
OUT = ROOT / "work" / "lst"
OUT.mkdir(parents=True, exist_ok=True)


def main():
    with rasterio.open(SRC) as r:
        lst = r.read(1).astype("float64")
        mask = r.read(2) > 0 if r.count > 1 else lst != 0
        tr, crs, H, W = r.transform, r.crs, r.height, r.width
        prof = r.profile
    lst[~mask] = np.nan
    # clean masked copy for the app (single band, NaN nodata)
    prof.update(count=1, dtype="float32", nodata=np.nan, compress="deflate")
    with rasterio.open(RASTERS / "lst_2025.tif", "w", **prof) as dst:
        dst.write(lst.astype("float32"), 1)

    # project the study-area layers onto the LST grid (fractions per pixel)
    surf = gpd.read_file(GPKG, layer="surfaces_existing").to_crs(crs)
    proj = gpd.read_file(GPKG, layer="surfaces_project").to_crs(crs)
    bnd = gpd.read_file(GPKG, layer="boundary").to_crs(crs)
    crowns = gpd.read_file(GPKG, layer="tree_crowns").to_crs(crs)
    land = gpd.read_file(GPKG, layer="land").to_crs(crs)

    def frac(geoms):
        """Fraction of each LST pixel covered by geometries (supersampled 10×10)."""
        if len(geoms) == 0:
            return np.zeros((H, W))
        hi = features.rasterize([(g, 1) for g in geoms], out_shape=(H * 10, W * 10),
                                transform=tr * rasterio.Affine.scale(0.1), fill=0, all_touched=False).astype("float32")
        return hi.reshape(H, 10, W, 10).mean(axis=(1, 3))

    F = {c: frac(surf[surf.sinif == c].geometry) for c in ["yesil", "sert", "bina", "su"]}
    FP = {c: frac(proj[proj.sinif == c].geometry) for c in ["yesil", "gecirgen", "sert", "asfalt", "bina"]}
    F["agac"] = frac(crowns.geometry)
    inb = frac(bnd.geometry)
    onland = frac(land.geometry)
    # sea proximity across the whole raster: masked pixels are mostly sea → distance to masked area (m)
    px_m = abs(tr.a) * 111320 * np.cos(np.radians(41))
    dist_mask = ndimage.distance_transform_edt(mask) * px_m

    v = ~np.isnan(lst)
    site = v & (inb > 0.5)
    land_site = site & (onland > 0.6)
    def stats(a):
        a = a[~np.isnan(a)]
        return {"n": int(a.size), "ortalama": round(float(a.mean()), 2), "medyan": round(float(np.median(a)), 2), "min": round(float(a.min()), 2),
                "max": round(float(a.max()), 2), "p10": round(float(np.percentile(a, 10)), 2), "p90": round(float(np.percentile(a, 90)), 2),
                "std": round(float(a.std()), 2)}
    out = {"kaynak": SRC, "piksel_m": round(px_m, 1), "maskeli_oran": round(float((~mask).mean()), 3),
           "tum_raster": stats(lst[v]), "calisma_alani": stats(lst[site]), "calisma_alani_kara": stats(lst[land_site])}
    # context: urban land pixels outside the site but within 1.5 km
    from scipy.ndimage import distance_transform_edt
    dsite = distance_transform_edt(~(inb > 0.5)) * px_m
    ctx = v & (inb == 0) & (dsite < 1500) & (dist_mask > 60)
    out["cevre_1500m_kiyi_disi"] = stats(lst[ctx])

    # dominant-cover groups inside the site (land pixels)
    groups = {
        "yeşil ≥ %50": land_site & (F["yesil"] >= 0.5),
        "ağaç tacı ≥ %30": land_site & (F["agac"] >= 0.3),
        "sert zemin ≥ %70": land_site & (F["sert"] >= 0.7),
        "bina ≥ %40": land_site & (F["bina"] >= 0.4),
        "kıyıya ≤ 60 m": land_site & (dist_mask <= 60),
        "kıyıya > 120 m": land_site & (dist_mask > 120),
    }
    out["gruplar"] = {k: stats(lst[g]) if g.sum() >= 3 else {"n": int(g.sum())} for k, g in groups.items()}

    # linear association inside the site (land pixels): LST ~ green + tree + building + distance-to-coast
    X = np.column_stack([F["yesil"][land_site], F["agac"][land_site], F["bina"][land_site], np.minimum(dist_mask[land_site], 300) / 100, np.ones(land_site.sum())])
    y = lst[land_site]
    coef, *_ = np.linalg.lstsq(X, y, rcond=None)
    pred = X @ coef
    r2 = 1 - ((y - pred) ** 2).sum() / ((y - y.mean()) ** 2).sum()
    out["regresyon"] = {"n": int(y.size), "r2": round(float(r2), 3),
                        "yesil_orani_+10puan_C": round(float(coef[0] / 10), 3), "agac_tac_+10puan_C": round(float(coef[1] / 10), 3),
                        "bina_orani_+10puan_C": round(float(coef[2] / 10), 3), "kiyidan_+100m_C": round(float(coef[3]), 3),
                        "not": "Kesitsel ilişki; nedensellik değildir. Piksel 30 m (TIRS doğal çözünürlüğü 100 m), karışık pikseller içerir."}
    # project vs existing cover inside the site (what changes where it is hot)
    hot_thr = np.nanpercentile(lst[land_site], 90)
    hot = land_site & (lst >= hot_thr)
    out["sicak_noktalar"] = {"esik_p90_C": round(float(hot_thr), 2), "piksel": int(hot.sum()),
                             "mevcut_yesil_ort": round(float(F["yesil"][hot].mean()), 3), "mevcut_sert_ort": round(float(F["sert"][hot].mean()), 3),
                             "proje_yesil_ort": round(float(FP["yesil"][hot].mean()), 3), "proje_sert_asfalt_ort": round(float((FP["sert"] + FP["asfalt"])[hot].mean()), 3),
                             "kiyi_mesafe_medyan_m": round(float(np.median(dist_mask[hot])), 1)}
    # where are hot pixels: centroids in TM30 for description
    from rasterio.transform import xy
    from pyproj import Transformer
    t = Transformer.from_crs(crs, CRS_TM30, always_xy=True)
    rr, cc = np.nonzero(hot)
    out["sicak_noktalar"]["konumlar_tm30"] = [list(map(lambda v: round(v, 1), t.transform(*xy(tr, r_, c_)))) for r_, c_ in zip(rr, cc)]
    cold_thr = np.nanpercentile(lst[land_site], 10)
    cold = land_site & (lst <= cold_thr)
    out["serin_noktalar"] = {"esik_p10_C": round(float(cold_thr), 2), "piksel": int(cold.sum()),
                             "mevcut_yesil_ort": round(float(F["yesil"][cold].mean()), 3), "agac_ort": round(float(F["agac"][cold].mean()), 3),
                             "kiyi_mesafe_medyan_m": round(float(np.median(dist_mask[cold])), 1)}
    (OUT / "lst_summary.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")

    # figures
    fig, ax = plt.subplots(1, 3, figsize=(16, 4.6))
    ax[0].scatter(F["yesil"][land_site] * 100, y, s=9, alpha=0.6, color="#2a78d6")
    ax[0].set_xlabel("Yeşil alan payı (%)"); ax[0].set_ylabel("LST (°C)"); ax[0].set_title("Yeşil pay – LST")
    ax[1].scatter(np.minimum(dist_mask[land_site], 300), y, s=9, alpha=0.6, color="#eb6834")
    ax[1].set_xlabel("Maskeli alana (kıyıya) uzaklık (m, 300'de kesik)"); ax[1].set_title("Kıyıya uzaklık – LST")
    labels = [k for k, g in groups.items() if g.sum() >= 3]
    ax[2].boxplot([lst[groups[k]] for k in labels], vert=True)
    ax[2].set_xticks(range(1, len(labels) + 1)); ax[2].set_xticklabels(labels, rotation=25, ha="right", fontsize=8); ax[2].set_title("Baskın örtüye göre LST")
    for a in ax: a.spines[["top", "right"]].set_visible(False)
    plt.tight_layout(); plt.savefig(OUT / "lst_iliski.png", dpi=110)
    print(json.dumps({k: v for k, v in out.items() if k != "sicak_noktalar"} | {"sicak_noktalar": {k: v for k, v in out["sicak_noktalar"].items() if k != "konumlar_tm30"}}, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
