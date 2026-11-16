"""Mosaic the 10 orthophoto sheets into one Cloud-Optimized GeoTIFF.

Two sheets carry no usable CRS (G22A01A2A: none, G22A01A1B: TUREF/TM30 on a WGS84 datum label);
their bounds match the neighbouring EPSG:5254 sheets, so EPSG:5254 is assigned explicitly.
"""
import json
import rasterio
from rasterio.merge import merge
from rasterio.vrt import WarpedVRT
from rasterio.enums import Resampling
from rio_cogeo.cogeo import cog_translate
from rio_cogeo.profiles import cog_profiles
from config import RAW, RASTERS, WORK, CRS_TM30

RES = 0.25  # m — 10 cm source is downsampled for the web; analysis does not use ortho pixels directly


def main():
    sheets = sorted((RAW / "2_4_Ortofoto").glob("*.tif"))
    srcs, vrts, log = [], [], []
    for f in sheets:
        s = rasterio.open(f)
        log.append({"file": f.name, "crs": str(s.crs) if s.crs else None, "res": s.res, "bounds": list(s.bounds)})
        v = WarpedVRT(s, src_crs=CRS_TM30, crs=CRS_TM30, resampling=Resampling.average)
        srcs.append(s); vrts.append(v)
    mosaic, transform = merge(vrts, res=RES, resampling=Resampling.average, nodata=0)
    tmp = WORK / "ortho_mosaic_tmp.tif"
    profile = dict(driver="GTiff", height=mosaic.shape[1], width=mosaic.shape[2], count=3, dtype="uint8",
                   crs=CRS_TM30, transform=transform, nodata=0, tiled=True, compress="deflate")
    with rasterio.open(tmp, "w", **profile) as dst:
        dst.write(mosaic)
    out = RASTERS / "ortho.tif"
    prof = cog_profiles.get("jpeg"); prof.update(quality=85)
    cog_translate(tmp, out, prof, web_optimized=True, add_mask=True, quiet=True)
    tmp.unlink()
    (WORK / "ortho_log.json").write_text(json.dumps(log, indent=1, default=str), encoding="utf-8")
    print("ortho ->", out, mosaic.shape)


if __name__ == "__main__":
    main()
