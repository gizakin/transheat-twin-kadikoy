"""Export everything the in-browser engine needs into frontend/public/data/ (static, shareable build).

Engine data stays in TUREF/TM30 metres; display data is WGS84. Rasters share one analysis grid
(boundary bounds + margin, 0.5 m) so the browser can compute every KPI by counting cells.
"""
import json
import math

import geopandas as gpd
import numpy as np
import rasterio
import shapely
from PIL import Image
from pyproj import Transformer
from rasterio import features
from rasterio.warp import Resampling, calculate_default_transform, reproject
from shapely.geometry import mapping

from config import CRS_TM30, GPKG, PROCESSED, RASTERS, ROOT, WEB

OUT = ROOT / "frontend" / "public" / "data"
OUT.mkdir(parents=True, exist_ok=True)
RES = 0.5
MARGIN = 40.0
CLASS = {"yesil": 1, "gecirgen": 2, "sert": 3, "asfalt": 4, "bina": 5, "su": 6}
MATERIAL = {"asfalt": 1, "beton": 2}
TO_WGS = Transformer.from_crs(CRS_TM30, "EPSG:4326", always_xy=True)


def r2(v):
    return round(float(v), 2)


def ring(coords):
    return [[r2(x), r2(y)] for x, y, *_ in coords]


def poly_tm(g):
    """Polygon/MultiPolygon → list of polygons, each a list of rings (TM30, cm precision)."""
    out = []
    for p in getattr(g, "geoms", [g]):
        if p.geom_type != "Polygon" or p.is_empty:
            continue
        out.append([ring(p.exterior.coords)] + [ring(i.coords) for i in p.interiors])
    return out


