"""Water (sea) polygon for the context area, used to keep walking paths and road-vehicle lines on land.

Sources: the 01_PLN 'on deniz' hatch (project drawing) ∪ open water classified from the orthophoto
(dark, green/blue-tinted pixels; ~12 m opening and components ≥ 50,000 m² only, so streets and shadows are not taken as sea).
Piers (00_HH HH_HID_ISKELE) are cut out of the water so they stay walkable.
"""
import json

import geopandas as gpd
import numpy as np
import rasterio
from rasterio import features
from rasterio.warp import Resampling, reproject
from scipy import ndimage
from shapely.geometry import shape
from shapely.ops import unary_union

import cadgeom
import dwgjson
from config import CAD, CRS_TM30, CRS_WEB, GPKG, PROCESSED, RASTERS, WEB


def main():
    b = gpd.read_file(GPKG, layer="boundary").geometry.iloc[0]
    land = gpd.read_file(GPKG, layer="land").geometry.iloc[0]
    x0, y0, x1, y1 = b.buffer(1500).bounds
    res = 1.0
    w, h = int((x1 - x0) / res), int((y1 - y0) / res)
    tr = rasterio.transform.from_origin(x0, y1, res, res)
    rgb = np.zeros((3, h, w), "float32")
    with rasterio.open(RASTERS / "ortho.tif") as o:
        for i in range(3):
            reproject(rasterio.band(o, i + 1), rgb[i], dst_transform=tr, dst_crs=CRS_TM30, resampling=Resampling.average, dst_nodata=0)
    R, G, B = rgb
    valid = (R + G + B) > 10
    # sea is dark and slightly green/blue-tinted (G ≥ R + 3, B ≥ R + 2); dark asphalt and shadows are neutral or reddish.
    water = valid & ((R + G + B) / 3 < 95) & (G >= R + 3) & (B >= R + 2)
    # a ~12 m opening cuts narrow streets/shadows loose from the open sea; only large connected water bodies are kept
    water = ndimage.binary_opening(water, structure=np.ones((3, 3)), iterations=6)
    lab, n = ndimage.label(water)
    sizes = ndimage.sum(water, lab, range(1, n + 1))
    keep = np.isin(lab, np.nonzero(sizes * res * res >= 50000)[0] + 1)
    keep = ndimage.binary_closing(keep, structure=np.ones((3, 3)), iterations=4)
    polys = [shape(s) for s, v in features.shapes(keep.astype("uint8"), mask=keep, transform=tr) if v == 1]
    ortho_water = unary_union(polys).buffer(1).buffer(-1)

    E = dwgjson.load(CAD / "plan.json", CAD / "plan.pkl")["entities"]
    sea = [g for e in E if e["block"] == "01_PLN" and e["type"] == "HATCH" and e["layer"].endswith("on deniz")
           for g in cadgeom.hatch_polygons(e, (x0, y0, x1, y1))]
    piers = [cadgeom.to_polygon(e) for e in E if e["block"] == "00_HH" and e["layer"].endswith("HH_HID_ISKELE")]
    piers = unary_union([p for p in piers if p is not None and p.area > 30])
    water_all = unary_union([ortho_water, *sea]).difference(land.buffer(-1)).difference(piers.buffer(2))
    g = gpd.GeoDataFrame({"ad": ["Deniz / su"], "alan_m2": [round(water_all.area)]}, geometry=[water_all], crs=CRS_TM30)
    g.to_file(GPKG, layer="water", driver="GPKG")
    gpd.GeoDataFrame({"ad": ["İskeleler"]}, geometry=[piers], crs=CRS_TM30).to_file(GPKG, layer="piers", driver="GPKG")
    # road-vehicle lines must not run over the sea: drop the parts inside the water polygon (5 m inset so quay roads stay whole)
    inner = water_all.buffer(-5)
    clipped = {}
    from build_layers import read_shp
    from config import RAW
    ctx = b.buffer(1500)
    originals = {
        "bus_routes": lambda: gpd.read_file(RAW / "2_9_Ulasım_Verileri/2_9_1_İETT/SHP/GUZERGAH.shp").to_crs(CRS_TM30)[["OBJECTID", "geometry"]],
        "minibus_lines": lambda: gpd.read_file(RAW / "2_9_Ulasım_Verileri/2_9_2_Taksi_Dolmuş_Hatları/SHP/HATLAR.shp").to_crs(CRS_TM30).rename(columns={"Name": "hat"})[["hat", "geometry"]],
    }
    for lid in ("bus_routes", "minibus_lines"):
        lg = originals[lid]()
        lg = lg[lg.intersects(ctx)]
        lg["geometry"] = lg.geometry.intersection(ctx.buffer(1500))
        before = lg.length.sum()
        lg["geometry"] = lg.geometry.difference(inner)
        lg = lg[~lg.is_empty]
        clipped[lid] = round((before - lg.length.sum()) / 1000, 2)
        lg.to_file(GPKG, layer=lid, driver="GPKG")
        (WEB / f"{lid}.geojson").write_text(lg.to_crs(CRS_WEB).to_json(drop_id=True), encoding="utf-8")
    meta_path = PROCESSED / "layers.json"
    m = json.loads(meta_path.read_text(encoding="utf-8"))
    m["water"] = {"title": "Deniz (yürüme ve kara ulaşımı dışı)", "group": "Temel", "method": "data",
                  "source": "01_PLN 'on deniz' taraması ∪ ortofoto su sınıflaması (yeşil-mavi ton, ≥50.000 m² bileşenler); iskeleler hariç", "date": "—",
                  "notes": "Yürüme ızgarası ve kara taşıtı hatları bu poligonla sınırlandırılır."}
    for lid, km in clipped.items():
        if km > 0.05:
            m[lid]["notes"] = (m[lid].get("notes", "") + f" Deniz üzerindeki {km} km'lik kısım çıkarıldı.").strip()
    meta_path.write_text(json.dumps(m, ensure_ascii=False, indent=1), encoding="utf-8")
    print("clipped km", clipped)
    print("water m2", round(water_all.area), "piers", round(piers.area))


if __name__ == "__main__":
    main()
