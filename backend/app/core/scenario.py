"""Scenario engine: apply interventions to a base state and compare indicators.

Result structure (all geometry in WGS84 GeoJSON for the client):
  kpis_base / kpis_scenario / deltas      — from kpi.compute (geometric / data / literature labels)
  literature_effects                      — verified literature ranges, only where the computed change applies
  narrative                               — sentences generated from computed numbers only (no ranking, no "best")
  impacts: positive / negative / affected / stakeholders (each item tagged with its basis)
  geoms: new_trees, new_shade, intervention_areas, affected_paths, changed_surfaces, routes
"""
import math
from datetime import datetime

import geopandas as gpd
import numpy as np
import pandas as pd
import shapely
from pyproj import Transformer
from shapely.geometry import LineString, Point, Polygon, mapping, shape
from shapely.ops import transform as shp_transform
from shapely.validation import make_valid

from . import kpi as K
from . import shadow
from .data import CRS, assumption, boundary, land, layer, lit_param
from .state import State, apply_surface, albedo_range, base_state

TO_TM = Transformer.from_crs("EPSG:4326", CRS, always_xy=True).transform
TO_WGS = Transformer.from_crs(CRS, "EPSG:4326", always_xy=True).transform

INTERVENTIONS = {
    "tree_planting": "Ağaçlandırma",
    "green_conversion": "Yeşil alan",
    "hard_reduction": "Sert zemini azalt (yeşile dönüştür)",
    "shade_structure": "Gölgeleme elemanı",
    "pv_shading": "Fotovoltaik gölgeleme",
    "permeable_surface": "Geçirgen yüzey",
    "cool_pavement": "Açık renkli / cool pavement",
    "surface_change": "Zemin malzemesi değişimi",
    "pedestrian_route": "Yaya güzergâhı",
    "transfer_area": "Aktarma alanı",
}

MATERIALS = {
    # key: (label, class, permeable, literature albedo key or None)
    "asfalt": ("Asfalt", "asfalt", False, "asfalt"),
    "beton": ("Beton", "sert", False, "beton"),
    "granit": ("Granit plak taş", "sert", False, None),
    "bazalt": ("Bazalt plak taş", "sert", False, None),
    "acik_renkli": ("Açık renkli kaplama (cool pavement)", "sert", False, None),
    "gecirgen_beton": ("Geçirgen beton / kaplama", "sert", True, None),
    "agac_kabugu": ("Ağaç kabuğu (malç)", "gecirgen", True, None),
    "cim": ("Çim", "yesil", True, None),
}


def n0(x):
    """Thousands-separated integer in Turkish style (1.234)."""
    return f"{x:,.0f}".replace(",", ".")


def to_tm(geojson_geom):
    return make_valid(shp_transform(TO_TM, shape(geojson_geom)))


def to_wgs(g):
    return mapping(shp_transform(TO_WGS, g)) if g is not None and not g.is_empty else None


def _place_trees(poly, n, crown_d, existing_trees, obstacles):
    """Hexagonal layout inside poly, spacing = crown diameter; skips obstacles and existing crowns."""
    sp = max(crown_d, 2.0)
    minx, miny, maxx, maxy = poly.bounds
    free = poly.difference(obstacles).buffer(-crown_d / 4) if not obstacles.is_empty else poly.buffer(-crown_d / 4)
    pts = []
    row = 0
    y = miny + sp / 2
    ex = list(zip(existing_trees.geometry.x, existing_trees.geometry.y, existing_trees["tac_cap_m"]))
    while y <= maxy:
        x = minx + sp / 2 + (sp / 2 if row % 2 else 0)
        while x <= maxx:
            p = Point(x, y)
            if free.contains(p) and all(math.hypot(x - ex_x, y - ex_y) > (crown_d + ex_d) / 2 * 0.8 for ex_x, ex_y, ex_d in ex):
                pts.append(p)
            x += sp
        y += sp * math.sqrt(3) / 2
        row += 1
    # spread the chosen trees evenly over the candidate list
    if len(pts) > n:
        idx = np.linspace(0, len(pts) - 1, n).round().astype(int)
        pts = [pts[i] for i in idx]
    return pts


