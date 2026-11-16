"""Geometry helpers that turn LibreDWG JSON entities into shapely geometries."""
import math
from shapely.geometry import LineString, Polygon, Point
from shapely.validation import make_valid


def _arc_pts(cx, cy, r, a0, a1, ccw=True, step_deg=6):
    if not ccw:
        a0, a1 = -a0, -a1
    if a1 < a0:
        a1 += 2 * math.pi
    n = max(2, int(math.degrees(a1 - a0) / step_deg) + 1)
    pts = [(cx + r * math.cos(a0 + (a1 - a0) * i / (n - 1)), cy + r * math.sin(a0 + (a1 - a0) * i / (n - 1))) for i in range(n)]
    if not ccw:
        pts = [(x, 2 * cy - y) for x, y in pts]  # mirror back for clockwise arcs
    return pts


def _bulge_pts(p0, p1, bulge):
    """Points along a polyline segment with an AutoCAD bulge (tan(theta/4))."""
    if not bulge:
        return [p0]
    (x0, y0), (x1, y1) = p0, p1
    theta = 4 * math.atan(bulge)
    chord = math.hypot(x1 - x0, y1 - y0)
    if chord == 0:
        return [p0]
    r = chord / (2 * math.sin(theta / 2))
    mx, my = (x0 + x1) / 2, (y0 + y1) / 2
    d = r * math.cos(theta / 2)
    nx, ny = -(y1 - y0) / chord, (x1 - x0) / chord
    cx, cy = mx + nx * d, my + ny * d
    a0 = math.atan2(y0 - cy, x0 - cx)
    n = max(2, int(abs(math.degrees(theta)) / 6) + 1)
    return [(cx + abs(r) * math.cos(a0 + theta * i / (n - 1)) if r > 0 else cx + abs(r) * math.cos(a0 + theta * i / (n - 1)),
             cy + abs(r) * math.sin(a0 + theta * i / (n - 1))) for i in range(n - 1)]


def _hatch_arc(s, prev_end, next_start, step_deg=6):
    """Points of a hatch-boundary arc.

    DWG stores clockwise hatch arcs with mirrored angles, and near-straight arcs have huge radii where a
    wrong sweep sends points kilometres away. Both readings are tried and the one whose endpoints best
    connect to the neighbouring segments wins; the sweep is always the short one implied by that reading.
    """
    cx, cy = s["center"][:2]
    r = s["radius"]
    a0, a1 = s["start_angle"], s["end_angle"]
    cands = []
    for ccw in (True, False):
        b0, b1 = (a0, a1) if ccw else (-a0, -a1)
        sweep = (b1 - b0) % (2 * math.pi) if ccw else -((b0 - b1) % (2 * math.pi))
        if abs(sweep) < 1e-9:
            sweep = 2 * math.pi if ccw else -2 * math.pi
        n = max(2, int(abs(math.degrees(sweep)) / step_deg) + 1)
        pts = [(cx + r * math.cos(b0 + sweep * i / (n - 1)), cy + r * math.sin(b0 + sweep * i / (n - 1))) for i in range(n)]
        for seq in (pts, pts[::-1]):
            cost = 0.0
            if prev_end is not None:
                cost += math.dist(seq[0], prev_end)
            if next_start is not None:
                cost += math.dist(seq[-1], next_start)
            cands.append((cost, seq))
    cands.sort(key=lambda c: c[0])
    best_cost, best = cands[0]
    # an arc that cannot be joined to its neighbours is replaced by a straight chord
    if (prev_end is not None or next_start is not None) and best_cost > max(1.0, 0.05 * r) and r > 1e3:
        return [best[0], best[-1]]
    return best


def _seg_start(s):
    if s.get("curve_type") == 1:
        return tuple(s["first_endpoint"][:2])
    return None


def _seg_end(s):
    if s.get("curve_type") == 1:
        return tuple(s["second_endpoint"][:2])
    return None


def hatch_polygons(e, clip_bounds=None):
    """Return a list of shapely Polygons, one per hatch boundary path (outer and holes resolved by area nesting).

    clip_bounds (minx, miny, maxx, maxy): rings with any vertex outside are dropped as decoding errors.
    """
    rings = []
    for p in e.get("paths", []) or []:
        pts = []
        if "polyline_paths" in p:
            pp = p["polyline_paths"]
            for i, v in enumerate(pp):
                pts.append(tuple(v["point"][:2]))
        segs = p.get("segs", []) or []
        for i, s in enumerate(segs):
            ct = s.get("curve_type")
            if ct == 1:
                pts.append(tuple(s["first_endpoint"][:2]))
            elif ct == 2:
                prev_end = pts[-1] if pts else _seg_end(segs[i - 1]) if i > 0 else None
                nxt = _seg_start(segs[(i + 1) % len(segs)]) if len(segs) > 1 else None
                arc = _hatch_arc(s, prev_end, nxt)
                pts += arc[:-1] if nxt is not None else arc
            elif ct == 3:  # ellipse: approximate with its control geometry
                c = s["center"]; pts.append(tuple(c[:2]))
            elif ct == 4:
                for cp in s.get("control_points", []) or []:
                    pts.append(tuple(cp["point"][:2]) if isinstance(cp, dict) else tuple(cp[:2]))
        if clip_bounds and pts:
            x0, y0, x1, y1 = clip_bounds
            if any(not (x0 <= x <= x1 and y0 <= y <= y1) for x, y in pts):
                continue
        if len(pts) >= 3:
            poly = make_valid(Polygon(pts))
            if not poly.is_empty and poly.area > 0:
                rings.append(poly)
    if not rings:
        return []
    rings.sort(key=lambda g: -g.area)
    out = []
    for g in rings:
        # a ring inside an earlier (larger) ring is a hole
        for i, o in enumerate(out):
            if o.contains(g.representative_point()) and o.area > g.area:
                out[i] = make_valid(o.difference(g))
                break
        else:
            out.append(g)
    return out


def polyline_coords(e):
    if e["type"] == "LWPOLYLINE":
        pts = [tuple(p[:2]) for p in e.get("points", []) or []]
        bul = e.get("bulges") or []
        if bul and any(bul):
            res = []
            closed = bool(e.get("flag", 0) & 512) or bool(e.get("flag", 0) & 1)
            n = len(pts)
            for i in range(n - (0 if closed else 1)):
                res += _bulge_pts(pts[i], pts[(i + 1) % n], bul[i] if i < len(bul) else 0)
            res.append(pts[-1] if not closed else pts[0])
            pts = res
        return pts
    if e["type"] in ("POLYLINE_2D", "POLYLINE_3D"):
        return [tuple(v[:2]) for v in e.get("vertices", []) if v]
    if e["type"] == "LINE":
        return [tuple(e["start"][:2]), tuple(e["end"][:2])]
    return []


def is_closed(e, tol=0.05):
    pts = polyline_coords(e)
    if len(pts) < 3:
        return False
    if e.get("flag", 0) & 1 or e.get("flag", 0) & 512:
        return True
    return math.dist(pts[0], pts[-1]) <= tol


def to_polygon(e):
    pts = polyline_coords(e)
    if len(pts) < 3:
        return None
    g = make_valid(Polygon(pts))
    return g if not g.is_empty and g.area > 0 else None


def to_line(e):
    pts = polyline_coords(e)
    return LineString(pts) if len(pts) >= 2 else None
