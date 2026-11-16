"""Approximate georeferencing of the INSITU competition entry (sheet 1, 1/2000 plan) for use as an overlay.

The plan raster is placed on the A0 sheet at a nominal 1/2000 scale, which fixes the pixel size. Translation,
a small scale correction and rotation are then found by matching the building footprints drawn in the plan (pure
white blocks) with the surveyed building footprints of the base map (FFT cross-correlation on a 1 m grid).
The fit quality (building-mask IoU in the overlap) is written to the metadata; the overlay is a visual reference
only — no KPI is computed from it.
"""
import io
import json
import math

import numpy as np
import pymupdf
import rasterio
from PIL import Image
from rasterio.transform import Affine
from scipy import ndimage

from config import CRS_TM30, INSITU_PDF, PROCESSED, RASTERS

Image.MAX_IMAGE_PIXELS = None
PT_MM = 25.4 / 72
RES = 1.0  # m, matching grid


def plan_image():
    d = pymupdf.open(str(INSITU_PDF))
    page = d[0]
    xref = max(page.get_images(full=True), key=lambda i: i[2] * i[3])[0]
    rect = page.get_image_rects(xref)[0]
    im = Image.open(io.BytesIO(d.extract_image(xref)["image"])).convert("RGB")
    width_m = rect.width * PT_MM * 2000 / 1000  # nominal 1/2000
    return im, width_m / im.width, rect


def reference_grid():
    """All surveyed building footprints (halihazır B_* layers) rasterised at 1 m, padded so the plan may overhang."""
    from ezdxf import recover
    from rasterio import features
    from shapely.geometry import Polygon
    from shapely.validation import make_valid
    from build_layers import BUILDING_LAYERS
    from config import CAD
    doc, _ = recover.readfile(str(CAD / "halihazir.dxf"))
    polys = []
    for e in doc.modelspace():
        if e.dxf.layer in BUILDING_LAYERS and e.dxftype() in ("LWPOLYLINE", "POLYLINE"):
            pts = [(p[0], p[1]) for p in (e.get_points() if e.dxftype() == "LWPOLYLINE" else [v.dxf.location for v in e.vertices])]
            if len(pts) >= 3:
                g = make_valid(Polygon(pts))
                b = g.bounds
                # keep footprints around the site; a few drawing objects carry stray coordinates
                if g.area > 8 and 415500 < b[0] and b[2] < 420500 and 4537500 < b[1] and b[3] < 4542500:
                    polys.append(g)
    xs = [g.bounds for g in polys]
    x0, y0 = min(b[0] for b in xs) - PAD, min(b[1] for b in xs) - PAD
    x1, y1 = max(b[2] for b in xs) + PAD, max(b[3] for b in xs) + PAD
    w, h = int((x1 - x0) / RES), int((y1 - y0) / RES)
    tr = rasterio.transform.from_origin(x0, y1, RES, RES)
    known = np.zeros((h, w), bool)
    r0, c0 = int(PAD / RES), int(PAD / RES)
    known[r0:h - r0, c0:w - c0] = True
    m = features.rasterize([(g, 1) for g in polys], out_shape=(h, w), transform=tr, fill=0).astype("float32")
    return m, known, tr


PAD = 1500.0


def xcorr(big, small):
    """Position (row, col) of `small` inside `big` maximising the zero-mean cross-correlation (FFT)."""
    H, W = big.shape
    h, w = small.shape
    F = np.fft.rfft2(big - big.mean(), s=(H + h, W + w))
    G = np.fft.rfft2((small - small.mean())[::-1, ::-1], s=(H + h, W + w))
    c = np.fft.irfft2(F * G, s=(H + h, W + w))
    c = c[h - 1:H, w - 1:W]
    k = np.unravel_index(np.argmax(c), c.shape)
    return k, float(c[k])


