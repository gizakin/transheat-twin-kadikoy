"""Transfer points (aktarma noktaları) derived from the survey drawing in 01 - PLAN.dwg.

* Metro entrances: 00_PKT SINIR_METRO line work, clustered (3 m merge) → one point per entrance outline.
* Piers: 00_HH HH_HID_ISKELE outlines; each named by the ferry lines whose end point lies within 150 m.
* Bus stops (covered shelters): 00_HH HH_YOL_DURAK_KAPALI outlines clustered within 25 m → stop groups.
* Minibus stops come from DURAKLAR.shp (already a point layer).
The tram (T3) stops are not drawn in any provided layer and are therefore missing.
"""
import json

import geopandas as gpd
import numpy as np
from shapely.geometry import Point
from shapely.ops import unary_union

import cadgeom
import dwgjson
from config import CAD, CRS_TM30, CRS_WEB, GPKG, PROCESSED, WEB


def clusters(geoms, gap):
    merged = unary_union([g.buffer(gap) for g in geoms])
    return list(merged.geoms) if hasattr(merged, "geoms") else [merged]


def main():
    d = dwgjson.load(CAD / "plan.json", CAD / "plan.pkl")
    E = d["entities"]
    rows = []

    metro = [cadgeom.to_line(e) for e in E if e["block"] == "00_PKT" and e["layer"].endswith("SINIR_METRO")]
    metro = [m for m in metro if m is not None]
    for i, c in enumerate(sorted(clusters(metro, 3.0), key=lambda g: -g.area)):
        if c.area < 20:
            continue
        rows.append({"tur": "metro", "ad": f"M4 Kadıköy yapısı {i + 1} (giriş/şaft ayrımı doğrulanmadı)", "hat": "M4 Kadıköy–Tavşantepe",
                     "yontem": "CAD kümeleme (SINIR_METRO)", "konum_belirsizligi_m": 5, "geometry": c.centroid})

    piers = [cadgeom.to_polygon(e) for e in E if e["block"] == "00_HH" and e["layer"].endswith("HH_HID_ISKELE")]
    piers = [p for p in piers if p is not None and p.area > 30]
    ferry = gpd.read_file(GPKG, layer="ferry_lines")
    ends = []
    for _, r in ferry.iterrows():
        g = r.geometry
        lines = list(g.geoms) if hasattr(g, "geoms") else [g]
        for l in lines:
            for pt in (l.coords[0], l.coords[-1]):
                ends.append((Point(pt), r["isim_hat"], r["isim_kurum"]))
    for i, p in enumerate(sorted(piers, key=lambda g: g.centroid.x)):
        near = sorted({f"{n} ({k})" for pt, n, k in ends if pt.distance(p) < 150})
        rows.append({"tur": "iskele", "ad": f"İskele {i + 1}", "hat": "; ".join(near) if near else "eşleşen hat yok",
                     "yontem": "CAD iskele poligonu + deniz hattı uç noktası (≤150 m)", "konum_belirsizligi_m": 10,
                     "geometry": p.representative_point()})

    import pyogrio
    if "iett_stops" in [l[0] for l in pyogrio.list_layers(GPKG)]:
        # active İETT stops (07.10.2026) replace the bus shelters inferred from the CAD drawing
        for r in gpd.read_file(GPKG, layer="iett_stops").itertuples():
            rows.append({"tur": "otobus", "ad": f"{r.ad} – {r.yon} ({r.kod})", "hat": r.hatlar or "—",
                         "yontem": "İETT aktif durak verisi (07.10.2026)", "konum_belirsizligi_m": 2, "geometry": r.geometry})
    else:
        stops = [cadgeom.to_polygon(e) or cadgeom.to_line(e) for e in E
                 if e["block"] == "00_HH" and e["layer"].endswith("HH_YOL_DURAK_KAPALI")]
        stops = [s for s in stops if s is not None]
        for i, c in enumerate(sorted(clusters(stops, 12.5), key=lambda g: g.centroid.y)):
            rows.append({"tur": "otobus", "ad": f"Otobüs durak grubu {i + 1}", "hat": "İETT (hat bilgisi kaynakta yok)",
                         "yontem": "CAD kapalı durak kümeleme (25 m)", "konum_belirsizligi_m": 15, "geometry": c.centroid})

    mb = gpd.read_file(GPKG, layer="minibus_stops")
    boundary = gpd.read_file(GPKG, layer="boundary").geometry.iloc[0]
    mb = mb[mb.distance(boundary) < 150]
    for _, r in mb.iterrows():
        rows.append({"tur": "minibus", "ad": r["ad"], "hat": r["hat"], "yontem": "DURAKLAR.shp",
                     "konum_belirsizligi_m": 10, "geometry": r.geometry})

    g = gpd.GeoDataFrame(rows, crs=CRS_TM30)
    g.to_file(GPKG, layer="transfer_points", driver="GPKG")
    (WEB / "transfer_points.geojson").write_text(g.to_crs(CRS_WEB).to_json(drop_id=True), encoding="utf-8")
    meta_path = PROCESSED / "layers.json"
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    meta["transfer_points"] = {"title": "Aktarma noktaları", "group": "Ulaşım", "method": "data",
                               "source": "01 - PLAN.dwg (SINIR_METRO, HH_HID_ISKELE) + İETT aktif durakları (07.10.2026) + DURAKLAR.shp + deniz_ulasimi.shp",
                               "date": "bilinmiyor", "count": len(g),
                               "notes": "T3 tramvay durakları verilen katmanlarda yoktur. Konumlar CAD çiziminden kümelemeyle türetilmiştir. "
                                        "Kaynak istatistik 4 metro girişi bildirir; çizimde 9 metro yapısı (giriş, şaft, havalandırma) ayrışmış ve "
                                        "giriş/şaft ayrımı doğrulanamamıştır — metroya yürüme mesafeleri bu nedenle alt sınırdır."}
    meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")
    print(g.groupby("tur").size())


if __name__ == "__main__":
    main()
