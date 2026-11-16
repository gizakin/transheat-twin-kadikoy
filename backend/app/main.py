"""TRANSHEAT TWIN API.

Run:  .venv/Scripts/python -m uvicorn backend.app.main:app --port 8000   (from the project root)
The built frontend (frontend/dist) is served at "/" when present.
"""
import json
import shutil
import tempfile
import traceback
from datetime import datetime
from pathlib import Path

import shapely
from fastapi import FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, PlainTextResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .core import kpi as K
from .core import ingest, rasters, report, scenario, shadow, store
from .core.data import ROOT, UPLOADS, WEB, boundary, layer, layers_meta, literature
from .core.state import base_state

app = FastAPI(title="TRANSHEAT TWIN API", version="0.1.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

ACTIVE_HEAT = {"id": None}  # uploaded raster used as the heat layer for zonal statistics


def _heat_fn():
    u = store.get_upload(ACTIVE_HEAT["id"]) if ACTIVE_HEAT["id"] else None
    if not u:
        return None
    return lambda g: rasters.zonal_mean(u["path"], g)


@app.exception_handler(Exception)
async def err(_, exc):
    traceback.print_exc()
    return JSONResponse({"detail": str(exc)}, status_code=500)


# ------------------------------------------------------------------------------------------ catalogue
@app.get("/api/layers")
def layers():
    meta = layers_meta()
    out = []
    for lid, m in meta.items():
        if (WEB / f"{lid}.geojson").exists():
            out.append({"id": lid, **m, "url": f"/api/layers/{lid}.geojson"})
        elif m.get("kind") == "raster":
            out.append({"id": lid, **{k: v for k, v in m.items() if k not in ("corners_tm30", "fit")}, "url": None})
    for u in store.list_uploads():
        out.append({"id": f"upload_{u['id']}", "title": u["name"], "group": "Yüklenen veriler", "method": "data",
                    "source": f"Kullanıcı yüklemesi ({u['metadata'].get('dosya')})", "date": u["created_at"], "kind": u["kind"],
                    "url": f"/api/uploads/{u['id']}/data" if u["kind"] == "vector" else None,
                    "tiles": f"/api/tiles/upload/{u['id']}/{{z}}/{{x}}/{{y}}.png" if u["kind"] == "raster" else None,
                    "metadata": {k: v for k, v in u["metadata"].items() if not k.startswith("_")}})
    return out


@app.get("/api/layers/{lid}.geojson")
def layer_geojson(lid: str):
    p = WEB / f"{lid}.geojson"
    if not p.exists():
        raise HTTPException(404, "Katman yok")
    return FileResponse(p, media_type="application/geo+json")


@app.get("/api/literature")
def lit():
    return literature()


# ------------------------------------------------------------------------------------------ states & KPIs
@app.get("/api/sun")
def sun(time: str = "2026-07-15T14:00"):
    return shadow.sun_position(time)


@app.get("/api/state/{key}/kpis")
def state_kpis(key: str, time: str = "2026-07-15T14:00"):
    st = base_state(key)
    r = K.compute(st, boundary(), time, _heat_fn()(boundary()) if _heat_fn() else None)
    t = K.transport_kpis(st, time, boundary())
    return {"label": st.label, "notes": st.notes, "sun": r["sun"], "area_m2": r["area_m2"], "kpis": r["kpis"] + t["kpis"],
            "shadow": scenario.to_wgs(r["geoms"]["shadow"]),
            "transfer_paths": {"type": "FeatureCollection", "features": [
                {"type": "Feature", "properties": {k: v for k, v in p.items() if k != "geometry"}, "geometry": scenario.to_wgs(p["geometry"])}
                for p in t["paths"] if p["geometry"] is not None]}}


@app.get("/api/state/{key}/surfaces")
def state_surfaces(key: str):
    lid = {"mevcut": "surfaces_existing", "proje": "surfaces_project"}[key]
    return FileResponse(WEB / f"{lid}.geojson", media_type="application/geo+json")


@app.get("/api/state/{key}/shade_profile")
def shade_profile(key: str, date: str = "2026-07-15"):
    st = base_state(key)
    out = []
    for h in range(6, 21):
        t = f"{date}T{h:02d}:00"
        r = K.compute(st, boundary(), t)
        k = {x["id"]: x["value"] for x in r["kpis"]}
        out.append({"time": t, "elevation": r["sun"]["elevation"], "golge_oran": k["golge_oran"], "gunes_acik_sert_m2": k["gunes_acik_sert_m2"]})
    return out


@app.post("/api/select")
def select(payload: dict):
    """Describe a selected / drawn area: area, surface mix, shade — the 'Seçilen alan' card."""
    g = scenario.to_tm(payload["geometry"])
    st = base_state(payload.get("base", "mevcut"))
    r = K.compute(st, g, payload.get("time", "2026-07-15T14:00"), _heat_fn()(g) if _heat_fn() else None)
    mix = []
    S = st.surfaces[st.surfaces.intersects(g)]
    for (c, ad), grp in S.groupby(["sinif", "ad"]):
        a = float(shapely.union_all(grp.geometry.intersection(g).values).area)
        if a > 0.5:
            mix.append({"sinif": c, "ad": ad, "alan_m2": round(a), "malzeme": str(grp["malzeme"].iloc[0])})
    mix.sort(key=lambda m: -m["alan_m2"])
    return {"area_m2": r["area_m2"], "kpis": r["kpis"], "surface_mix": mix, "sun": r["sun"]}


# ------------------------------------------------------------------------------------------ scenarios
class ScenarioIn(BaseModel):
    definition: dict
    area: dict | None = None


@app.post("/api/scenario/run")
def run_scenario(body: ScenarioIn):
    return scenario.run(body.definition, body.area, _heat_fn())


@app.get("/api/interventions")
def interventions():
    return {"types": scenario.INTERVENTIONS, "materials": {k: v[0] for k, v in scenario.MATERIALS.items()}}


@app.get("/api/scenarios")
def scenarios_list():
    return store.list_scenarios()


@app.post("/api/scenarios")
def scenarios_save(body: ScenarioIn):
    res = scenario.run(body.definition, body.area, _heat_fn())
    d = store.save_scenario({**body.definition, "analysis_method": res["methods"], "source": body.definition.get("source", "user_defined")}, res)
    return {"definition": d, "results": res}


@app.get("/api/scenarios/{sid}")
def scenarios_get(sid: str):
    s = store.get_scenario(sid)
    if not s:
        raise HTTPException(404)
    return s


@app.delete("/api/scenarios/{sid}")
def scenarios_delete(sid: str):
    store.delete_scenario(sid)
    return {"ok": True}


@app.get("/api/scenarios/{sid}/json")
def scenarios_json(sid: str):
    s = store.get_scenario(sid)
    return Response(json.dumps(s["definition"], ensure_ascii=False, indent=2), media_type="application/json",
                    headers={"Content-Disposition": f'attachment; filename="senaryo_{sid}.json"'})


class CompareIn(BaseModel):
    ids: list[str]
    time: str = "2026-07-15T14:00"


_cmp_cache: dict = {}


def _site_kpis(st, time):
    key = (st.key, time)
    if st.key in ("mevcut", "proje") and key in _cmp_cache:
        return _cmp_cache[key]
    r = K.compute(st, boundary(), time, _heat_fn()(boundary()) if _heat_fn() else None)
    t = K.transport_kpis(st, time, boundary())
    out = r["kpis"] + t["kpis"]
    if st.key in ("mevcut", "proje"):
        _cmp_cache[key] = out
    return out


@app.post("/api/compare")
def compare(body: CompareIn):
    """All columns on the same area (whole study site) and the same time, so values are comparable."""
    cols = [{"id": "mevcut", "name": "Mevcut", "kind": "state", "kpis": _site_kpis(base_state("mevcut"), body.time), "confidence": "Yüksek"},
            {"id": "proje", "name": "Proje", "kind": "state", "kpis": _site_kpis(base_state("proje"), body.time), "confidence": "Orta",
             "note": "Proje yüzeyleri CAD taramaları ve desen çizgilerinden çıkarılmıştır."}]
    for sid in body.ids:
        s = store.get_scenario(sid)
        if not s:
            continue
        d = s["definition"]
        st, _ = scenario.apply(base_state(d.get("base", "mevcut")), d)
        cols.append({"id": sid, "name": d.get("scenario_name", sid), "kind": "scenario", "base": d.get("base"),
                     "kpis": _site_kpis(st, body.time), "confidence": s["results"].get("confidence"),
                     "literature_effects": s["results"].get("literature_effects", []), "narrative": s["results"].get("narrative", [])})
    ref = {k["id"]: k for k in cols[0]["kpis"]}
    for c in cols[1:]:
        c["symbols"] = {}
        for k in c["kpis"]:
            a, b = scenario._num(ref.get(k["id"], {}).get("value")), scenario._num(k["value"])
            d = (b - a) if a is not None and b is not None else None
            c["symbols"][k["id"]] = scenario.symbol(d, a, "worse" if k["id"] in ("sert_oran", "gunes_acik_sert_m2", "aktarma_ort_mesafe") else "better")
    return {"time": body.time, "sun": shadow.sun_position(body.time), "columns": cols,
            "note": "Tüm sütunlar tüm çalışma alanı ve aynı saat için hesaplanmıştır; semboller Mevcut duruma göre göreli değişimdir "
                    "(<%1: 0, %1–10: ±, %10–30: ±±, >%30: ±±±)."}


# ------------------------------------------------------------------------------------------ report
def _results(ids):
    out = []
    for sid in ids.split(","):
        s = store.get_scenario(sid)
        if s:
            out.append(s["results"])
    if not out:
        raise HTTPException(400, "Rapor için en az bir kayıtlı senaryo seçin.")
    return out


@app.get("/api/report", response_class=HTMLResponse)
def report_html(ids: str):
    return report.html(_results(ids))


@app.get("/api/report.csv")
def report_csv(ids: str):
    return PlainTextResponse(report.csv_text(_results(ids)), media_type="text/csv; charset=utf-8",
                             headers={"Content-Disposition": 'attachment; filename="transheat_karsilastirma.csv"'})


# ------------------------------------------------------------------------------------------ uploads & rasters
@app.post("/api/upload")
async def upload(file: UploadFile = File(...), crs: str | None = Form(None), use_as_heat: bool = Form(False)):
    d = UPLOADS / datetime.now().strftime("%Y%m%d_%H%M%S_%f")
    d.mkdir(parents=True)
    p = d / Path(file.filename).name
    with open(p, "wb") as f:
        shutil.copyfileobj(file.file, f)
    kind, meta = ingest.ingest(p, file.filename, crs or None)
    gj = meta.pop("_geojson", None)
    if gj:
        (d / "data.geojson").write_text(gj, encoding="utf-8")
    meta["kaynak_kaydi"] = {"yukleme_zamani": datetime.now().isoformat(timespec="seconds"), "orijinal_dosya": file.filename}
    uid = store.add_upload(file.filename, kind, p, meta)
    if kind == "raster" and use_as_heat:
        ACTIVE_HEAT["id"] = uid
    return {"id": uid, "kind": kind, "metadata": meta}


@app.get("/api/uploads")
def uploads():
    return [{**u, "metadata": {k: v for k, v in u["metadata"].items() if not k.startswith("_")}} for u in store.list_uploads()]


@app.get("/api/uploads/{uid}/data")
def upload_data(uid: str):
    u = store.get_upload(uid)
    return FileResponse(Path(u["path"]).parent / "data.geojson", media_type="application/geo+json")


@app.get("/api/uploads/{uid}/file")
def upload_file(uid: str):
    u = store.get_upload(uid)
    return FileResponse(u["path"])


@app.delete("/api/uploads/{uid}")
def upload_delete(uid: str):
    if ACTIVE_HEAT["id"] == uid:
        ACTIVE_HEAT["id"] = None
    store.delete_upload(uid)
    return {"ok": True}


@app.post("/api/heat/{uid}")
def set_heat(uid: str):
    u = store.get_upload(uid)
    if not u or u["kind"] != "raster":
        raise HTTPException(400, "Isı katmanı olarak yalnızca CRS'li GeoTIFF seçilebilir")
    ACTIVE_HEAT["id"] = uid
    return heat()


@app.get("/api/heat")
def heat():
    u = store.get_upload(ACTIVE_HEAT["id"]) if ACTIVE_HEAT["id"] else None
    if not u:
        return {"available": False, "message": "Bu analiz için veri bulunmamaktadır. Uydu tabanlı ısı haritası (GeoTIFF) yükleyin."}
    st = rasters.stats_and_hotspots(u["path"], boundary())
    return {"available": True, "id": u["id"], "name": u["name"], "metadata": {k: v for k, v in u["metadata"].items() if not k.startswith("_")},
            "stats": st, "tiles": f"/api/tiles/upload/{u['id']}/{{z}}/{{x}}/{{y}}.png"}


@app.get("/api/tiles/ortho/{z}/{x}/{y}.png")
def tile_ortho(z: int, x: int, y: int):
    png = rasters.tile(rasters.ortho_path(), z, x, y)
    return Response(png or b"", media_type="image/png", status_code=200 if png else 204,
                    headers={"Cache-Control": "public, max-age=86400"})


@app.get("/api/tiles/insitu/{z}/{x}/{y}.png")
def tile_insitu(z: int, x: int, y: int):
    p = ROOT / "data" / "rasters" / "insitu_plan.tif"
    png = rasters.tile(str(p), z, x, y) if p.exists() else None
    return Response(png or b"", media_type="image/png", status_code=200 if png else 204,
                    headers={"Cache-Control": "public, max-age=86400"})


@app.get("/api/tiles/upload/{uid}/{z}/{x}/{y}.png")
def tile_upload(uid: str, z: int, x: int, y: int, cmap: str = "rdylbu_r"):
    u = store.get_upload(uid)
    st = u["metadata"].get("istatistik") or {}
    png = rasters.tile(u["path"], z, x, y, rescale=(st.get("p2"), st.get("p98")) if st else None, colormap=cmap)
    return Response(png or b"", media_type="image/png", status_code=200 if png else 204)


# ------------------------------------------------------------------------------------------ frontend
DIST = ROOT / "frontend" / "dist"
if DIST.exists():
    app.mount("/", StaticFiles(directory=DIST, html=True), name="ui")
