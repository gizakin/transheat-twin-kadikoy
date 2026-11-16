"""Build every analysis layer into data/processed/kadikoy.gpkg (EPSG:5254) and data/web/*.geojson (WGS84).

Run after ortho.py. Each layer is written with provenance columns so the app can answer
"Bu sonuç nasıl hesaplandı?" without re-deriving anything.
"""
import json
import math
import re
import warnings
from datetime import date

import ezdxf
import geopandas as gpd
import numpy as np
import shapely
import pandas as pd
import rasterio
from ezdxf import recover
from rasterio import features
from rasterio.warp import reproject, Resampling, transform_bounds
from scipy.interpolate import griddata
from shapely.geometry import Point, Polygon, box, mapping, shape
from shapely.ops import polygonize, unary_union
from shapely.validation import make_valid

import cadgeom
import dwgjson
from config import CAD, CRS_TM30, CRS_WEB, GPKG, PROCESSED, RASTERS, RAW, WEB, WORK

warnings.filterwarnings("ignore")
META = {}  # layer id -> metadata, written to data/processed/layers.json

DEFAULT_STOREY_H = 3.0  # m — used only when no measured roof/ground elevation is available (assumption)


def save(gdf: gpd.GeoDataFrame, lid: str, meta: dict, web=True):
    gdf = gdf[~gdf.geometry.is_empty & gdf.geometry.notna()].copy()
    gdf.to_file(GPKG, layer=lid, driver="GPKG")
    if web:
        w = gdf.to_crs(CRS_WEB)
        for c in w.columns:
            if c != "geometry" and (w[c].dtype == object or str(w[c].dtype).startswith("datetime")):
                w[c] = w[c].astype(str)
        (WEB / f"{lid}.geojson").write_text(w.to_json(drop_id=True, to_wgs84=False), encoding="utf-8")
    META[lid] = {**meta, "count": int(len(gdf)), "crs_source": CRS_TM30, "built": date.today().isoformat()}
    mp = PROCESSED / "layers.json"
    old = json.loads(mp.read_text(encoding="utf-8")) if mp.exists() else {}
    mp.write_text(json.dumps({**old, **META}, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{lid:22s} {len(gdf):6d}", flush=True)


def robust(arr, other, op, grid=0.01):
    """Per-geometry overlay against `other`, localised with a spatial index over the parts of `other`.

    Only the parts of `other` that touch each geometry take part in the operation (a whole-site union
    with thousands of vertices made each call very slow). Falls back to a snapped precision grid when
    GEOS hits a robustness error.
    """
    f = getattr(shapely, op)
    parts = np.array(shapely.get_parts(other))
    tree = shapely.STRtree(parts)
    out = []
    for g in np.asarray(arr):
        if g is None or g.is_empty:
            out.append(g); continue
        idx = tree.query(g, predicate="intersects")
        if len(idx) == 0:
            out.append(g if op == "difference" else shapely.Polygon())
            continue
        local = shapely.union_all(parts[idx])
        try:
            out.append(f(g, local))
        except shapely.errors.GEOSException:
            out.append(f(make_valid(g), make_valid(local), grid_size=grid))
    return out


def text_of(e):
    return (e.dxf.text if e.dxftype() == "TEXT" else e.plain_text()).strip()


def ins_of(e):
    p = e.dxf.insert
    return (p[0], p[1])


# --------------------------------------------------------------------------------------------- boundary
def build_boundary():
    doc, _ = recover.readfile(str(CAD / "agac.dxf"))
    for e in doc.modelspace():
        if e.dxf.layer == "proje_siniri_son_hali" and e.dxftype() == "LWPOLYLINE":
            poly = make_valid(Polygon([p[:2] for p in e.get_points()]))
    g = gpd.GeoDataFrame({"name": ["Yarışma / proje alanı sınırı"], "area_m2": [round(poly.area)]}, geometry=[poly], crs=CRS_TM30)
    save(g, "boundary", {"title": "Çalışma alanı sınırı", "group": "Temel", "method": "data",
                         "source": "2_12_1_Agac_Rolovesi.dwg › proje_siniri_son_hali", "date": "bilinmiyor"})
    return poly


# --------------------------------------------------------------------------------------------- trees
def build_trees(boundary):
    doc, _ = recover.readfile(str(CAD / "agac.dxf"))
    circles, labels = [], []
    for e in doc.modelspace():
        if e.dxf.layer != "_P_BITKI_TEPE_TACI":
            continue
        if e.dxftype() == "CIRCLE":
            c = e.dxf.center
            circles.append((c[0], c[1], e.dxf.radius))
        elif e.dxftype() in ("MTEXT", "TEXT"):
            t = re.sub(r"[^0-9]", "", text_of(e))
            if t:
                labels.append((int(t), *ins_of(e)))
    lab = pd.DataFrame(labels, columns=["no", "x", "y"])
    cir = pd.DataFrame(circles, columns=["x", "y", "r_dwg"])
    # each label is attached to the nearest circle centre; one circle may only take one label
    from scipy.spatial import cKDTree
    tree = cKDTree(cir[["x", "y"]].values)
    d, idx = tree.query(lab[["x", "y"]].values, k=1)
    lab["cid"], lab["dist"] = idx, d
    lab = lab.sort_values("dist").drop_duplicates("cid").drop_duplicates("no")
    lab = lab[lab["dist"] < 8]
    cir = cir.reset_index().rename(columns={"index": "cid"}).merge(lab[["cid", "no", "dist"]], on="cid", how="left")

    xl = pd.read_excel(RAW / "2_12_Agac_Rolovesi" / "2_12_2_Agac_Rolovesi_Raporu.xlsx").dropna(subset=["NO"])
    xl.columns = ["no", "latin", "turkce", "govde_cevresi_cm", "boy_m", "tac_cap_m", "saglik", "aciklama", "_a", "_b"][: len(xl.columns)]
    xl["no"] = xl["no"].astype(int)
    for c in ("boy_m", "tac_cap_m"):
        xl[c] = pd.to_numeric(xl[c], errors="coerce")
    xl["veri_notu"] = ""
    bad = xl["tac_cap_m"] > 30
    xl.loc[bad, "veri_notu"] = "Taç çapı aykırı (>30 m), DWG yarıçapı kullanıldı"
    xl.loc[bad, "tac_cap_m"] = np.nan
    t = cir.merge(xl[["no", "latin", "turkce", "govde_cevresi_cm", "boy_m", "tac_cap_m", "saglik", "veri_notu"]], on="no", how="left")
    t["tac_cap_m"] = t["tac_cap_m"].fillna(t["r_dwg"] * 2)
    t["boy_kaynak"] = np.where(t["boy_m"].notna(), "rölöve", "varsayım")
    # missing heights: species median, else overall median — flagged as assumption
    sp_med = t.groupby("latin")["boy_m"].median()
    t["boy_m"] = t["boy_m"].fillna(t["latin"].map(sp_med)).fillna(t["boy_m"].median())
    t["eslesme"] = np.where(t["no"].notna(), "DWG+Excel", "yalnız DWG")
    t["geometry"] = [Point(x, y) for x, y in zip(t.x, t.y)]
    pts = gpd.GeoDataFrame(t.drop(columns=["x", "y"]), geometry="geometry", crs=CRS_TM30)
    pts["mevcut"] = True
    pts["kaynak"] = "rölöve"
    save(pts, "trees", {"title": "Ağaçlar (rölöve)", "group": "Mevcut durum", "method": "data",
                        "source": "2_12_1_Agac_Rolovesi.dwg (konum, taç) + 2_12_2_Agac_Rolovesi_Raporu.xlsx (tür, boy, taç çapı, sağlık)",
                        "date": "2020-06 (ağaç fotoğrafları EXIF)",
                        "notes": f"{int((pts.eslesme=='DWG+Excel').sum())} ağaç Excel ile eşleşti, {int((pts.eslesme!='DWG+Excel').sum())} yalnız DWG; "
                                 f"{int((pts.boy_kaynak=='varsayım').sum())} ağacın boyu tür medyanından atandı."})
    crowns = pts.copy()
    crowns["geometry"] = [p.buffer(max(d, 0.5) / 2, 16) for p, d in zip(pts.geometry, pts.tac_cap_m)]
    save(crowns, "tree_crowns", {"title": "Ağaç taç izdüşümleri", "group": "Mevcut durum", "method": "geometric",
                                 "source": "trees katmanı, taç çapından daire", "date": "2020-06"})
    unmatched = sorted(set(xl["no"]) - set(pts["no"].dropna().astype(int)))
    (WORK / "trees_unmatched.json").write_text(json.dumps(unmatched), encoding="utf-8")
    return pts, crowns


# --------------------------------------------------------------------------------------------- terrain + buildings
BUILDING_LAYERS = {"B_MESKEN": "Konut", "B_TICARI": "Ticari", "B_TİCARİ": "Ticari", "B_RESMI": "Resmi", "B_RESMİ": "Resmi",
                   "B_OKUL": "Okul", "B_DINITESIS": "Dini tesis", "B_Dini tesis": "Dini tesis", "B_HARABE": "Harabe",
                   "B_INS_HALINDE": "İnşaat halinde", "B_IMALAT": "İmalat", "B_TRAFO": "Trafo", "B_TARIHI": "Tarihi",
                   "B_VAKIF_DERNEK": "Vakıf/dernek", "B_Vakıf_Dernek": "Vakıf/dernek", "B_FABRIKA": "Fabrika",
                   "B_KAPALI_OTOPARK": "Kapalı otopark", "B_SADIRVAN": "Şadırvan", "B_ARA_KAT": "Ara kat"}


def build_terrain_and_buildings(boundary):
    doc, _ = recover.readfile(str(CAD / "halihazir.dxf"))
    msp = doc.modelspace()
    polys, kat, roof, ground = [], [], [], []
    for e in msp:
        l, t = e.dxf.layer, e.dxftype()
        if l in BUILDING_LAYERS and t in ("LWPOLYLINE", "POLYLINE"):
            pts = [(p[0], p[1]) for p in (e.get_points() if t == "LWPOLYLINE" else [v.dxf.location for v in e.vertices])]
            if len(pts) >= 3:
                g = make_valid(Polygon(pts))
                if g.area > 2:
                    polys.append({"tur": BUILDING_LAYERS[l], "layer": l, "geometry": g})
        elif t in ("TEXT", "MTEXT"):
            s = text_of(e)
            if l == "Y_KAT_ADEDI" and s.isdigit():
                kat.append((int(s), *ins_of(e)))
            elif l == "Y_BINA_KOTU":
                try: roof.append((float(s), *ins_of(e)))
                except ValueError: pass
            elif l == "NKOT":
                try: ground.append((float(s), *ins_of(e)))
                except ValueError: pass
    b = gpd.GeoDataFrame(polys, crs=CRS_TM30).explode(index_parts=False)
    b = b[b.geometry.geom_type == "Polygon"].reset_index(drop=True)
    # drop exact duplicates
    b["wkb"] = b.geometry.apply(lambda g: g.wkb)
    b = b.drop_duplicates("wkb").drop(columns="wkb")

    def attach(vals, name):
        if not vals:
            b[name] = np.nan; return
        p = gpd.GeoDataFrame({name: [v[0] for v in vals]}, geometry=[Point(v[1], v[2]) for v in vals], crs=CRS_TM30)
        j = gpd.sjoin(p, b[["geometry"]], predicate="within", how="inner")
        agg = j.groupby("index_right")[name].max()
        b[name] = b.index.map(agg)

    attach(kat, "kat_adedi")
    attach(roof, "cati_kotu")

    # ground surface from spot heights (NKOT), TM30 grid 2 m — used for building base and as DEM layer
    g = np.array([(x, y, z) for z, x, y in ground if -5 < z < 120])
    xmin, ymin, xmax, ymax = boundary.buffer(400).bounds
    res = 2.0
    gx = np.arange(xmin, xmax, res); gy = np.arange(ymax, ymin, -res)
    GX, GY = np.meshgrid(gx, gy)
    dem = griddata(g[:, :2], g[:, 2], (GX, GY), method="linear")
    dem_nn = griddata(g[:, :2], g[:, 2], (GX, GY), method="nearest")
    dem = np.where(np.isnan(dem), dem_nn, dem).astype("float32")
    tr = rasterio.transform.from_origin(xmin, ymax, res, res)
    with rasterio.open(RASTERS / "dem_spot.tif", "w", driver="GTiff", width=dem.shape[1], height=dem.shape[0], count=1,
                       dtype="float32", crs=CRS_TM30, transform=tr, compress="deflate") as dst:
        dst.write(dem, 1)
    cen = b.geometry.centroid
    rows, cols = rasterio.transform.rowcol(tr, cen.x.values, cen.y.values)
    rows = np.clip(rows, 0, dem.shape[0] - 1); cols = np.clip(cols, 0, dem.shape[1] - 1)
    b["zemin_kotu"] = dem[rows, cols].round(2)

    h_meas = b["cati_kotu"] - b["zemin_kotu"]
    ok = h_meas.between(2.0, 80.0)
    b["yukseklik_m"] = np.where(ok, h_meas, b["kat_adedi"] * DEFAULT_STOREY_H)
    b["yukseklik_kaynak"] = np.where(ok, "ölçüm (çatı kotu − zemin kotu)",
                                     np.where(b["kat_adedi"].notna(), f"kat adedi × {DEFAULT_STOREY_H} m (varsayım)", "bilinmiyor"))
    b.loc[b["yukseklik_m"].isna(), "yukseklik_m"] = DEFAULT_STOREY_H  # unlabelled small structures: 1 storey (assumption)
    b.loc[b["yukseklik_kaynak"] == "bilinmiyor", "yukseklik_kaynak"] = f"etiket yok → 1 kat ({DEFAULT_STOREY_H} m, varsayım)"
    b["yukseklik_m"] = b["yukseklik_m"].astype(float).round(1)
    b["alan_m2"] = b.area.round(1)
    area = boundary.buffer(250)
    b = b[b.intersects(area)].reset_index(drop=True)
    b["alan_icinde"] = b.intersects(boundary)
    save(b, "buildings", {"title": "Binalar (halihazır)", "group": "Mevcut durum", "method": "data",
                          "source": "2_3_1_Halihazir_2B.dwg › B_* katmanları; yükseklik: Y_BINA_KOTU − NKOT enterpolasyonu, yoksa Y_KAT_ADEDI × 3 m",
                          "date": "bilinmiyor",
                          "notes": f"{int((b.yukseklik_kaynak.str.startswith('ölçüm')).sum())} bina ölçümden, "
                                   f"{int(b.yukseklik_kaynak.str.startswith('kat').sum())} kat adedinden, "
                                   f"{int(b.yukseklik_kaynak.str.startswith('etiket').sum())} varsayımla. Gölge yarıçapı 250 m tampon."})
    META["dem_spot"] = {"title": "Zemin kotu (nokta enterpolasyonu)", "group": "Mevcut durum", "method": "geometric",
                        "source": "Halihazır NKOT kot noktaları, doğrusal enterpolasyon 2 m", "date": "bilinmiyor", "kind": "raster"}
    return b


# --------------------------------------------------------------------------------------------- land / water
def build_land(boundary):
    d = dwgjson.load(CAD / "plan.json", CAD / "plan.pkl")
    E = d["entities"]
    bb = tuple(np.array(boundary.buffer(600).bounds))
    sea = []
    for e in E:
        if e["block"] == "01_PLN" and e["type"] == "HATCH" and e["layer"].endswith("on deniz"):
            sea += cadgeom.hatch_polygons(e, bb)
    sea = unary_union(sea) if sea else Polygon()
    # coastline layer as a second source for water outside the project drawing
    k = gpd.read_file(RAW / "2_7_Kiyi_Kenar_Cizgisi" / "SHP" / "kiyi_kenar_cizgisi.shp").set_crs(CRS_TM30, allow_override=True)
    k = k[k.intersects(boundary.buffer(300))]
    land = make_valid(boundary.difference(sea))
    return land, sea, E, k


# --------------------------------------------------------------------------------------------- existing surfaces
SURVEY_CUT_LAYERS = {
    "00_HH": ("HH_YOL_SOSE", "HH_YOLKALDIRIMKENARI", "HH_SINIR_KADIKOY", "HH_SINIR_IST_DUVARI", "HH_SINIRDUVARTEKTARA",
              "HH_HID_KIYI_RIHTIM", "HH_YOL_IZGARA"),
    "00_PKT": ("YOL_ASFALT", "YOL_KALDIRIM", "SINIR_BETON_ZEMIN", "SINIR_CICEKLIK", "SINIR_KARO_ZEMIN", "YOL_PARKE", "YOL_TRETUAR", "REFUJ"),
}


def split_by_survey_lines(geom, E, min_area=2.0):
    """Cut the residual hard-surface area along surveyed edges (road edges, kerbs, paving borders) so it can be
    selected as street/square-sized pieces instead of one site-wide polygon. Pieces keep the same class."""
    lines = []
    for e in E:
        keys = SURVEY_CUT_LAYERS.get(e["block"])
        if keys and e["type"] in ("LINE", "LWPOLYLINE", "POLYLINE_2D", "POLYLINE_3D") and any(e["layer"].endswith(k) for k in keys):
            l = cadgeom.to_line(e)
            if l is not None and l.length > 0.2:
                lines.append(l)
    cut = unary_union(lines + [geom.boundary])
    pieces = [p for p in polygonize(cut) if p.area >= min_area]
    tree = shapely.STRtree(pieces)
    out = []
    for i in tree.query(geom, predicate="intersects"):
        p = pieces[i].intersection(geom)
        if not p.is_empty and p.area >= min_area:
            out.append(p)
    rest = geom.difference(unary_union(out)) if out else geom
    out += [p for p in getattr(rest, "geoms", [rest]) if p.area >= min_area]
    # very large pieces (squares, roads merged into one face) are cut further: parcel boundaries, then a 50 m grid
    parcels = gpd.read_file(RAW / "2_5_Mulkiyet_Haritasi/SHP (1)/MULKIYET.shp").set_crs(CRS_TM30, allow_override=True)
    plines = unary_union(parcels.boundary.values)
    final = []
    for p in out:
        if p.area <= 5000:
            final.append(p); continue
        sub = [q.intersection(p) for q in polygonize(unary_union([p.boundary, plines.intersection(p)]))]
        sub = [q for q in sub if not q.is_empty and q.area >= min_area] or [p]
        for q in sub:
            if q.area <= 5000:
                final.append(q); continue
            x0, y0, x1, y1 = q.bounds
            for gx in np.arange(math.floor(x0 / 50) * 50, x1, 50):
                for gy in np.arange(math.floor(y0 / 50) * 50, y1, 50):
                    c = q.intersection(box(gx, gy, gx + 50, gy + 50))
                    if not c.is_empty and c.area >= min_area:
                        final.append(c)
    print(f"  hard surface split into {len(final)} pieces", flush=True)
    return final
def build_existing_surfaces(boundary, land, buildings, E):
    # vegetation: ExG on the 0.25 m ortho, resampled into TM30 at 0.5 m inside the land mask
    res = 0.5
    xmin, ymin, xmax, ymax = boundary.bounds
    w, h = int((xmax - xmin) / res), int((ymax - ymin) / res)
    tr = rasterio.transform.from_origin(xmin, ymax, res, res)
    rgb = np.zeros((3, h, w), dtype="float32")
    with rasterio.open(RASTERS / "ortho.tif") as src:
        for i in range(3):
            reproject(rasterio.band(src, i + 1), rgb[i], dst_transform=tr, dst_crs=CRS_TM30, resampling=Resampling.average)
    R, G, B = rgb
    exg = (2 * G - R - B) / (R + G + B + 1e-6)
    landmask = features.rasterize([(land, 1)], out_shape=(h, w), transform=tr, fill=0).astype(bool)
    bmask = features.rasterize([(g, 1) for g in buildings.geometry], out_shape=(h, w), transform=tr, fill=0).astype(bool)
    veg = (exg > 0.05) & landmask & ~bmask & (R + G + B > 60)
    # light morphological cleanup: drop isolated pixels
    from scipy import ndimage
    veg = ndimage.binary_opening(veg, iterations=1)
    shapes = [shape(s) for s, v in features.shapes(veg.astype("uint8"), mask=veg, transform=tr) if v == 1]
    vegp = unary_union([s for s in shapes if s.area >= 2.0]).simplify(0.4)
    # CAD park/garden polygons (closed) add planted areas the RGB index misses
    park = [cadgeom.to_polygon(e) for e in E if e["block"] == "00_HH" and e["layer"].endswith("HH_O_PARK_BAHCE") and cadgeom.is_closed(e)]
    park = unary_union([p for p in park if p is not None])
    water_cad = [cadgeom.to_polygon(e) for e in E if e["block"] == "00_HH" and e["layer"].endswith("HH_HID_HAVUZ") and cadgeom.is_closed(e)]
    pools = unary_union([p for p in water_cad if p is not None]).intersection(land)

    bld = unary_union(buildings[buildings.alan_icinde].geometry).intersection(land)
    green = unary_union([vegp, park]).intersection(land).difference(bld).difference(pools)
    hard = land.difference(unary_union([bld, green, pools]))
    hard_parts = split_by_survey_lines(hard, E)
    rows = [("bina", "Bina / yapı", bld, "data", "Halihazır bina poligonları"),
            ("yesil", "Yeşil alan (bitkili)", green, "data", "Ortofoto ExG > 0.05 (0.5 m) ∪ halihazır park-bahçe poligonları"),
            ("su", "Su yüzeyi / havuz", pools, "data", "Halihazır HID_HAVUZ")]
    rows += [("sert", "Sert zemin (geçirimsiz varsayıldı)", p, "geometric", "Kara alanı − (bina ∪ yeşil ∪ su), ölçüm çizgileriyle parçalanmış")
             for p in hard_parts]
    g = gpd.GeoDataFrame([{"sinif": a, "ad": b_, "yontem": m, "kaynak": s} for a, b_, geom, m, s in rows],
                         geometry=[r[2] for r in rows], crs=CRS_TM30).explode(index_parts=False)
    g = g[g.area > 0.5]
    g["alan_m2"] = g.area.round(1)
    g["durum"] = "mevcut"
    save(g, "surfaces_existing", {"title": "Mevcut yüzey sınıfları", "group": "Mevcut durum", "method": "data",
                                  "source": "Ortofoto (RGB bitki indeksi), halihazır bina/park/havuz",
                                  "date": "ortofoto tarihi bilinmiyor",
                                  "notes": "Sert zemin sınıfı kalan alan olarak türetilmiştir; asfalt/taş ayrımı mevcut veride güvenilir biçimde yapılamamıştır."})
    return g, green


# --------------------------------------------------------------------------------------------- project surfaces (İBB Meydan Düzenleme Projesi)
PLN_CLASS = {
    "on d cim": ("yesil", "Çim", "çim", 0.0),
    "on bi ağaç kabuğu": ("gecirgen", "Ağaç kabuğu (malç)", "ağaç kabuğu", 0.0),
    "on granit plaktaş 40x80x8cm": ("sert", "Granit plak taş", "granit", 0.0),
    "on açık gri bazalt plak taş (Uşak)": ("sert", "Açık gri bazalt", "bazalt açık", 0.0),
    "on koyu gri bazalt plak taş (Diyarbakır)": ("sert", "Koyu gri bazalt", "bazalt koyu", 0.0),
    "on bazalt plak taş": ("sert", "Bazalt plak taş", "bazalt", 0.0),
    "on bazalt derz": ("sert", "Bazalt derz", "bazalt", 0.0),
    "on beton döşeme": ("sert", "Beton döşeme", "beton", 0.0),
    "on s yaya gecidi": ("sert", "Yaya geçidi", "yaya geçidi boyası/asfalt", 0.0),
    "on paslanmaz çelik fuga ızgara": ("sert", "Paslanmaz çelik ızgara", "metal", 0.0),
    "on asfalt hatch": ("asfalt", "Asfalt", "asfalt", 0.0),
    "on bisiklet": ("asfalt", "Bisiklet yolu (malzeme belirtilmemiş)", "belirtilmemiş", 0.0),
    "on s yapı": ("bina", "Yapı", "yapı", 0.0),
    "on bina-s": ("bina", "Yapı", "yapı", 0.0),
}
PATTERN_LAYERS = {"on granit plaktaş 40x80x8cm": ("sert", "Granit döşeme (desen çizgisinden)", "granit"),
                  "on doseme pattern-2": ("sert", "Döşeme (desen 2, malzeme belirtilmemiş)", "belirtilmemiş")}
EDGE_LAYERS = ("on bordur", "on alt bordur", "on yapısal", "on şerit", "on duvar", "on bisiklet", "on hh sınır duvar")


def build_project_surfaces(boundary, land, existing, E):
    bb = tuple(np.array(boundary.buffer(600).bounds))
    hatch = []
    for e in E:
        if e["block"] != "01_PLN" or e["type"] != "HATCH":
            continue
        lyr = e["layer"].split("$0$")[-1]
        if lyr not in PLN_CLASS:
            continue
        for g in cadgeom.hatch_polygons(e, bb):
            c = PLN_CLASS[lyr]
            hatch.append({"sinif": c[0], "ad": c[1], "malzeme": c[2], "cad_katman": lyr, "yontem": "CAD tarama", "geometry": g})
    H = gpd.GeoDataFrame(hatch, crs=CRS_TM30)
    H["geometry"] = H.geometry.intersection(land)
    H = H[~H.is_empty]
    # higher-priority classes overwrite lower ones where hatches overlap
    prio = {"bina": 5, "yesil": 4, "gecirgen": 4, "asfalt": 3, "sert": 2}
    H["p"] = H.sinif.map(prio)
    # dissolve per (class, material) first, then subtract higher-priority classes once per group
    D = H.dissolve(by=["sinif", "ad", "malzeme", "cad_katman", "yontem"], as_index=False, aggfunc={"p": "first"})
    D = D.sort_values("p", ascending=False)
    taken = Polygon(); parts = []
    for p, grp in D.groupby("p", sort=False):
        lvl = []
        for _, r in grp.iterrows():
            g = make_valid(r.geometry).difference(taken)
            if not g.is_empty:
                parts.append({**r.drop(labels=["geometry", "p"]).to_dict(), "geometry": g})
                lvl.append(r.geometry)
        taken = unary_union([taken, *lvl])
    H = gpd.GeoDataFrame(parts, crs=CRS_TM30).explode(index_parts=False)
    hatched = shapely.set_precision(make_valid(taken), 0.01)
    land = shapely.set_precision(make_valid(land), 0.01)
    print("  hatches ok", flush=True)

    # faces enclosed by design edge lines; a face is "designed" when it carries paving-pattern lines
    edges = [cadgeom.to_line(e) for e in E if e["block"] == "01_PLN" and e["type"] in ("LWPOLYLINE", "LINE", "POLYLINE_2D", "POLYLINE_3D")
             and e["layer"].split("$0$")[-1] in EDGE_LAYERS]
    edges = [l for l in edges if l is not None and l.length < 2000]
    faces = [f for f in polygonize(unary_union(edges)) if 4 < f.area < 60000]
    F = gpd.GeoDataFrame(geometry=faces, crs=CRS_TM30)
    F["geometry"] = robust(F.geometry.values, land, "intersection")
    F["geometry"] = robust(F.geometry.values, hatched, "difference")
    print("  faces ok", len(F), flush=True)
    F = F[F.area > 4]
    pat = []
    for e in E:
        if e["block"] == "01_PLN" and e["type"] in ("LWPOLYLINE", "LINE"):
            lyr = e["layer"].split("$0$")[-1]
            if lyr in PATTERN_LAYERS:
                l = cadgeom.to_line(e)
                if l is not None and l.length < 500:
                    pat.append({"pl": lyr, "geometry": l})
    P = gpd.GeoDataFrame(pat, crs=CRS_TM30)
    j = gpd.sjoin(P, F[["geometry"]], predicate="intersects", how="inner")
    j["len"] = j.geometry.length
    dens = j.groupby(["index_right", "pl"])["len"].sum().unstack(fill_value=0)
    F["granit_m"] = F.index.map(dens.get("on granit plaktaş 40x80x8cm", pd.Series(dtype=float))).fillna(0)
    F["desen2_m"] = F.index.map(dens.get("on doseme pattern-2", pd.Series(dtype=float))).fillna(0)
    F["yogunluk"] = (F.granit_m + F.desen2_m) / F.area
    F = F[F.yogunluk > 0.3]  # ≥0.3 m of pattern line per m² → face is drawn as paving
    F["sinif"] = "sert"
    F["ad"] = np.where(F.granit_m >= F.desen2_m, PATTERN_LAYERS["on granit plaktaş 40x80x8cm"][1], PATTERN_LAYERS["on doseme pattern-2"][1])
    F["malzeme"] = np.where(F.granit_m >= F.desen2_m, "granit", "belirtilmemiş")
    F["cad_katman"] = np.where(F.granit_m >= F.desen2_m, "on granit plaktaş 40x80x8cm (desen)", "on doseme pattern-2 (desen)")
    F["yontem"] = "CAD desen çizgisi yoğunluğu"
    F = F.drop(columns=["granit_m", "desen2_m", "yogunluk"])
    F = gpd.GeoDataFrame(F, geometry="geometry", crs=CRS_TM30).explode(index_parts=False)
    design = unary_union([hatched, unary_union(F.geometry)])

    # outside the drawn design the existing classification is carried over
    carry = existing.copy()
    design = shapely.set_precision(make_valid(design), 0.01)
    carry["geometry"] = robust(carry.geometry.values, design, "difference")
    carry = carry[~carry.is_empty & (carry.area > 0.5)]
    carry["malzeme"] = carry.sinif.map({"sert": "mevcut sert zemin", "yesil": "mevcut bitkili", "bina": "mevcut bina", "su": "su"})
    carry["cad_katman"] = ""
    carry["yontem"] = "mevcut durumdan aktarıldı"
    proj = pd.concat([H, F, carry[["sinif", "ad", "malzeme", "cad_katman", "yontem", "geometry"]]], ignore_index=True)
    proj = gpd.GeoDataFrame(proj, geometry="geometry", crs=CRS_TM30).explode(index_parts=False)
    proj = proj[proj.area > 0.5]
    proj["alan_m2"] = proj.area.round(1)
    proj["durum"] = "proje"
    save(proj, "surfaces_project", {"title": "Proje yüzey sınıfları (İBB Meydan Düzenleme Projesi)", "group": "Proje durumu",
                                    "method": "data",
                                    "source": "2_13_2 …/01 - PLAN.dwg › 01_PLN (dwgread JSON): malzeme taramaları + döşeme desen çizgileri",
                                    "date": "bilinmiyor",
                                    "notes": "Taramalı alanlar doğrudan; taramasız döşeme alanları desen çizgisi yoğunluğundan (≥0,3 m/m²) çıkarıldı. "
                                             "Çizimin kapsamadığı alanlarda mevcut durum sınıfı korunmuştur."})
    ext = gpd.GeoDataFrame({"ad": ["Proje çiziminin kapsadığı alan"], "alan_m2": [round(design.area)]}, geometry=[design], crs=CRS_TM30)
    save(ext, "project_extent", {"title": "Proje çizimi kapsamı", "group": "Proje durumu", "method": "geometric",
                                 "source": "01_PLN taramaları ∪ desenli yüzler", "date": "bilinmiyor"})
    return proj, design


# --------------------------------------------------------------------------------------------- reference & transport
def read_shp(rel, crs_override=True):
    g = gpd.read_file(RAW / rel)
    if g.crs is None or crs_override:
        try:
            if g.crs is None or g.crs.to_epsg() not in (5254, 4326):
                g = g.set_crs(CRS_TM30, allow_override=True)  # ITRF96 TM30 definitions are numerically TM30
        except Exception:
            g = g.set_crs(CRS_TM30, allow_override=True)
    return g.to_crs(CRS_TM30)


def build_reference(boundary):
    ctx = boundary.buffer(1500)
    t = read_shp("2_10_Tescilli_Yapılar_ve_Sit_Alanları/2_10_1_TESCİLLİ YAPILAR/SHP/TESCILLI_ESER.shp")
    t = t[["ESERADI", "ALTFONKSIY", "TESCIL_TUR", "ADA", "PARSEL", "geometry"]].rename(columns={"ESERADI": "eser_adi", "ALTFONKSIY": "islev"})
    save(t, "heritage", {"title": "Tescilli yapılar", "group": "Kısıtlar", "method": "data", "source": "TESCILLI_ESER.shp", "date": "bilinmiyor"})
    s = read_shp("2_10_Tescilli_Yapılar_ve_Sit_Alanları/2_10_2_SİT ALANLARI/SHP (1)/sit_alanları.shp")
    s = s[["SIT_ADI", "ILAN_TARIH", "geometry"]].rename(columns={"SIT_ADI": "sit_adi", "ILAN_TARIH": "ilan_tarihi"})
    save(s, "sit", {"title": "Sit alanları", "group": "Kısıtlar", "method": "data", "source": "sit_alanları.shp", "date": "1991–2006 ilan"})
    m = read_shp("2_5_Mulkiyet_Haritasi/SHP (1)/MULKIYET.shp")
    m = m[["TAPUMAHADI", "ADA", "PARSEL", "MALIKTIPI", "TAPUCINSI", "geometry"]].rename(columns=str.lower)
    save(m, "ownership", {"title": "Mülkiyet (parseller)", "group": "Kısıtlar", "method": "data", "source": "MULKIYET.shp", "date": "bilinmiyor"})

    d = gpd.read_file(RAW / "2_9_Ulasım_Verileri/2_9_2_Taksi_Dolmuş_Hatları/SHP/DURAKLAR.shp").to_crs(CRS_TM30)
    d = d[d.intersects(ctx)][["Name", "FolderPath", "geometry"]].rename(columns={"Name": "ad", "FolderPath": "hat"})
    d["hat"] = d["hat"].str.split("/").str[-1]
    save(d, "minibus_stops", {"title": "Dolmuş/minibüs durakları", "group": "Ulaşım", "method": "data", "source": "DURAKLAR.shp", "date": "bilinmiyor"})
    h = gpd.read_file(RAW / "2_9_Ulasım_Verileri/2_9_2_Taksi_Dolmuş_Hatları/SHP/HATLAR.shp").to_crs(CRS_TM30)
    h = h[h.intersects(ctx)][["Name", "geometry"]].rename(columns={"Name": "hat"})
    h["geometry"] = h.geometry.intersection(ctx.buffer(1500))
    save(h, "minibus_lines", {"title": "Dolmuş/minibüs hatları", "group": "Ulaşım", "method": "data", "source": "HATLAR.shp", "date": "bilinmiyor"})
    sea = read_shp("2_9_Ulasım_Verileri/2_9_3_Deniz_Ulasimi/SHP/deniz_ulasimi.shp")
    sea = sea[sea.intersects(ctx)][["ISIM_HAT", "ISIM_KURUM", "TUR_HAT", "SURE_TASIT", "geometry"]].rename(columns=str.lower)
    save(sea, "ferry_lines", {"title": "Deniz ulaşımı hatları", "group": "Ulaşım", "method": "data", "source": "deniz_ulasimi.shp", "date": "bilinmiyor"})
    bus = gpd.read_file(RAW / "2_9_Ulasım_Verileri/2_9_1_İETT/SHP/GUZERGAH.shp").to_crs(CRS_TM30)
    bus = bus[bus.intersects(ctx)][["OBJECTID", "geometry"]]
    bus["geometry"] = bus.geometry.intersection(ctx.buffer(1500))
    save(bus, "bus_routes", {"title": "İETT güzergâhları (öznitelik yok)", "group": "Ulaşım", "method": "data", "source": "GUZERGAH.shp",
                             "date": "bilinmiyor", "notes": "Kaynakta hat adı/kodu yoktur."})


# --------------------------------------------------------------------------------------------- pedestrian network (derived)
def build_pedestrian(boundary, land, buildings):
    """Walkable space = land − buildings. Carriageways cannot be separated in the existing data,
    so walking distances computed on this surface are an optimistic upper bound and labelled as derived."""
    walk = land.difference(unary_union(buildings[buildings.alan_icinde].geometry))
    g = gpd.GeoDataFrame({"ad": ["Yürünebilir alan (türetilmiş)"], "alan_m2": [round(walk.area)]}, geometry=[walk], crs=CRS_TM30)
    save(g, "walkable", {"title": "Yürünebilir alan (türetilmiş)", "group": "Ulaşım", "method": "geometric",
                         "source": "Kara alanı − bina", "date": "—",
                         "notes": "Taşıt yolları ayrıştırılamadığı için yaya erişimi üst sınır (iyimser) yaklaşımdır."}, web=False)


def main(start="all"):
    """start: 'all' rebuilds everything; 'ref' reuses cached core layers and rebuilds reference/transport only."""
    import sys
    meta_path = PROCESSED / "layers.json"
    if start == "all":
        if GPKG.exists():
            GPKG.unlink()
        if meta_path.exists():
            meta_path.unlink()
    elif meta_path.exists():
        META.update(json.loads(meta_path.read_text(encoding="utf-8")))
    if start == "all":
        boundary = build_boundary()
        trees, crowns = build_trees(boundary)
        buildings = build_terrain_and_buildings(boundary)
        land, sea, E, coast = build_land(boundary)
        lg = gpd.GeoDataFrame({"ad": ["Kara alanı"], "alan_m2": [round(land.area)]}, geometry=[land], crs=CRS_TM30)
        save(lg, "land", {"title": "Kara alanı (sınır − deniz)", "group": "Temel", "method": "geometric",
                          "source": "Sınır − 01_PLN 'on deniz' taraması", "date": "—"}, web=False)
        existing, green = build_existing_surfaces(boundary, land, buildings, E)
        project, design = build_project_surfaces(boundary, land, existing, E)
    else:
        boundary = gpd.read_file(GPKG, layer="boundary").geometry.iloc[0]
        buildings = gpd.read_file(GPKG, layer="buildings")
        land = gpd.read_file(GPKG, layer="land").geometry.iloc[0]
        if start == "proj":
            E = dwgjson.load(CAD / "plan.json", CAD / "plan.pkl")["entities"]
            existing = gpd.read_file(GPKG, layer="surfaces_existing")
            build_project_surfaces(boundary, land, existing, E)
    build_reference(boundary)
    build_pedestrian(boundary, land, buildings)
    meta_path.write_text(json.dumps(META, ensure_ascii=False, indent=1), encoding="utf-8")
    print("done")


if __name__ == "__main__":
    import sys
    main(sys.argv[1] if len(sys.argv) > 1 else "all")