def plan_mask(im, px_m, scale, angle):
    """Plan building mask (pure white blocks) resampled to the 1 m grid for a scale correction and rotation."""
    f = px_m * scale / RES
    sm = im.resize((max(1, int(im.width * f)), max(1, int(im.height * f))), Image.BILINEAR)
    a = np.asarray(sm).astype("int16")
    m = ((a >= 248).all(axis=2)).astype("float32")
    m = ndimage.binary_opening(m, iterations=1).astype("float32")
    if angle:
        m = ndimage.rotate(m, angle, reshape=True, order=0)
    return m


def main():
    im, px_m, rect = plan_image()
    ref, valid, tr = reference_grid()
    best = None
    for scale in (0.97, 0.98, 0.99, 1.0, 1.01, 1.02, 1.03):
        for angle in (-1.0, -0.5, 0.0, 0.5, 1.0):
            m = plan_mask(im, px_m, scale, angle)
            (r, c), score = xcorr(ref, m)
            win = ref[r:r + m.shape[0], c:c + m.shape[1]]
            vv = valid[r:r + m.shape[0], c:c + m.shape[1]]
            iou = float(((win > 0) & (m > 0) & vv).sum() / max(1, (((win > 0) | (m > 0)) & vv).sum()))
            if best is None or iou > best["iou"]:
                best = {"scale": scale, "angle": angle, "row": int(r), "col": int(c), "iou": iou}
            print(f"scale {scale:.3f} angle {angle:+.2f} → offset ({r},{c}) IoU {iou:.3f}", flush=True)
    # build an affine for the full-resolution plan image (rotation about the image centre)
    s = px_m * best["scale"]
    th = math.radians(best["angle"])
    W, H = im.width, im.height
    # rotated, resampled grid placed at (row, col) of the reference grid; its top-left in TM30:
    x0 = tr.c + best["col"] * RES
    y0 = tr.f - best["row"] * RES
    rw = abs(W * math.cos(th)) + abs(H * math.sin(th))  # rotated extent (in plan pixels)
    rh = abs(W * math.sin(th)) + abs(H * math.cos(th))
    cx, cy = x0 + rw * s / 2, y0 - rh * s / 2  # centre of the rotated image in TM30
    # pixel (i, j) → TM30: centre + R(th) · ((j − W/2)·s, −(i − H/2)·s)
    A = Affine.translation(cx, cy) * Affine.rotation(best["angle"]) * Affine.scale(s, -s) * Affine.translation(-W / 2, -H / 2)
    out = RASTERS / "insitu_plan.tif"
    arr = np.moveaxis(np.asarray(im), -1, 0)
    with rasterio.open(out, "w", driver="GTiff", width=W, height=H, count=3, dtype="uint8", crs=CRS_TM30, transform=A,
                       tiled=True, compress="jpeg", jpeg_quality=85, photometric="ycbcr") as dst:
        dst.write(arr)
    corners = [A * (0, 0), A * (W, 0), A * (W, H), A * (0, H)]
    meta = {"title": "INSITU yarışma önerisi – 1/2000 plan (yaklaşık konumlandırılmış)", "group": "Öneri (görsel referans)",
            "method": "data", "source": "Insitu_A0_Pafta_12_HpRev.pdf, pafta 1 raster plan", "date": "2020-11-25 (PDF oluşturma)",
            "notes": f"Konumlandırma: nominal 1/2000 ölçek + bina izi çapraz korelasyonu; ölçek düzeltmesi {best['scale']}, "
                     f"dönüş {best['angle']}°, bina izi IoU {best['iou']:.2f} (halihazır bina izleriyle). Yalnızca görsel referanstır; göstergeler bu katmandan hesaplanmaz.",
            "kind": "raster", "fit": best, "corners_tm30": corners, "pixel_m": s}
    mp = PROCESSED / "layers.json"
    m = json.loads(mp.read_text(encoding="utf-8"))
    m["insitu_plan"] = meta
    mp.write_text(json.dumps(m, ensure_ascii=False, indent=1), encoding="utf-8")
    print("best", best, "pixel", s)


if __name__ == "__main__":
    main()