def apply(base: State, sc: dict):
    st = base.copy(sc.get("id", "senaryo"), sc.get("scenario_name", "Senaryo"))
    log, areas, new_tree_pts, warnings = [], [], [], []
    obstacles = shapely.union_all(st.surfaces[st.surfaces["sinif"].isin(["bina", "su"])].geometry.values)
    for iv in sc.get("interventions", []):
        t = iv["type"]
        g = to_tm(iv["geometry"]) if iv.get("geometry") else None
        if g is not None and g.geom_type in ("Polygon", "MultiPolygon"):
            g = make_valid(g.intersection(land()))
            areas.append((t, g))
        if t == "tree_planting":
            n = int(iv.get("tree_count", 10)); d = float(iv.get("canopy_diameter", 5)); h = float(iv.get("tree_height", max(d * 1.4, 4)))
            if g.geom_type in ("Point", "MultiPoint"):
                pts = list(g.geoms) if hasattr(g, "geoms") else [g]
            else:
                pts = _place_trees(g, n, d, st.trees[st.trees.intersects(g.buffer(d))], obstacles)
            if len(pts) < n:
                warnings.append(f"Seçilen alana taç çapı {d} m ile en fazla {len(pts)} ağaç yerleştirilebildi (istenen {n}).")
            rows = [{"no": None, "turkce": iv.get("species", "Senaryo ağacı"), "latin": iv.get("species_latin", ""), "boy_m": h,
                     "tac_cap_m": d, "saglik": "—", "eslesme": "senaryo", "boy_kaynak": "kullanıcı", "yeni": True, "geometry": p} for p in pts]
            if rows:
                st.trees = gpd.GeoDataFrame(pd.concat([st.trees, gpd.GeoDataFrame(rows, crs=CRS)], ignore_index=True), crs=CRS)
            new_tree_pts += pts
            log.append(f"{len(pts)} ağaç (taç çapı {d} m, boy {h} m) eklendi.")
        elif t in ("green_conversion", "hard_reduction"):
            a = apply_surface(st, g, "yesil", "çim/bitkili (senaryo)", "Yeşil alan (senaryo)")
            log.append(f"{n0(a)} m² yüzey yeşil alana dönüştürüldü.")
        elif t in ("shade_structure", "pv_shading"):
            h = float(iv.get("height", 4.0)); op = float(iv.get("shade_ratio", 100)) / 100.0
            st.structures.append({"geometry": g, "height": h, "opacity": op,
                                  "kind": "Fotovoltaik gölgeleme" if t == "pv_shading" else iv.get("shade_type", "Gölgeleme elemanı")})
            log.append(f"{n0(g.area)} m² gölgeleme elemanı (yükseklik {h} m, gölgeleme oranı %{op * 100:.0f}) eklendi.")
        elif t in ("surface_change", "cool_pavement", "permeable_surface"):
            mat = iv.get("new_material") or ("acik_renkli" if t == "cool_pavement" else "gecirgen_beton")
            lbl, cls, perm, alb_key = MATERIALS.get(mat, (mat, "sert", False, None))
            if t == "permeable_surface":
                perm = True
            alb = iv.get("albedo")
            alb = float(alb) if alb not in (None, "") else None
            a = apply_surface(st, g, cls, mat, lbl, albedo=alb, gecirgen=perm)
            log.append(f"{n0(a)} m² yüzey '{lbl}' olarak değiştirildi" + (f" (albedo {alb})" if alb is not None else "") + ".")
        elif t == "pedestrian_route":
            st.routes.append(g)
            log.append(f"{n0(g.length)} m yaya güzergâhı tanımlandı.")
        elif t == "transfer_area":
            c = g.centroid if g.geom_type != "Point" else g
            st.extra_transfer.append({"tur": iv.get("transfer_type", "otobus"), "ad": iv.get("name", "Önerilen aktarma noktası"), "x": c.x, "y": c.y})
            log.append(f"Önerilen aktarma noktası ({iv.get('transfer_type', 'otobus')}) eklendi.")
    return st, {"log": log, "areas": areas, "new_trees": new_tree_pts, "warnings": warnings}


