"""Key performance indicators for a state inside an analysis area.

Every KPI carries `method` ∈ {data, geometric, literature, assumption, model} and an `explain`
block (data source, date, parameters, formula, literature, assumptions, uncertainty) so the UI can
answer "Bu sonuç nasıl hesaplandı?". No temperature is produced here: thermal statements are made
in scenario.py, only from verified literature ranges.
"""
from functools import lru_cache

import geopandas as gpd
import numpy as np
import shapely
from shapely.geometry import LineString
from shapely.ops import unary_union
from shapely.validation import make_valid

from . import network, shadow
from .data import CRS, assumption, land, layer, layers_meta
from .state import State, albedo_range

ORTHO_NOTE = "Ortofoto çekim tarihi bilinmiyor"


def _area(g):
    return float(g.area) if g is not None and not g.is_empty else 0.0


def _pct(a, b):
    return round(100.0 * a / b, 2) if b > 0 else None


def kpi(id_, label, value, unit, method, explain, group="Kentsel tasarım"):
    return {"id": id_, "label": label, "value": value, "unit": unit, "method": method, "group": group, "explain": explain}


def explain(source, date, params, formula, literature=None, assumptions=None, uncertainty=""):
    return {"veri_kaynagi": source, "veri_tarihi": date, "parametre": params, "formul": formula,
            "literatur": literature or [], "varsayim": assumptions or [], "belirsizlik": uncertainty}


def state_shadow(state: State, time_iso: str, area):
    sun = shadow.sun_position(time_iso)
    if sun["elevation"] <= 0:
        return sun, shapely.Polygon(), []
    near = area.buffer(300)
    b = state.buildings[state.buildings.intersects(near)]
    t = state.trees[state.trees.intersects(near.buffer(30))]
    parts = [shadow.building_shadows(b, sun), shadow.trees_shadows(t, sun)]
    structs = shadow.structures_shadows([(s["geometry"], s["height"], s["opacity"]) for s in state.structures], sun)
    # structures with opacity < 1 are reported separately as partial shade
    opaque = [g for g, op in structs if op >= 0.999]
    partial = [(g, op) for g, op in structs if op < 0.999]
    sh = make_valid(shapely.union_all([p for p in parts + opaque if not p.is_empty])) if any(not p.is_empty for p in parts + opaque) else shapely.Polygon()
    return sun, sh, partial


