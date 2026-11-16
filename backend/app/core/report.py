"""HTML / CSV decision-support report (print-to-PDF from the browser for a PDF copy)."""
import base64
import csv
import io
from datetime import datetime

import geopandas as gpd
import matplotlib
import numpy as np
import rasterio
from rasterio.warp import transform_bounds
from rasterio.windows import from_bounds
from shapely.geometry import shape

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
from jinja2 import Environment, FileSystemLoader, select_autoescape  # noqa: E402

from .data import CRS, RASTERS, layer, layers_meta, literature  # noqa: E402

TPL = Environment(loader=FileSystemLoader(str(__import__("pathlib").Path(__file__).resolve().parents[1] / "templates")),
                  autoescape=select_autoescape(["html"]))

METHOD_TR = {"data": "Veri tabanlı gözlem", "geometric": "Geometrik hesaplama", "literature": "Literatür tabanlı tahmin",
             "assumption": "Varsayım", "model": "Model tabanlı sonuç"}


def _png(fig):
    b = io.BytesIO(); fig.savefig(b, format="png", dpi=110, bbox_inches="tight"); plt.close(fig)
    return "data:image/png;base64," + base64.b64encode(b.getvalue()).decode()


def _map(result):
    g = result["geoms"]
    area = shape(g["analysis_area"]["geometry"]) if g["analysis_area"]["geometry"] else None
    a = gpd.GeoSeries([area], crs="EPSG:4326").to_crs(CRS)
    xmin, ymin, xmax, ymax = a.buffer(40).total_bounds
    fig, ax = plt.subplots(figsize=(7, 7))
    with rasterio.open(RASTERS / "ortho.tif") as r:
        b = transform_bounds(CRS, r.crs, xmin, ymin, xmax, ymax)
        img = r.read(window=from_bounds(*b, r.transform), out_shape=(3, 900, int(900 * (xmax - xmin) / (ymax - ymin))))
    ax.imshow(np.moveaxis(img, 0, -1), extent=(xmin, xmax, ymin, ymax))

    def draw(fc, **kw):
        feats = fc["features"] if fc.get("type") == "FeatureCollection" else [fc]
        geoms = [shape(f["geometry"]) for f in feats if f.get("geometry")]
        if geoms:
            gpd.GeoSeries(geoms, crs="EPSG:4326").to_crs(CRS).plot(ax=ax, **kw)

    draw(g["base_shade"], color="#1f2a44", alpha=0.35, linewidth=0)
    draw(g["new_shade"], color="#3b6fb6", alpha=0.55, linewidth=0)
    draw(g["intervention_areas"], facecolor="none", edgecolor="#e8a33d", linewidth=2)
    draw(g["new_tree_crowns"], color="#2e8b57", alpha=0.8, linewidth=0)
    draw(g["structures"], facecolor="#c0c0c0", edgecolor="#555", alpha=0.6)
    draw(g["affected_paths"], color="#d64545", linewidth=2)
    draw(g["routes"], color="#7b3fb6", linewidth=2.5)
    a.boundary.plot(ax=ax, color="white", linewidth=1, linestyle="--")
    ax.set_xlim(xmin, xmax); ax.set_ylim(ymin, ymax); ax.set_axis_off()
    return _png(fig)


def _bars(results):
    ids = [("yesil_oran", "Yeşil %"), ("golge_oran", "Gölge %"), ("sert_oran", "Sert zemin %"), ("agac_tac_oran", "Taç örtüsü %"), ("gecirgen_oran", "Geçirgen %")]
    fig, ax = plt.subplots(figsize=(8, 3.2))
    n = len(results) + 1
    w = 0.8 / n
    base = {k["id"]: k["value"] for k in results[0]["kpis_base"]}
    vals = [[base.get(i) or 0 for i, _ in ids]] + [[{k["id"]: k["value"] for k in r["kpis_scenario"]}.get(i) or 0 for i, _ in ids] for r in results]
    labels = [results[0]["base_label"]] + [r["scenario"].get("scenario_name", "Senaryo") for r in results]
    colors = ["#9aa5b1", "#3b6fb6", "#2e8b57", "#e8a33d", "#7b3fb6", "#d64545"]
    for j, (v, l) in enumerate(zip(vals, labels)):
        ax.bar(np.arange(len(ids)) + j * w, v, w, label=l, color=colors[j % len(colors)])
    ax.set_xticks(np.arange(len(ids)) + w * (n - 1) / 2); ax.set_xticklabels([l for _, l in ids])
    ax.legend(frameon=False, fontsize=8); ax.spines[["top", "right"]].set_visible(False)
    return _png(fig)


def html(results: list, title="Karar Destek Raporu"):
    lit = literature()
    used = {p for r in results for e in r["literature_effects"] for p in e["params"]}
    params = [p for p in lit["parameters"] if p["id"] in used or not used]
    srcs = {k: v for k, v in lit["sources"].items()}
    meta = layers_meta()
    return TPL.get_template("report.html").render(
        title=title, now=datetime.now().strftime("%d.%m.%Y %H:%M"), results=results,
        maps=[_map(r) for r in results], bars=_bars(results), meta=meta, params=params, sources=srcs,
        assumptions=lit["assumptions"], METHOD_TR=METHOD_TR)


def csv_text(results: list):
    out = io.StringIO()
    w = csv.writer(out, delimiter=";")
    w.writerow(["senaryo", "gosterge", "birim", "temel", "senaryo_degeri", "fark", "yontem"])
    for r in results:
        b = {k["id"]: k for k in r["kpis_base"]}
        for k in r["kpis_scenario"]:
            w.writerow([r["scenario"].get("scenario_name"), k["label"], k["unit"], b.get(k["id"], {}).get("value"), k["value"],
                        r["deltas"].get(k["id"]), METHOD_TR.get(k["method"], k["method"])])
    return "﻿" + out.getvalue()