def _kmap(ks):
    return {k["id"]: k for k in ks}


def _num(v):
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def lit_effects(sc, base_raw, scn_raw, sun, interventions_meta):
    """Verified literature statements, attached only when the computed change makes them relevant."""
    out = []
    types = {iv["type"] for iv in sc.get("interventions", [])}
    d_sh = scn_raw["a_sh"] - base_raw["a_sh"]
    if d_sh > 1 and sun["elevation"] > 0 and types & {"tree_planting", "shade_structure", "pv_shading"}:
        pid = ["shade_globe", "shade_tair", "shade_pet_steps"] + (["shade_tsurf_tree"] if "tree_planting" in types else [])
        ps = [lit_param(p) for p in pid]
        txt = (f"Seçilen saatte yeni gölgelenen yaklaşık {n0(d_sh)} m² açık zemin için literatürde gölge altında raporlanan etkiler: "
               f"glob sıcaklığında en fazla {ps[0]['deger'][0]}–{ps[0]['deger'][1]} °C düşüş (Armson vd., 2012; Manchester), "
               f"hava sıcaklığında en fazla {ps[1]['deger'][1]} °C düşüş ve PET'te {ps[2]['deger'][0]} termal duyum kademesi iyileşme "
               f"(Lee vd., 2013; Freiburg).")
        if "tree_planting" in types:
            txt += f" Ağaç gölgesi altında en yüksek yüzey sıcaklığında en fazla {ps[3]['deger'][1]} °C düşüş raporlanmıştır (Armson vd., 2012)."
        out.append({"text": txt + " Bu değerler Kadıköy koşullarında ölçülmemiş veya modellenmemiştir.",
                    "method": "literature", "params": pid, "confidence": "orta"})
    if "pv_shading" in types:
        out.append({"text": "Fotovoltaik gölgeleme elemanının gölge dışındaki termal etkisi için literatür parametresi tanımlanmamış.",
                    "method": "literature", "params": ["pv_shade_thermal"], "confidence": "—"})
    d_g = scn_raw["a_yesil"] - base_raw["a_yesil"]
    if d_g > 1:
        p = lit_param("grass_tsurf")
        out.append({"text": f"Yeşile dönüştürülen {n0(d_g)} m² alanda, çimin sert zemine göre en yüksek yüzey sıcaklığının en fazla {p['deger'][1]} °C "
                            f"daha düşük olabildiği raporlanmıştır (Armson vd., 2012). Aynı çalışma, çimin yaya düzeyindeki hava konforuna etkisinin sınırlı olduğunu belirtir.",
                    "method": "literature", "params": ["grass_tsurf"], "confidence": "orta"})
        if d_g >= 10000:
            p1, p2 = lit_param("park_cooling_day"), lit_param("park_cooling_night")
            out.append({"text": f"Park ölçeğinde (≥1 ha) meta-analiz sonucu: parklar çevrelerine göre gündüz ortalama {p1['deger'][0]} °C, gece {p2['deger'][0]} °C "
                                f"daha serindir (Bowler vd., 2010). Parkların büyüklüğüne ve yapısına göre geniş değişkenlik gösterir.",
                        "method": "literature", "params": ["park_cooling_day", "park_cooling_night"], "confidence": "orta"})
        else:
            out.append({"text": "Park ölçeğindeki serinleme bulguları (Bowler vd., 2010) 1 ha altındaki yeşil alanlara uygulanmamıştır.",
                        "method": "literature", "params": ["park_cooling_day"], "confidence": "—"})
    for iv in sc.get("interventions", []):
        if iv["type"] in ("surface_change", "cool_pavement"):
            old = iv.get("current_material")
            new_alb = iv.get("albedo")
            rng = albedo_range(old) if old else None
            if rng and new_alb not in (None, ""):
                lo, hi = float(new_alb) - rng[1], float(new_alb) - rng[0]
                k = lit_param("tsurf_per_albedo_derived")["deger"][0]
                out.append({"text": f"Albedo değişimi {lo:+.2f} ile {hi:+.2f} arasında (mevcut '{old}' için literatür aralığı {rng[0]}–{rng[1]}, yeni değer {new_alb}). "
                                    f"Santamouris (2013)'te aktarılan duyarlılık analizinden doğrusal türetimle en yüksek yüzey sıcaklığında yaklaşık "
                                    f"{k * hi * 10:.1f} ile {k * lo * 10:.1f} K arası değişim beklenebilir (düşük güven: türetilmiş, tek iklim koşulu).",
                            "method": "literature", "params": ["albedo_" + old + "_yeni", "tsurf_per_albedo_derived", "tsurf_albedo_pair"], "confidence": "düşük"})
            else:
                why = "mevcut malzeme belirtilmemiş" if not old else (f"'{old}' için doğrulanmış albedo değeri yok" if not rng else "yeni albedo girilmemiş")
                out.append({"text": f"Zemin değişiminin yüzey sıcaklığına etkisi hesaplanamadı: {why}. Literatür parametresi tanımlanmamış.",
                            "method": "literature", "params": [], "confidence": "—"})
        if iv["type"] == "permeable_surface":
            p = lit_param("permeable_effect")
            out.append({"text": "Geçirgen yüzeyin sıcaklık etkisi için sayısal literatür parametresi tanımlanmamış. " + (p.get("not") or ""),
                        "method": "literature", "params": ["permeable_effect"], "confidence": "—"})
    return out