def compute(state: State, area, time_iso: str, raster_value=None):
    meta = layers_meta()
    L = make_valid(area.intersection(land()))
    S = state.surfaces[state.surfaces.intersects(L)]
    cls = {c: make_valid(shapely.union_all(g.geometry.intersection(L).values)) for c, g in S.groupby("sinif")}
    a_land = _area(L)
    a_bina = _area(cls.get("bina"))
    a_su = _area(cls.get("su"))
    open_ = make_valid(L.difference(shapely.union_all([g for k, g in cls.items() if k in ("bina", "su")] or [shapely.Polygon()])))
    a_open = _area(open_)
    a_yesil = _area(cls.get("yesil"))
    a_gec = _area(cls.get("gecirgen"))
    hard = shapely.union_all([g for k, g in cls.items() if k in ("sert", "asfalt")] or [shapely.Polygon()])
    a_hard = _area(hard)
    # permeable flag can also be set on paved classes (permeable paving scenario)
    perm_paved = S[S["gecirgen"] & S["sinif"].isin(["sert", "asfalt"])]
    a_perm_paved = _area(make_valid(shapely.union_all(perm_paved.geometry.intersection(L).values))) if len(perm_paved) else 0.0

    trees_in = state.trees[state.trees.within(L)]
    crowns = shapely.union_all([p.buffer(d / 2, 12) for p, d in zip(state.trees.geometry, state.trees["tac_cap_m"])]) if len(state.trees) else shapely.Polygon()
    a_crown = _area(make_valid(crowns).intersection(open_))

    sun, sh, partial = state_shadow(state, time_iso, L)
    sh_open = make_valid(sh.intersection(open_))
    a_sh = _area(sh_open)
    a_partial = sum(_area(make_valid(g.intersection(open_).difference(sh_open))) * op for g, op in partial)
    exposed_hard = make_valid(hard.difference(sh))
    a_exposed = _area(exposed_hard) - sum(_area(make_valid(g.intersection(exposed_hard))) * op for g, op in partial)

    # albedo: only surfaces whose material has a verified range (or a user-specified value)
    alb_area, alb_lo, alb_hi = 0.0, 0.0, 0.0
    for _, r in S[S["sinif"].isin(["sert", "asfalt"])].iterrows():
        a = _area(r.geometry.intersection(L))
        if r.get("albedo") is not None and not (isinstance(r.get("albedo"), float) and np.isnan(r.get("albedo"))):
            lo = hi = float(r["albedo"])
        else:
            rng = albedo_range(str(r.get("malzeme", "")))
            if not rng:
                continue
            lo, hi = rng
        alb_area += a; alb_lo += a * lo; alb_hi += a * hi

    surf_src = meta.get("surfaces_existing" if state.base == "mevcut" else "surfaces_project", {}).get("source", "")
    if state.key not in ("mevcut", "proje"):
        surf_src += " + senaryo müdahaleleri (kullanıcı tanımlı)"
    a_veg = assumption("veg_threshold")
    hard_ass = assumption("hard_surface_impervious")
    sh_ass = [assumption("flat_terrain_shadow"), assumption("opaque_canopy"), assumption("tree_crown_shape"), assumption("storey_height")]
    ks = []
    ks.append(kpi("alan", "Analiz alanı (kara)", round(a_land), "m²", "geometric",
                  explain("Çalışma alanı sınırı, kara maskesi", "—", "—", "alan(seçili alan ∩ kara)")))
    ks.append(kpi("yesil_oran", "Yeşil alan oranı", _pct(a_yesil, a_open), "%", "data",
                  explain(surf_src, ORTHO_NOTE, f"ExG eşiği {a_veg['deger']}", "alan(yeşil) / alan(açık zemin) × 100",
                          assumptions=[a_veg], uncertainty="Ortofoto RGB indeksi gölgede kalan bitkiyi kaçırabilir; çim/çalı ayrımı yapılmaz.")))
    ks.append(kpi("yesil_m2", "Yeşil alan", round(a_yesil), "m²", "data",
                  explain(surf_src, ORTHO_NOTE, "—", "alan(yeşil ∩ analiz alanı)")))
    ks.append(kpi("gecirgen_oran", "Geçirgen yüzey oranı", _pct(a_yesil + a_gec + a_perm_paved, a_open), "%", "geometric",
                  explain(surf_src, ORTHO_NOTE, "geçirgen = yeşil ∪ ağaç kabuğu ∪ geçirgen kaplama",
                          "alan(geçirgen) / alan(açık zemin) × 100", assumptions=[hard_ass])))
    ks.append(kpi("sert_oran", "Sert zemin oranı", _pct(a_hard - a_perm_paved, a_open), "%", "geometric",
                  explain(surf_src, ORTHO_NOTE, "sert = sert zemin ∪ asfalt − geçirgen kaplama",
                          "alan(sert) / alan(açık zemin) × 100", assumptions=[hard_ass],
                          uncertainty="Mevcut durumda sert zemin, kalan alan olarak türetilmiştir.")))
    ks.append(kpi("bina_oran", "Yapı izi oranı", _pct(a_bina, a_land), "%", "data",
                  explain("Halihazır bina poligonları / proje yapıları", "bilinmiyor", "—", "alan(bina) / alan(kara) × 100")))
    ks.append(kpi("agac_sayisi", "Ağaç sayısı", int(len(trees_in)), "adet", "data",
                  explain(meta.get("trees", {}).get("source", ""), "2020-06", "—", "sayı(ağaç ∈ alan)",
                          uncertainty=meta.get("trees", {}).get("notes", ""))))
    ks.append(kpi("agac_yogunluk", "Ağaç yoğunluğu", round(len(trees_in) / (a_open / 10000), 1) if a_open > 0 else None, "adet/ha", "geometric",
                  explain(meta.get("trees", {}).get("source", ""), "2020-06", "—", "ağaç sayısı / açık zemin (ha)")))
    ks.append(kpi("agac_tac_oran", "Ağaç taç örtüsü oranı", _pct(a_crown, a_open), "%", "geometric",
                  explain("Ağaç rölevesi taç çapları", "2020-06", "taç = daire (çap rölöveden)", "alan(∪ taç ∩ açık zemin) / alan(açık zemin) × 100")))
    sun_txt = f"güneş yüksekliği {sun['elevation']:.1f}°, azimut {sun['azimuth']:.1f}° ({time_iso}, pvlib SPA)"
    ks.append(kpi("golge_oran", "Gölgeli alan oranı", _pct(a_sh + a_partial, a_open), "%", "geometric",
                  explain("Bina yükseklikleri (halihazır), ağaç boy/taç (rölöve), gölgeleme elemanları (senaryo)", "—", sun_txt,
                          "alan(gölge ∩ açık zemin) / alan(açık zemin) × 100; kısmi gölgeleme elemanı opaklık oranıyla ağırlıklandırılır",
                          assumptions=sh_ass, uncertainty="Gölge, yatay zemin varsayımıyla ve meteorolojik koşul (bulutluluk) dikkate alınmadan hesaplanmıştır."),
                  group="Gölge"))
    ks.append(kpi("golgeli_yaya_m2", "Gölgeli yaya (açık zemin) alanı", round(a_sh + a_partial), "m²", "geometric",
                  explain("Gölge hesabı", "—", sun_txt, "alan(gölge ∩ (kara − bina − su))", assumptions=sh_ass,
                          uncertainty="Açık zeminin tamamı yaya kullanımına açık kabul edilmiştir (taşıt yolları ayrıştırılamadı)."),
                  group="Gölge"))
    ks.append(kpi("gunes_acik_sert_m2", "Güneşe açık sert zemin (ısı maruziyeti vekili)", round(max(a_exposed, 0)), "m²", "geometric",
                  explain("Yüzey sınıfları + gölge hesabı", "—", sun_txt, "alan(sert zemin − gölge)", assumptions=sh_ass + [hard_ass],
                          uncertainty="Bu bir sıcaklık değeri değildir; güneş alan geçirimsiz yüzeyin geometrik büyüklüğüdür."),
                  group="Isı"))
    if alb_area > 0:
        ks.append(kpi("albedo", "Alan ağırlıklı albedo (tanımlı yüzeylerde)", f"{alb_lo / alb_area:.2f}–{alb_hi / alb_area:.2f}", "—", "literature",
                      explain("Malzeme sınıfı (CAD/senaryo)", "—", "Albedo aralıkları: params.yaml", "Σ(alan × albedo) / Σ alan",
                              literature=["santamouris2013"], uncertainty=f"Yalnızca sert zeminin %{_pct(alb_area, a_hard)}'ında malzeme albedosu tanımlıdır."),
                      group="Isı"))
    else:
        ks.append(kpi("albedo", "Alan ağırlıklı albedo", "Literatür parametresi tanımlanmamış", "—", "literature",
                      explain("Malzeme sınıfı", "—", "—", "—", uncertainty="Bu alandaki sert zemin malzemeleri için doğrulanmış albedo değeri yoktur."),
                      group="Isı"))
    ks.append(kpi("lst", "Yüzey sıcaklığı (uydu)", raster_value if raster_value is not None else "Bu analiz için veri bulunmamaktadır", "°C" if raster_value is not None else "—",
                  "data", explain("Yüklenen GeoTIFF ısı haritası" if raster_value is not None else "—", "raster metaverisi", "—",
                                  "ortalama(piksel ∈ alan)" if raster_value is not None else "—",
                                  uncertainty="Uydu LST'si yüzey (deri) sıcaklığıdır; hava sıcaklığı veya termal konfor değildir."), group="Isı"))
    ks.append(kpi("termal_konfor", "Termal konfor (Tmrt / UTCI / PET)", "Model çalıştırılmadı", "—", "model",
                  explain("—", "—", "—", "—", uncertainty="Meteorolojik veri ve fiziksel mikroklima modeli (ör. SOLWEIG) bulunmadığından hesaplanmamıştır. "
                          "Senaryo sonuçlarında yalnızca literatür tabanlı etki aralıkları verilir."), group="Isı"))
    geoms = {"shadow": sh_open, "exposed_hard": exposed_hard}
    return {"area_m2": round(a_land), "sun": sun, "kpis": ks, "geoms": geoms,
            "raw": {"a_open": a_open, "a_sh": a_sh + a_partial, "a_yesil": a_yesil, "a_hard": a_hard, "a_crown": a_crown,
                    "a_exposed": a_exposed, "n_trees": len(trees_in), "a_gec": a_gec + a_perm_paved}}


