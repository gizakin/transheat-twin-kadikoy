"""İBB live traffic density (UYM Trafik Yoğunluk Haritası) → road segments around the study area + one snapshot.

Source: the public JSON service behind https://uym.ibb.gov.tr/yharita6/ (no key, CORS open):
  * geometry  GET https://tkmservices.ibb.gov.tr/web/api/TrafficData/v3/Segments/1   (most detailed level, zoom 16–17)
              [{S: segment id, G: "[[lat, lon], …]", Z: district}]
  * live data GET https://tkmservices.ibb.gov.tr/web/api/TrafficData/v4/SegmentData  (refreshed every minute)
              {Date, Data: [{S, V: speed km/h, C: class 1–5, T: source code, D: "HH:MM"}]}
Class colours and labels are the ones the İBB map uses (app.css / LanguageText):
  1 Serbest #77b791 · 2 Açık #4d8463 · 3 Akıcı #f9a346 · 4 Yoğun #d85050 · 5 Çok yoğun #842320 · no record = Veri yok #a8a8a8.
The browser fetches the live data itself; the snapshot written here is the fallback when that request is not possible.
"""
import json
import ssl
import urllib.request
from datetime import datetime

import geopandas as gpd
from shapely.geometry import LineString

from config import CRS_TM30, CRS_WEB, GPKG, PROCESSED, ROOT

BASE = "https://tkmservices.ibb.gov.tr/web/api/TrafficData"
OUT = ROOT / "frontend" / "public" / "data"
CACHE = ROOT / "work" / "ibb"
CONTEXT_M = 1500


def get(url):
    ctx = ssl.create_default_context()
    req = urllib.request.Request(url, headers={"Referer": "https://uym.ibb.gov.tr/yharita6/", "User-Agent": "transheat-twin-etl"})
    try:
        with urllib.request.urlopen(req, timeout=120, context=ctx) as r:
            return json.loads(r.read().decode("utf-8"))
    except ssl.SSLError:
        # corporate TLS inspection: fall back to the OS trust store via truststore if available
        import truststore
        truststore.inject_into_ssl()
        with urllib.request.urlopen(req, timeout=120) as r:
            return json.loads(r.read().decode("utf-8"))


def main():
    CACHE.mkdir(parents=True, exist_ok=True)
    segs = get(f"{BASE}/v3/Segments/1")
    (CACHE / "segments1.json").write_text(json.dumps(segs, ensure_ascii=False), encoding="utf-8")
    rows = []
    for s in segs:
        pts = json.loads(s["G"])
        if len(pts) > 1:
            rows.append({"S": int(s["S"]), "ilce": s.get("Z") or "", "geometry": LineString([(lon, lat) for lat, lon in pts])})
    g = gpd.GeoDataFrame(rows, crs=CRS_WEB).to_crs(CRS_TM30)
    boundary = gpd.read_file(GPKG, layer="boundary").geometry.iloc[0]
    g = g[g.intersects(boundary.buffer(CONTEXT_M))].copy()
    g["uzunluk_m"] = g.length.round(1)
    g["alanda"] = g.intersects(boundary.buffer(50))  # segments touching the study area (+50 m) for the site summary
    w = g.to_crs(CRS_WEB)
    (OUT / "traffic_segments.geojson").write_text(w.to_json(drop_id=True), encoding="utf-8")

    live = get(f"{BASE}/v4/SegmentData")
    ids = set(g["S"])
    snap = {"Date": live.get("Date"), "Data": [d for d in live.get("Data", []) if d.get("S") in ids]}
    (OUT / "traffic_snapshot.json").write_text(json.dumps(snap, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    meta = {"title": "İBB canlı trafik yoğunluğu", "source": "İBB Ulaşım Yönetim Merkezi – Trafik Yoğunluk Haritası (tkmservices.ibb.gov.tr)",
            "group": "Ulaşım", "date": "canlı (1 dk)", "method": "data",
            "notes": f"{len(g)} yol parçası, çalışma alanının {CONTEXT_M} m çevresi; geometri sürümü SEG, anlık görüntü {snap['Date']}"}
    mp = PROCESSED / "layers.json"
    m = json.loads(mp.read_text(encoding="utf-8"))
    m["traffic"] = {**meta, "count": int(len(g)), "crs_source": CRS_TM30}
    mp.write_text(json.dumps(m, ensure_ascii=False, indent=1), encoding="utf-8")
    mj = OUT / "meta.json"
    M = json.loads(mj.read_text(encoding="utf-8"))
    M["layers"]["traffic"] = m["traffic"]
    mj.write_text(json.dumps(M, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"traffic segments {len(g)} ({g.uzunluk_m.sum() / 1000:.1f} km, {int(g.alanda.sum())} at site) · snapshot {len(snap['Data'])} records @ {snap['Date']}")


if __name__ == "__main__":
    main()