def symbol(delta, base, higher_is="better"):
    """Relative-change symbol (documented thresholds): <1 % → 0, 1–10 % → ±, 10–30 % → ±±, >30 % → ±±±."""
    if delta is None or base in (None, 0):
        if delta:
            return "+" if (delta > 0) == (higher_is == "better") else "−"
        return "0"
    r = abs(delta) / abs(base) * 100
    n = 0 if r < 1 else 1 if r < 10 else 2 if r < 30 else 3
    if n == 0:
        return "0"
    good = (delta > 0) == (higher_is == "better")
    return ("+" if good else "−") * n


def impacts(sc, st, base_k, scn_k, extra, paths_affected):
    pos, neg, aff, stake = [], [], [], set()
    types = {iv["type"] for iv in sc.get("interventions", [])}

    def d(k):
        a, b = _num(base_k.get(k, {}).get("value")), _num(scn_k.get(k, {}).get("value"))
        return (b - a) if a is not None and b is not None else None

    if (d("yesil_oran") or 0) > 0: pos.append({"text": f"Yeşil alan oranı {d('yesil_oran'):+.2f} puan değişir.", "basis": "geometrik hesap"})
    if (d("golge_oran") or 0) > 0: pos.append({"text": f"Seçilen saatte gölgeli alan oranı {d('golge_oran'):+.2f} puan artar.", "basis": "geometrik hesap"})
    if (d("gunes_acik_sert_m2") or 0) < 0: pos.append({"text": f"Güneşe açık sert zemin {n0(abs(d('gunes_acik_sert_m2')))} m² azalır.", "basis": "geometrik hesap"})
    if (d("gecirgen_oran") or 0) > 0: pos.append({"text": f"Geçirgen yüzey oranı {d('gecirgen_oran'):+.2f} puan artar.", "basis": "geometrik hesap"})
    if (d("sert_oran") or 0) < 0 and types & {"green_conversion", "hard_reduction"}:
        neg.append({"text": f"Sert zemin oranı {d('sert_oran'):+.2f} puan azalır; toplanma, etkinlik ve yaya akışı için kullanılabilir açık sert alan küçülür.", "basis": "geometrik hesap"})
    if extra.get("winter_extra_shade", 0) > 1:
        neg.append({"text": f"21 Aralık 12:00'de ek gölge {n0(extra['winter_extra_shade'])} m²: kış aylarında güneş erişimi azalabilir.", "basis": "geometrik hesap"})
    if extra.get("infra_conflicts"):
        for k, n in extra["infra_conflicts"].items():
            neg.append({"text": f"{n} yeni ağaç, {k} hattına 1,5 m'den yakın: kök–altyapı çakışma riski (eşik varsayımdır).", "basis": "veri + varsayım"})
            stake.add(k.split()[0])
    if extra.get("heritage"):
        neg.append({"text": f"Müdahale alanı {extra['heritage']} tescilli yapı/sit alanı ile kesişiyor; ilgili Koruma Bölge Kurulu onayı gerekir (1/5000 KANİP plan hükmü 1.2).", "basis": "veri"})
        stake.add("Kültür Varlıklarını Koruma Bölge Kurulu")
    if extra.get("private_parcels"):
        neg.append({"text": f"Müdahale {extra['private_parcels']} özel mülkiyetli parselle kesişiyor.", "basis": "veri"})
        stake.add("Parsel malikleri")
    if "tree_planting" in types:
        neg.append({"text": "Ağaçların sulama, budama ve bakım ihtiyacı doğar (genel bilgi, sayısallaştırılmamıştır).", "basis": "varsayım / genel bilgi"})
        stake.update(["İBB Park ve Bahçeler", "Kadıköy Belediyesi bakım ekipleri"])
    if types & {"shade_structure", "pv_shading"}:
        neg.append({"text": "Gölgeleme elemanı için taşıyıcı, rüzgâr yükü ve bakım gereksinimi doğar (genel bilgi, sayısallaştırılmamıştır).", "basis": "varsayım / genel bilgi"})
    if "pv_shading" in types:
        stake.add("Enerji dağıtım şirketi (AYEDAŞ)")
    for t, g in extra.get("areas", []):
        aff.append({"text": f"{INTERVENTIONS.get(t, t)} alanı: {n0(g.area)} m²", "basis": "geometrik hesap"})
    for p in paths_affected:
        aff.append({"text": f"Aktarma güzergâhı {p['from']} → {p['to']} ({p['dist_m']} m) müdahale/gölge alanından geçiyor.", "basis": "geometrik hesap"})
    stake.update(["Yayalar", "İBB"])
    if paths_affected or types & {"pedestrian_route", "transfer_area"}:
        stake.update(["Toplu taşıma kullanıcıları", "İETT", "Metro İstanbul", "Şehir Hatları ve özel deniz işletmeleri"])
    if extra.get("near_commercial"):
        stake.add("Esnaf (zemin kat ticaret)")
    return {"positive": pos, "negative": neg, "affected": aff,
            "stakeholders": [{"name": s, "basis": "mekânsal kesişim / müdahale türü (varsayım içerir)"} for s in sorted(stake)]}


