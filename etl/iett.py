"""İETT active stops and routes (07.10.2026) → display layers, line–stop links and route-density corridors.

Inputs (folder supplied by the user):
  Kadıköy_bölgedeki_akitif_iett_durakları_07102026.shp  — 19 active stops (EPSG:4326)
  Kadıköy_Gecen_Guzergahlar_07102026.shp                — 92 route geometries (52 lines, outbound/return), TM30
Derived (labelled as such):
  * lines serving a stop: route geometry within 12 m of the stop (no stop-sequence table was supplied);
  * corridors: noded union of all routes in the context area, each segment carrying the number of distinct lines
    whose route runs within 5 m of it.
"""
import json
import os
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
import shapely
from shapely.geometry import Point
from shapely.ops import linemerge, unary_union

from config import CRS_TM30, CRS_WEB, GPKG, PROCESSED, WEB

SRC = Path(os.environ.get("TRANSHEAT_IETT", Path(__file__).resolve().parents[1] / "raw" / "iett_07102026"))  # İETT data, not redistributed
STOP_LINK_M = 12
CORRIDOR_M = 5
KEEP = ["HAT_KODU", "HAT_ADI", "GUZERGAH_A", "GUZERGAH_K", "YON", "HAT_BASI", "HAT_SONU", "GARAJ_ADI", "ISLETME_AL", "RING_MI", "ACIKLAMA", "YOLCU_ACIK", "B_NOKTASI", "UZUNLUK"]


def save(g, lid, meta):
    g.to_file(GPKG, layer=lid, driver="GPKG")
    w = g.to_crs(CRS_WEB)
    for c in w.columns:
        if c != "geometry" and w[c].dtype == object:
            w[c] = w[c].astype(str)
    (WEB / f"{lid}.geojson").write_text(w.to_json(drop_id=True), encoding="utf-8")
    mp = PROCESSED / "layers.json"
    m = json.loads(mp.read_text(encoding="utf-8"))
    m[lid] = {**meta, "count": int(len(g)), "crs_source": CRS_TM30}
    mp.write_text(json.dumps(m, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{lid:18s} {len(g)}")


def main():
    boundary = gpd.read_file(GPKG, layer="boundary").geometry.iloc[0]
    ctx = boundary.buffer(1500)
    water = gpd.read_file(GPKG, layer="water").geometry.iloc[0].buffer(-5)

    stops = gpd.read_file(SRC / "Kadıköy_bölgedeki_akitif_iett_durakları_07102026.shp").to_crs(CRS_TM30)
    stops = stops.rename(columns={"Durak_Kodu": "kod", "Adı": "ad", "Yon_Bilgis": "yon", "Durak_Tipi": "tip", "Durumu": "durum", "Peron_Dura": "peron"})
    stops["kod"] = stops["kod"].astype(int)
    routes = gpd.read_file(SRC / "Kadıköy_Gecen_Guzergahlar_07102026.shp").set_crs(CRS_TM30, allow_override=True)
    routes = routes[[c for c in KEEP if c in routes.columns] + ["geometry"]].copy()
    routes["B_NOKTASI"] = routes["B_NOKTASI"].astype(int)

    # lines serving each stop (derived from geometry) + lines starting there (B_NOKTASI)
    serve = []
    for _, s in stops.iterrows():
        near = routes[routes.distance(s.geometry) <= STOP_LINK_M]
        start = routes[routes["B_NOKTASI"] == s["kod"]]
        codes = sorted(set(near["HAT_KODU"]) | set(start["HAT_KODU"]), key=lambda c: (len(c), c))
        serve.append({"hatlar": ", ".join(codes), "hat_sayisi": len(codes), "baslayan_hatlar": ", ".join(sorted(set(start["HAT_KODU"])))})
    stops = pd.concat([stops.reset_index(drop=True), pd.DataFrame(serve)], axis=1)
    stops = gpd.GeoDataFrame(stops, geometry="geometry", crs=CRS_TM30)
    stops["yontem"] = f"durak verisi İETT (07.10.2026); hat listesi güzergâh–durak yakınlığından (≤{STOP_LINK_M} m) türetildi"
    save(stops[["kod", "ad", "yon", "tip", "durum", "peron", "hatlar", "hat_sayisi", "baslayan_hatlar", "yontem", "geometry"]], "iett_stops",
         {"title": "İETT durakları (aktif, 07.10.2026)", "group": "Ulaşım", "method": "data",
          "source": "Kadıköy_bölgedeki_akitif_iett_durakları_07102026.shp", "date": "2026-10-07",
          "notes": f"Durağa uğrayan hatlar, güzergâhın durağa ≤{STOP_LINK_M} m geçmesinden türetilmiştir (durak–hat sıra tablosu verilmedi)."})

    # routes clipped to the context area and kept off the sea
    r = routes.copy()
    r["geometry"] = r.geometry.intersection(ctx).difference(water)
    r = r[~r.is_empty].explode(index_parts=False)
    r = r[r.geom_type == "LineString"]
    save(r, "iett_routes", {"title": "İETT güzergâhları (aktif, 07.10.2026)", "group": "Ulaşım", "method": "data",
                            "source": "Kadıköy_Gecen_Guzergahlar_07102026.shp (52 hat, gidiş/dönüş)", "date": "2026-10-07",
                            "notes": "Çalışma alanının 1,5 km çevresine kırpılmıştır."})

    # corridors: node all routes, count distinct lines within CORRIDOR_M of each segment
    noded = unary_union(list(r.geometry))
    segs = [g for g in getattr(noded, "geoms", [noded]) if g.length > 0.5]
    tree = shapely.STRtree(list(r.geometry))
    codes_of = list(r["HAT_KODU"])
    rows = []
    for sgm in segs:
        mid = sgm.interpolate(0.5, normalized=True)
        idx = tree.query(mid.buffer(CORRIDOR_M), predicate="intersects")
        hs = sorted({codes_of[i] for i in idx}, key=lambda c: (len(c), c))
        rows.append({"hat_sayisi": len(hs), "hatlar": ", ".join(hs), "geometry": sgm})
    c = gpd.GeoDataFrame(rows, crs=CRS_TM30)
    merged = []
    for (n, hs), grp in c.groupby(["hat_sayisi", "hatlar"]):
        u = unary_union(list(grp.geometry))
        m = linemerge(u) if u.geom_type == "MultiLineString" else u
        for g in getattr(m, "geoms", [m]):
            merged.append({"hat_sayisi": n, "hatlar": hs, "geometry": g})
    c = gpd.GeoDataFrame(merged, crs=CRS_TM30)
    save(c, "bus_corridors", {"title": "Otobüs hat yoğunluğu koridorları", "group": "Ulaşım", "method": "geometric",
                              "source": "İETT güzergâhları (07.10.2026), düğümlenmiş birleşim", "date": "2026-10-07",
                              "notes": f"Her parça, ≤{CORRIDOR_M} m içinden geçen farklı hat sayısını taşır (gidiş/dönüş aynı hat sayılır)."})
    print("max lines on a corridor:", c.hat_sayisi.max(), "| stops lines:", list(zip(stops.ad, stops.yon, stops.hat_sayisi)))


if __name__ == "__main__":
    main()
