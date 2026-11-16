"""Underground utility lines clipped to the study area (used to flag tree-planting conflicts)."""
import json

import geopandas as gpd
import pandas as pd

from config import CRS_TM30, CRS_WEB, GPKG, PROCESSED, RAW, WEB

SOURCES = [
    ("İSKİ atıksu", "2_8_Altyapi_Verileri/2_8_3_İSKİ/MEVCUT ATIKSU/SHP/MEVCUT_ATIKSU.shp", ("SEBEK", "S_AKI", "ATIKSU_I")),
    ("İSKİ yağmursuyu", "2_8_Altyapi_Verileri/2_8_3_İSKİ/MEVCUT YAĞMUR SUYU/SHP/MEVCUT_YAGMURSUYU.shp", ("SEBEKE", "S_AKIS", "T_AKIS", "YAGMURSUYU_I")),
    ("İSKİ içmesuyu", "2_8_Altyapi_Verileri/2_8_3_İSKİ/MEVCUT İÇME SUYU/SHP/MEVCUT_ICMESUYU.shp", ("ICMESUYU_AKI", "ICMESUYU_HAT", "ISU_SANAL_SU", "SUB")),
    ("İGDAŞ doğalgaz", "2_8_Altyapi_Verileri/2_8_2_İGDAŞ/SHP/IGDAS.shp", ("Gaz_", "CBS_PE", "CBS_Servis")),
    ("AYEDAŞ elektrik", "2_8_Altyapi_Verileri/2_8_1_AYEDAŞ/SHP/AYEDAS.shp", ("Hat-Kablo",)),
]


def main():
    boundary = gpd.read_file(GPKG, layer="boundary").geometry.iloc[0]
    clip = boundary.buffer(20)
    parts = []
    for name, rel, keys in SOURCES:
        g = gpd.read_file(RAW / rel, bbox=clip.bounds).set_crs(CRS_TM30, allow_override=True)
        g = g[g["Layer"].astype(str).apply(lambda l: any(k in l for k in keys))]
        g = g[g.intersects(clip)]
        g["geometry"] = g.geometry.intersection(clip)
        g = g[~g.is_empty & g.geom_type.isin(["LineString", "MultiLineString"])]
        parts.append(gpd.GeoDataFrame({"kurum": name, "katman": g["Layer"].astype(str)}, geometry=g.geometry.values, crs=CRS_TM30))
        print(name, len(g))
    inf = gpd.GeoDataFrame(pd.concat(parts, ignore_index=True), crs=CRS_TM30)
    inf.to_file(GPKG, layer="infrastructure", driver="GPKG")
    (WEB / "infrastructure.geojson").write_text(inf.to_crs(CRS_WEB).to_json(drop_id=True), encoding="utf-8")
    meta_path = PROCESSED / "layers.json"
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    meta["infrastructure"] = {"title": "Yer altı altyapı hatları", "group": "Kısıtlar", "method": "data",
                              "source": "İSKİ (atıksu, yağmursuyu, içmesuyu), İGDAŞ, AYEDAŞ SHP — hat katmanları", "date": "bilinmiyor",
                              "count": len(inf), "notes": "Sembol, baca ve yardımcı çizimler hariç tutulmuştur; derinlik bilgisi yoktur."}
    meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
