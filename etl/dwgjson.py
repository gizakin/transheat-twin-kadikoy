"""Read a LibreDWG `dwgread -O JSON` dump into a compact entity list.

LibreDWG's DXF writer drops the content of the bound xref block 01_PLN in "01 - PLAN.dwg",
but the JSON dump keeps it, so the project-state geometry is read from JSON instead.
Each returned entity: {type, layer, block, handle, ...raw geometry fields}.
"""
import json
import pickle
from pathlib import Path


def _h(ref):
    """LibreDWG handle refs look like [code, size, value, absolute]; the last item is absolute."""
    return ref[-1] if isinstance(ref, list) and ref else None


def load(json_path: Path, cache: Path | None = None):
    if cache and cache.exists() and cache.stat().st_mtime > json_path.stat().st_mtime:
        return pickle.loads(cache.read_bytes())
    with open(json_path, encoding="utf-8", errors="ignore") as f:
        doc = json.load(f)
    objs = doc["OBJECTS"]
    layers, blocks, owner_block = {}, {}, {}
    for o in objs:
        kind = o.get("object")
        if kind == "LAYER":
            layers[_h(o["handle"])] = o.get("name", "")
        elif kind == "BLOCK_HEADER":
            bh = _h(o["handle"])
            blocks[bh] = o.get("name", "")
            for e in o.get("entities", []) or []:
                owner_block[_h(e)] = o.get("name", "")
    ents = []
    keep = ("points", "bulges", "flag", "paths", "center", "radius", "start_angle", "end_angle", "start", "end",
            "ins_pt", "text_value", "text", "insertion_pt", "block_header", "scale", "rotation", "elevation",
            "pattern_type", "name", "is_solid_fill", "num_verts", "verts", "point")
    for o in objs:
        t = o.get("entity")
        if not t:
            continue
        h = _h(o["handle"])
        owner = _h(o.get("ownerhandle"))
        e = {"type": t, "handle": h, "layer": layers.get(_h(o.get("layer")), ""),
             "block": owner_block.get(h) or blocks.get(owner, ""), "owner": owner}
        for k in keep:
            if k in o:
                e[k] = o[k]
        ents.append(e)
    # POLYLINE_2D/3D carry their vertices as separate VERTEX entities owned by the polyline
    by_owner = {}
    for e in ents:
        if e["type"].startswith("VERTEX"):
            by_owner.setdefault(e["owner"], []).append(e.get("point"))
    for e in ents:
        if e["type"] in ("POLYLINE_2D", "POLYLINE_3D"):
            e["vertices"] = by_owner.get(e["handle"], [])
    res = {"entities": ents, "blocks": blocks}
    if cache:
        cache.write_bytes(pickle.dumps(res))
    return res