def context_checks(st, extra_areas, new_trees):
    out = {"infra_conflicts": {}, "heritage": 0, "private_parcels": 0, "near_commercial": False}
    union = shapely.union_all([g for _, g in extra_areas]) if extra_areas else shapely.Polygon()
    try:
        inf = layer("infrastructure")
        if new_trees:
            tp = gpd.GeoSeries(new_trees, crs=CRS)
            for k, grp in inf.groupby("kurum"):
                lines = shapely.union_all(grp.geometry.values)
                n = int((tp.distance(lines) < 1.5).sum())
                if n:
                    out["infra_conflicts"][k] = n
    except Exception:
        pass
    if not union.is_empty:
        h = layer("heritage"); s = layer("sit")
        out["heritage"] = int(h.intersects(union).sum() + s.intersects(union).sum())
        m = layer("ownership")
        priv = m[m.intersects(union) & ~m["maliktipi"].astype(str).str.contains("Kamu|Hazine|Belediye|Hazine", case=False, na=False)]
        out["private_parcels"] = int(len(priv))
        b = layer("buildings")
        out["near_commercial"] = bool((b[b["tur"] == "Ticari"].distance(union) < 30).any())
    return out


def run(sc: dict, area_geojson=None, raster_value_fn=None):
    base_key = sc.get("base", "mevcut")
    base = base_state(base_key)
    time_iso = sc.get("time", "2026-07-15T14:00")
    st, info = apply(base, sc)
    # analysis area: union of intervention areas buffered 50 m, or explicit area, or whole site
    if area_geojson:
        A = to_tm(area_geojson)
    elif info["areas"]:
        A = make_valid(shapely.union_all([g.buffer(50) for _, g in info["areas"]]).intersection(boundary()))
    else:
        A = boundary()
    rv_b = raster_value_fn(A) if raster_value_fn else None
    kb = K.compute(base, A, time_iso, rv_b)
    ks = K.compute(st, A, time_iso, rv_b)
    tb = K.transport_kpis(base, time_iso, A)
    ts = K.transport_kpis(st, time_iso, A)
    base_k = _kmap(kb["kpis"] + tb["kpis"]); scn_k = _kmap(ks["kpis"] + ts["kpis"])
    deltas = {}
    for k, v in scn_k.items():
        a, b = _num(base_k.get(k, {}).get("value")), _num(v.get("value"))
        deltas[k] = round(b - a, 2) if a is not None and b is not None else None

    winter = "2026-12-21T12:00"
    wb = K.compute(base, A, winter); ws = K.compute(st, A, winter)
    extra = context_checks(st, info["areas"], info["new_trees"])
    extra["winter_extra_shade"] = ws["raw"]["a_sh"] - wb["raw"]["a_sh"]
    extra["areas"] = info["areas"]
    new_shade = make_valid(ks["geoms"]["shadow"].difference(kb["geoms"]["shadow"]))
    affected_paths = [p for p in ts["paths"] if p["geometry"] is not None and info["areas"]
                      and p["geometry"].intersects(shapely.union_all([g for _, g in info["areas"]] + [new_shade]))]
    imp = impacts(sc, st, base_k, scn_k, extra, affected_paths)
    lit = lit_effects(sc, kb["raw"], ks["raw"], ks["sun"], info)

    narrative = []
    for k, lbl in [("yesil_oran", "yeşil alan oranı"), ("golge_oran", "gölgeli alan oranı"), ("sert_oran", "sert zemin oranı"),
                   ("agac_tac_oran", "ağaç taç örtüsü oranı"), ("gecirgen_oran", "geçirgen yüzey oranı")]:
        if deltas.get(k):
            narrative.append(f"Bu senaryoda {lbl} {base_k[k]['value']}% → {scn_k[k]['value']}% ({deltas[k]:+.2f} puan) değişmektedir.")
    if deltas.get("aktarma_ort_mesafe"):
        b0 = base_k["aktarma_ort_mesafe"]["value"]
        narrative.append(f"Ortalama aktarma yürüme mesafesi %{100 * deltas['aktarma_ort_mesafe'] / b0:+.1f} değişmektedir.")
    if deltas.get("yesil_oran", 0) and deltas.get("golge_oran", 0):
        narrative.append("Bu senaryo yeşil alanı " + ("artırırken" if deltas["yesil_oran"] > 0 else "azaltırken") +
                         " gölgeli alanı da " + ("artırmaktadır." if deltas["golge_oran"] > 0 else "azaltmaktadır."))
    for r in ts["routes"]:
        narrative.append(f"{r['name']} {r['length_m']} m uzunluğunda; seçilen saatte %{r['shaded_pct']}'i gölgede.")
    if not narrative:
        narrative.append("Hesaplanan göstergelerde anlamlı bir değişim bulunmadı.")
    if ks["sun"]["elevation"] <= 0:
        narrative.append("Seçilen saatte güneş ufkun altındadır; gölge göstergeleri anlamlı değildir.")

    methods = sorted({k["method"] for k in ks["kpis"]} | {e["method"] for e in lit})
    confidence = "Yüksek" if set(methods) <= {"data", "geometric"} else ("Orta" if "literature" in methods else "Düşük")
    geoms = {
        "new_trees": {"type": "FeatureCollection", "features": [{"type": "Feature", "properties": {"tac_cap_m": float(t.tac_cap_m), "boy_m": float(t.boy_m)},
                       "geometry": to_wgs(t.geometry)} for t in st.trees[st.trees["yeni"]].itertuples()]},
        "new_tree_crowns": {"type": "FeatureCollection", "features": [{"type": "Feature", "properties": {},
                             "geometry": to_wgs(t.geometry.buffer(t.tac_cap_m / 2, 16))} for t in st.trees[st.trees["yeni"]].itertuples()]},
        "new_shade": {"type": "Feature", "properties": {}, "geometry": to_wgs(new_shade)},
        "scenario_shade": {"type": "Feature", "properties": {}, "geometry": to_wgs(ks["geoms"]["shadow"])},
        "base_shade": {"type": "Feature", "properties": {}, "geometry": to_wgs(kb["geoms"]["shadow"])},
        "intervention_areas": {"type": "FeatureCollection", "features": [{"type": "Feature", "properties": {"type": t, "label": INTERVENTIONS.get(t, t)},
                                "geometry": to_wgs(g)} for t, g in info["areas"]]},
        "structures": {"type": "FeatureCollection", "features": [{"type": "Feature", "properties": {"height": s["height"], "opacity": s["opacity"], "kind": s["kind"]},
                        "geometry": to_wgs(s["geometry"])} for s in st.structures]},
        "affected_paths": {"type": "FeatureCollection", "features": [{"type": "Feature", "properties": {"from": p["from"], "to": p["to"], "dist_m": p["dist_m"], "shaded_pct": p["shaded_pct"]},
                            "geometry": to_wgs(p["geometry"])} for p in affected_paths]},
        "transfer_paths": {"type": "FeatureCollection", "features": [{"type": "Feature", "properties": {"from": p["from"], "to": p["to"], "pair": p["pair"], "dist_m": p["dist_m"], "shaded_pct": p["shaded_pct"]},
                            "geometry": to_wgs(p["geometry"])} for p in ts["paths"] if p["geometry"] is not None]},
        "routes": {"type": "FeatureCollection", "features": [{"type": "Feature", "properties": {"name": r["name"], "length_m": r["length_m"], "shaded_pct": r["shaded_pct"]},
                    "geometry": to_wgs(r["geometry"])} for r in ts["routes"]]},
        "analysis_area": {"type": "Feature", "properties": {}, "geometry": to_wgs(A)},
        "changed_surfaces": {"type": "FeatureCollection", "features": [{"type": "Feature", "properties": {"sinif": r.sinif, "ad": r.ad},
                              "geometry": to_wgs(r.geometry)} for r in st.surfaces[st.surfaces["degisti"]].itertuples()]},
    }
    return {
        "scenario": {k: v for k, v in sc.items() if k != "results"},
        "base_label": base.label, "time": time_iso, "sun": ks["sun"], "area_m2": ks["area_m2"],
        "kpis_base": kb["kpis"] + tb["kpis"], "kpis_scenario": ks["kpis"] + ts["kpis"], "deltas": deltas,
        "symbols": {k: symbol(deltas.get(k), _num(base_k.get(k, {}).get("value")),
                              "worse" if k in ("sert_oran", "gunes_acik_sert_m2", "aktarma_ort_mesafe") else "better")
                    for k in deltas},
        "literature_effects": lit, "narrative": narrative, "impacts": imp, "log": info["log"], "warnings": info["warnings"],
        "notes": st.notes + [
            "Bu senaryo tarihsel/varsayımsal meteorolojik koşullar üzerinden çalıştırılmıştır: meteorolojik veri bulunmadığından yalnızca güneş geometrisi kullanılmıştır."],
        "methods": methods, "confidence": confidence, "geoms": geoms,
    }
