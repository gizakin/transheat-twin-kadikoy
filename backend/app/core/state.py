"""Urban state = surfaces + trees + buildings + shade structures.

The two reference states are built from processed layers; scenarios are copies with interventions applied.
"""
from dataclasses import dataclass, field

import geopandas as gpd
import pandas as pd
import shapely
from shapely.validation import make_valid

from .data import CRS, layer, lit_param

# albedo ranges per material, only where a verified literature value exists (params.yaml)
MATERIAL_ALBEDO = {
    "asfalt": ("albedo_asfalt_yeni", "albedo_asfalt_eski"),
    "beton": ("albedo_beton_yeni", "albedo_beton_eski"),
}

SURFACE_LABELS = {
    "yesil": "Yeşil alan",
    "gecirgen": "Geçirgen yüzey",
    "sert": "Sert zemin",
    "asfalt": "Asfalt",
    "bina": "Bina / yapı",
    "su": "Su",
}


def albedo_range(material: str):
    ids = MATERIAL_ALBEDO.get(material)
    if not ids:
        return None
    vals = [v for pid in ids for v in (lit_param(pid).get("deger") or [])]
    return (min(vals), max(vals)) if vals else None


@dataclass
class State:
    key: str
    label: str
    surfaces: gpd.GeoDataFrame
    trees: gpd.GeoDataFrame
    buildings: gpd.GeoDataFrame
    structures: list = field(default_factory=list)  # dicts: geometry, height, opacity, kind
    routes: list = field(default_factory=list)      # user-drawn pedestrian routes (LineString, TM30)
    extra_transfer: list = field(default_factory=list)
    notes: list = field(default_factory=list)
    base: str = ""

    def copy(self, key, label):
        return State(key, label, self.surfaces.copy(), self.trees.copy(), self.buildings,
                     [dict(s) for s in self.structures], list(self.routes), list(self.extra_transfer), list(self.notes), self.base)


def _surfaces(lid):
    src = layer(lid)
    s = src[[c for c in ("sinif", "ad", "malzeme", "geometry") if c in src.columns]].copy()
    if "malzeme" not in s.columns:
        s["malzeme"] = s["sinif"].map({"sert": "mevcut sert zemin", "yesil": "mevcut bitkili", "bina": "mevcut bina", "su": "su"})
    s["gecirgen"] = s["sinif"].isin(["yesil", "gecirgen"])
    s["albedo"] = None
    s["degisti"] = False
    return gpd.GeoDataFrame(s, geometry="geometry", crs=CRS)


_cache = {}


def base_state(key: str) -> State:
    if key in _cache:
        return _cache[key]
    trees = layer("trees")[["no", "turkce", "latin", "boy_m", "tac_cap_m", "saglik", "eslesme", "boy_kaynak", "geometry"]].copy()
    trees["yeni"] = False
    b = layer("buildings")
    if key == "mevcut":
        st = State("mevcut", "Mevcut durum", _surfaces("surfaces_existing"), trees, b, base="mevcut")
    elif key == "proje":
        st = State("proje", "Proje durumu (İBB Meydan Düzenleme Projesi)", _surfaces("surfaces_project"), trees, b,
                   notes=["Proje çiziminde ağaç katmanı bulunmadığından mevcut ağaçların korunduğu varsayılmıştır.",
                          "Proje çiziminin kapsamadığı alanlarda mevcut yüzey sınıfları korunmuştur."], base="proje")
    else:
        raise KeyError(key)
    _cache[key] = st
    return st


def apply_surface(state: State, geom, sinif: str, malzeme: str, ad: str, albedo=None, gecirgen=None):
    """Overwrite surfaces inside geom with a new class (buildings and water are never overwritten)."""
    s = state.surfaces
    protected = s["sinif"].isin(["bina", "su"])
    hit = s.intersects(geom) & ~protected
    if not hit.any():
        return 0.0
    new_area = make_valid(shapely.union_all(s.loc[hit].geometry.intersection(geom).values))
    s.loc[hit, "geometry"] = s.loc[hit].geometry.difference(geom)
    s = s[~s.geometry.is_empty]
    row = {"sinif": sinif, "ad": ad, "malzeme": malzeme, "geometry": new_area,
           "gecirgen": bool(gecirgen if gecirgen is not None else sinif in ("yesil", "gecirgen")),
           "albedo": albedo, "degisti": True}
    state.surfaces = gpd.GeoDataFrame(pd.concat([s, gpd.GeoDataFrame([row], crs=CRS)], ignore_index=True), crs=CRS)
    return new_area.area