def write_json(name, obj):
    (OUT / name).write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def write_geojson(name, gdf, simplify=None, keep=None):
    g = gdf.copy()
    if simplify:
        g["geometry"] = g.geometry.simplify(simplify, preserve_topology=True)
    g = g[~g.geometry.is_empty].explode(index_parts=False)  # also splits GeometryCollections from clipping
    g = g[g.geom_type.isin(["Point", "LineString", "Polygon", "MultiPoint", "MultiLineString", "MultiPolygon"])].to_crs("EPSG:4326")
    if keep is not None:
        g = g[[c for c in keep if c in g.columns] + ["geometry"]]
    for c in g.columns:
        if c != "geometry" and (g[c].dtype == object or str(g[c].dtype).startswith("datetime")):
            g[c] = g[c].astype(str)
    gj = json.loads(g.to_json(drop_id=True))
    def rnd(c):
        return [rnd(x) for x in c] if isinstance(c[0], list) else [round(c[0], 6), round(c[1], 6)]
    for f in gj["features"]:
        if f["geometry"]:
            f["geometry"]["coordinates"] = rnd(f["geometry"]["coordinates"])
        for k, v in list(f["properties"].items()):
            if isinstance(v, float):
                f["properties"][k] = round(v, 2)
    (OUT / name).write_text(json.dumps(gj, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def grid():
    b = gpd.read_file(GPKG, layer="boundary").geometry.iloc[0]
    x0, y0, x1, y1 = b.bounds
    x0, y0, x1, y1 = math.floor(x0 - MARGIN), math.floor(y0 - MARGIN), math.ceil(x1 + MARGIN), math.ceil(y1 + MARGIN)
    w, h = int((x1 - x0) / RES), int((y1 - y0) / RES)
    tr = rasterio.transform.from_origin(x0, y1, RES, RES)
    corners = [list(TO_WGS.transform(x, y)) for x, y in [(x0, y1), (x1, y1), (x1, y0), (x0, y0)]]  # TL, TR, BR, BL
    return {"x0": x0, "ytop": y1, "res": RES, "w": w, "h": h, "corners": corners}, tr


def class_png(lid, name, G, tr):
    s = gpd.read_file(GPKG, layer=lid)
    shape_ = (G["h"], G["w"])
    cls = np.zeros(shape_, "uint8")
    mat = np.zeros(shape_, "uint8")
    order = ["su", "sert", "asfalt", "gecirgen", "yesil", "bina"]  # later classes overwrite earlier ones
    for c in order:
        sub = s[s.sinif == c]
        if len(sub):
            m = features.rasterize([(g, 1) for g in sub.geometry], out_shape=shape_, transform=tr, fill=0).astype(bool)
            cls[m] = CLASS[c]
    if "malzeme" in s.columns:
        for mname, code in MATERIAL.items():
            sub = s[s.malzeme == mname]
            if len(sub):
                m = features.rasterize([(g, 1) for g in sub.geometry], out_shape=shape_, transform=tr, fill=0).astype(bool)
                mat[m & np.isin(cls, [3, 4])] = code
    land = gpd.read_file(GPKG, layer="land").geometry.iloc[0]
    lm = features.rasterize([(land, 1)], out_shape=shape_, transform=tr, fill=0).astype(bool)
    cls[~lm] = 0
    mat[~lm] = 0
    rgb = np.dstack([cls, mat, np.zeros_like(cls)])
    Image.fromarray(rgb, "RGB").save(OUT / name, optimize=True)
    return {int(k): int(v) for k, v in zip(*np.unique(cls, return_counts=True))}


def constraints_png(G, tr):
    shape_ = (G["h"], G["w"])
    her = gpd.read_file(GPKG, layer="heritage")
    sit = gpd.read_file(GPKG, layer="sit")
    own = gpd.read_file(GPKG, layer="ownership")
    priv = own[~own["maliktipi"].astype(str).str.contains("Kamu|Hazine|Belediye", case=False, na=False)]
    b = gpd.read_file(GPKG, layer="buildings")
    com = b[b["tur"] == "Ticari"].buffer(30)
    def ras(gs):
        gs = [g for g in gs if g is not None and not g.is_empty]
        return features.rasterize([(g, 1) for g in gs], out_shape=shape_, transform=tr, fill=0).astype("uint8") if gs else np.zeros(shape_, "uint8")
    r = ras(list(her.geometry) + list(sit.geometry)) * 255
    gch = ras(list(priv.geometry)) * 255
    bch = ras(list(com)) * 255
    Image.fromarray(np.dstack([r, gch, bch]).astype("uint8"), "RGB").save(OUT / "constraints.png", optimize=True)


def walk_png():
    """2 m walkable grid (land − sea − buildings, piers included), same construction as backend/app/core/network.py."""
    b = gpd.read_file(GPKG, layer="boundary").geometry.iloc[0].buffer(60)
    land = gpd.read_file(GPKG, layer="land").geometry.iloc[0]
    bld = gpd.read_file(GPKG, layer="buildings")
    res = 2.0
    x0, y0, x1, y1 = b.bounds
    w, h = int((x1 - x0) / res) + 1, int((y1 - y0) / res) + 1
    tr = rasterio.transform.from_origin(x0, y1, res, res)
    bnd = gpd.read_file(GPKG, layer="boundary").geometry.iloc[0]
    water = gpd.read_file(GPKG, layer="water").geometry.iloc[0]
    piers = gpd.read_file(GPKG, layer="piers").geometry.iloc[0].buffer(2)
    walk = features.rasterize([(land.union(bnd.buffer(150)), 1)], out_shape=(h, w), transform=tr, fill=0).astype(bool)
    walk &= ~features.rasterize([(water, 1)], out_shape=(h, w), transform=tr, fill=0).astype(bool)
    bm = features.rasterize([(g, 1) for g in bld.geometry], out_shape=(h, w), transform=tr, fill=0).astype(bool)
    walk &= ~bm
    walk |= features.rasterize([(piers, 1)], out_shape=(h, w), transform=tr, fill=0).astype(bool)
    Image.fromarray((walk * 255).astype("uint8"), "L").save(OUT / "walk.png", optimize=True)
    return {"x0": x0, "ytop": y1, "res": res, "w": w, "h": h}


def image_overlay(src_path, name, max_px=4096, quality=82, clip=None):
    """Warp a raster to EPSG:3857 (so MapLibre's 4-corner image source is exact) and save as JPEG."""
    with rasterio.open(src_path) as src:
        bounds = src.bounds if clip is None else clip
        dst_crs = "EPSG:3857"
        from rasterio.warp import transform_bounds
        wb = transform_bounds(src.crs, dst_crs, *bounds)
        sx = (wb[2] - wb[0]); sy = (wb[3] - wb[1])
        scale = max(sx, sy) / max_px
        w, h = int(sx / scale), int(sy / scale)
        tr = rasterio.transform.from_origin(wb[0], wb[3], scale, scale)
        arr = np.zeros((3, h, w), "uint8")
        for i in range(3):
            reproject(rasterio.band(src, i + 1), arr[i], dst_transform=tr, dst_crs=dst_crs, resampling=Resampling.average)
    Image.fromarray(np.moveaxis(arr, 0, -1)).save(OUT / name, quality=quality, optimize=True)
    t = Transformer.from_crs("EPSG:3857", "EPSG:4326", always_xy=True)
    corners = [list(t.transform(x, y)) for x, y in [(wb[0], wb[3]), (wb[2], wb[3]), (wb[2], wb[1]), (wb[0], wb[1])]]
    return {"file": name, "corners": corners, "px_m": scale}


def export_lst(meta):
    """Built-in heat layer (masked LST, °C) + the observational summary from lst_analysis.py."""
    import shutil
    src = RASTERS / "lst_2025.tif"
    summ = ROOT / "work" / "lst" / "lst_summary.json"
    if not src.exists() or not summ.exists():
        return
    # artifacts do not serve .tif: ship the grid as JSON (°C, 2 decimals, null = no data)
    with rasterio.open(src) as r:
        a = r.read(1)
        grid_ = {"w": r.width, "h": r.height, "crs": str(r.crs), "origin": [r.transform.c, r.transform.f],
                 "res": [r.transform.a, r.transform.e], "values": [None if not np.isfinite(v) else round(float(v), 2) for v in a.ravel()]}
    write_json("lst_2025.json", grid_)
    s = json.loads(summ.read_text(encoding="utf-8"))
    s.pop("kaynak", None)
    s.get("sicak_noktalar", {}).pop("konumlar_tm30", None)
    cal = ROOT / "work" / "lst" / "calibration.json"
    meta["lst"] = {"file": "lst_2025.json", "title": "Landsat LST 2025", "date": "2025 (dosya adından; sahne tarihleri dosyada yok)",
                   "source": "Google Earth Engine ile üretilmiş Landsat yüzey sıcaklığı (LST_2025.tif; 1. bant °C, 2. bant geçerlilik maskesi)",
                   "kalibrasyon": json.loads(cal.read_text(encoding="utf-8")) if cal.exists() else None,
                   "notes": "Piksel ≈23×30 m (TIRS doğal çözünürlüğü 100 m). Yüzey (deri) sıcaklığıdır; hava sıcaklığı veya termal konfor değildir.",
                   "yorum": s}


def main():
    G, tr = grid()
    counts = {"mevcut": class_png("surfaces_existing", "classes_mevcut.png", G, tr),
              "proje": class_png("surfaces_project", "classes_proje.png", G, tr)}
    constraints_png(G, tr)
    W = walk_png()

    bld = gpd.read_file(GPKG, layer="buildings")
    boundary = gpd.read_file(GPKG, layer="boundary").geometry.iloc[0]
    bld = bld[bld.intersects(boundary.buffer(300))]
    write_json("buildings.json", [{"p": poly_tm(g), "h": r2(h), "t": t, "k": None if np.isnan(k) else int(k), "s": s, "in": bool(i)}
                                  for g, h, t, k, s, i in zip(bld.geometry, bld.yukseklik_m, bld.tur, bld.kat_adedi, bld.yukseklik_kaynak, bld.alan_icinde)])
    trees = gpd.read_file(GPKG, layer="trees")
    write_json("trees.json", [{"x": r2(p.x), "y": r2(p.y), "h": r2(h), "d": r2(d), "no": None if np.isnan(n) else int(n), "tr": t, "la": la,
                               "sa": sa, "es": es, "bk": bk}
                              for p, h, d, n, t, la, sa, es, bk in zip(trees.geometry, trees.boy_m, trees.tac_cap_m, trees.no, trees.turkce.fillna(""),
                                                                      trees.latin.fillna(""), trees.saglik.fillna(""), trees.eslesme, trees.boy_kaynak)])
    inf = gpd.read_file(GPKG, layer="infrastructure")
    lines = []
    for k, g in zip(inf.kurum, inf.geometry):
        for l in getattr(g, "geoms", [g]):
            lines.append({"k": k, "c": ring(l.coords)})
    write_json("infra_tm.json", lines)
    tp = gpd.read_file(GPKG, layer="transfer_points")
    write_json("transfer_tm.json", [{"tur": r.tur, "ad": r.ad, "hat": r.hat, "x": r2(r.geometry.x), "y": r2(r.geometry.y),
                                     "yontem": r.yontem, "bel": int(r.konum_belirsizligi_m)} for r in tp.itertuples()])
    write_json("boundary_tm.json", poly_tm(boundary))

    # baseline transfer paths (same algorithm as the backend) so the page opens without a long computation
    import sys
    sys.path.insert(0, str(ROOT))
    from backend.app.core import kpi as K
    paths = K.transfer_paths()
    write_json("transfer_paths_tm.json", [{"from": p["from"], "to": p["to"], "pair": p["pair"], "dist_m": p["dist_m"],
                                           "c": ring(p["geometry"].coords)} for p in paths if p["geometry"] is not None])

    # display layers (WGS84)
    for lid, simp, keep in [("boundary", None, None), ("project_extent", 0.3, ["ad", "alan_m2"]),
                            ("surfaces_existing", 0.2, ["sinif", "ad", "malzeme", "alan_m2"]),
                            ("surfaces_project", 0.2, ["sinif", "ad", "malzeme", "alan_m2", "yontem", "cad_katman"]),
                            ("transfer_points", None, None), ("minibus_lines", 1.0, ["hat"]), ("ferry_lines", 1.0, ["isim_hat", "isim_kurum", "tur_hat"]),
                            ("bus_routes", 1.0, None), ("heritage", 0.2, ["eser_adi", "islev"]), ("sit", 0.5, ["sit_adi", "ilan_tarihi"]),
                            ("ownership", 0.2, ["tapumahadi", "ada", "parsel", "maliktipi"]), ("infrastructure", 0.2, ["kurum"])]:
        write_geojson(f"{lid}.geojson", gpd.read_file(GPKG, layer=lid), simp, keep)

    # İETT layers: stops carry their line list as an array so the map can filter by line
    import pyogrio
    if "iett_stops" in [l[0] for l in pyogrio.list_layers(GPKG)]:
        st = gpd.read_file(GPKG, layer="iett_stops")
        write_geojson("iett_stops.geojson", st)
        gj = json.loads((OUT / "iett_stops.geojson").read_text(encoding="utf-8"))
        for f in gj["features"]:
            f["properties"]["hat_list"] = [h.strip() for h in str(f["properties"].get("hatlar") or "").split(",") if h.strip()]
        (OUT / "iett_stops.geojson").write_text(json.dumps(gj, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        write_geojson("iett_routes.geojson", gpd.read_file(GPKG, layer="iett_routes"), 0.5,
                      ["HAT_KODU", "HAT_ADI", "GUZERGAH_A", "YON", "HAT_BASI", "HAT_SONU", "GARAJ_ADI", "ISLETME_AL", "RING_MI", "YOLCU_ACIK"])
        write_geojson("bus_corridors.geojson", gpd.read_file(GPKG, layer="bus_corridors"), 0.5)
        lines = gpd.read_file(GPKG, layer="iett_routes")[["HAT_KODU", "HAT_ADI"]].drop_duplicates("HAT_KODU")
        write_json("iett_lines.json", sorted([{"kod": k, "ad": a} for k, a in zip(lines.HAT_KODU, lines.HAT_ADI)], key=lambda d: (len(d["kod"]), d["kod"])))

    ortho = image_overlay(RASTERS / "ortho.tif", "ortho.jpg")
    with rasterio.open(RASTERS / "insitu_plan.tif") as s:
        ib = s.bounds
    insitu = image_overlay(RASTERS / "insitu_plan.tif", "insitu.jpg", max_px=4096, quality=80)

    meta = json.loads((PROCESSED / "layers.json").read_text(encoding="utf-8"))
    import yaml
    lit = yaml.safe_load((ROOT / "backend" / "app" / "literature" / "params.yaml").read_text(encoding="utf-8"))
    M = {"grid": G, "walk": W, "class_counts": counts, "classes": CLASS, "materials": MATERIAL,
         "layers": meta, "literature": lit, "ortho": ortho, "insitu": insitu}
    export_lst(M)
    write_json("meta.json", M)
    for f in sorted(OUT.iterdir()):
        print(f"{f.stat().st_size / 1e6:7.2f} MB  {f.name}")


if __name__ == "__main__":
    main()