# --------------------------------------------------------------------------------------- transport
TRANSFER_PAIRS = [("iskele", "metro"), ("iskele", "otobus"), ("metro", "otobus"), ("iskele", "minibus"), ("metro", "minibus")]


def transfer_paths(extra=None):
    tp = layer("transfer_points")
    pts = [(r.tur, r.ad, r.geometry.x, r.geometry.y) for r in tp.itertuples()]
    for e in extra or []:
        pts.append((e["tur"], e["ad"], e["x"], e["y"]))
    paths = []
    for a, b in TRANSFER_PAIRS:
        A = [p for p in pts if p[0] == a]; B = [p for p in pts if p[0] == b]
        for pa in A:
            res = network.distances_from(pa[2], pa[3], [(q[2], q[3]) for q in B])
            best = min(((d, xy, q) for (d, xy), q in zip(res, B) if d is not None), default=None, key=lambda t: t[0])
            if best:
                paths.append({"from": pa[1], "to": best[2][1], "pair": f"{a}→{b}", "dist_m": round(best[0]),
                              "geometry": LineString(best[1]) if len(best[1]) > 1 else None})
    return paths


@lru_cache(maxsize=8)
def _base_paths_cached():
    return transfer_paths()


def transport_kpis(state: State, time_iso: str, area):
    paths = transfer_paths(state.extra_transfer) if state.extra_transfer else _base_paths_cached()
    sun, sh, partial = state_shadow(state, time_iso, area.buffer(200).union(shapely.union_all([p["geometry"] for p in paths if p["geometry"] is not None])))
    out = []
    tot, shaded = 0.0, 0.0
    for p in paths:
        g = p["geometry"]
        if g is None:
            continue
        s = g.intersection(sh).length
        out.append({**p, "shaded_pct": round(100 * s / g.length, 1) if g.length else 0, "geometry": g})
        tot += g.length; shaded += s
    routes = []
    for i, r in enumerate(state.routes):
        s = r.intersection(sh).length
        routes.append({"name": f"Önerilen güzergâh {i + 1}", "length_m": round(r.length), "shaded_pct": round(100 * s / r.length, 1) if r.length else 0, "geometry": r})
    mean_d = round(float(np.mean([p["dist_m"] for p in out])), 0) if out else None
    ex = explain("Aktarma noktaları (CAD kümeleme + DURAKLAR.shp), yürünebilir yüzey (kara − bina)", "bilinmiyor",
                 "2 m maliyet ızgarası, 8-komşuluk", "en kısa yol (MCP_Geometric) her A noktasından en yakın B türü noktaya",
                 uncertainty="Taşıt yolları ayrıştırılamadığı için mesafeler iyimser alt sınırdır; T3 tramvay durakları veride yoktur.")
    ks = [kpi("aktarma_ort_mesafe", "Ortalama aktarma yürüme mesafesi", mean_d, "m", "geometric", ex, group="Ulaşım"),
          kpi("aktarma_golge", "Aktarma güzergâhlarının gölgeli payı", round(100 * shaded / tot, 1) if tot else None, "%", "geometric",
              explain("Aktarma güzergâhları + gölge hesabı", "—", f"güneş yüksekliği {sun['elevation']:.1f}°",
                      "uzunluk(güzergâh ∩ gölge) / uzunluk(güzergâh) × 100"), group="Ulaşım")]
    for r in routes:
        ks.append(kpi(f"rota_{r['name']}", f"{r['name']} uzunluğu", r["length_m"], "m", "geometric",
                      explain("Kullanıcının çizdiği güzergâh", "—", "—", "uzunluk(çizgi)"), group="Ulaşım"))
        ks.append(kpi(f"rota_golge_{r['name']}", f"{r['name']} gölgeli payı", r["shaded_pct"], "%", "geometric",
                      explain("Güzergâh + gölge hesabı", "—", "—", "uzunluk(güzergâh ∩ gölge) / uzunluk × 100"), group="Ulaşım"))
    return {"kpis": ks, "paths": out, "routes": routes}
