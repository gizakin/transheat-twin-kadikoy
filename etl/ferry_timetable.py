"""Şehir Hatları (İstanbul City Lines) published timetables → departures from and arrivals at Kadıköy
→ frontend/public/data/ferry_kadikoy.json (pedestrian simulation input).

Source: https://sehirhatlari.istanbul/tr/seferler/ic-hatlar (every line page is read; a table is kept when one of its
stop columns is Kadıköy). Day rules come from the footnote asterisks of each table (e.g. "* C.TESİ, PAZAR VE RESMİ TATİL
GÜNLERİ YAPILMAZ"); day types: wd = Monday–Friday, sat = Saturday, sun = Sunday and public holidays.
Lines are matched to the Kadıköy pier points (transfer_points.geojson, attribute 'hat' from the ferry-line data) by their stop
names; a line served by several piers alternates between them (assumption); an unmatched line goes to the pier with the most
Şehir Hatları lines (assumption). Passenger numbers are NOT in the timetable; the simulation estimates them from İBB counts.
"""
import html
import json
import re
import ssl
import urllib.request
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "frontend" / "public" / "data" / "ferry_kadikoy.json"
PTS = ROOT / "frontend" / "public" / "data" / "transfer_points.geojson"
BASE = "https://sehirhatlari.istanbul"
INDEX = BASE + "/tr/seferler/ic-hatlar"


def get(url):
    try:
        import truststore
        truststore.inject_into_ssl()
    except Exception:
        pass
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (transheat-twin-etl)"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.read().decode("utf-8", "replace")
    except Exception:
        ctx = ssl.create_default_context()   # some networks cannot check revocation: plain verification, no revocation
        with urllib.request.urlopen(req, timeout=60, context=ctx) as r:
            return r.read().decode("utf-8", "replace")


def txt(s):
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", s))).strip()


TR = str.maketrans("çğıöşüÇĞİÖŞÜâî", "cgiosuCGIOSUai")


def norm(s):
    return re.sub(r"[^a-z]", "", s.translate(TR).lower())


def tokens(name):
    return frozenset(norm(p) for p in re.split(r"[-–_/,]", name) if norm(p))


def low(s):
    return re.sub(r"\s+", " ", s.translate(TR).lower())


def day_set(u):
    d = set()
    if "hafta ici" in u or "haftaici" in u: d.add("wd")
    if "c.tesi" in u or "cumartesi" in u or "ctesi" in u: d.add("sat")
    if "pazar" in u or "tatil" in u: d.add("sun")
    return d


def day_rule(note):
    """Day types a footnote removes or restricts to."""
    u = low(note)
    found = day_set(u)
    if not found: return None
    if "yapilmaz" in u or "calismaz" in u: return ("not", found)
    if "sadece" in u or "yapilir" in u or "calisir" in u: return ("only", found)
    return None


def head_days(info):
    u = low(info.split("*")[0])          # the table heading, without its footnotes
    if "her gun" in u: return {"wd", "sat", "sun"}
    if "sadece hafta ici" in u: return {"wd"}
    return day_set(u) or {"wd", "sat", "sun"}


TRAVEL_MIN = 20   # assumed crossing time when a return table has no Kadıköy column


def parse_table(t, line_has_kadikoy):
    rows = re.findall(r"<tr[^>]*>(.*?)</tr>", t, flags=re.S)
    cells = [[txt(c) for c in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", r, flags=re.S)] for r in rows]
    info_html = re.search(r'table-head-information[^>]*>(.*?)</t[dh]>', t, flags=re.S)
    info = txt(info_html.group(1)) if info_html else (" ".join(cells[0]) if cells else "")
    base = head_days(info)
    rules = {}
    for m in re.finditer(r"(\*+)\s*([^*]+)", info):
        r = day_rule(m.group(2))
        if r: rules[len(m.group(1))] = r
    hi = next((i for i, c in enumerate(cells) if c and all(not re.match(r"\d", x) for x in c) and not any(norm(x) in ("kalkis", "varis") for x in c)
               and i + 1 < len(cells) and any(norm(x) in ("kalkis", "varis") for x in cells[i + 1])), None)
    if hi is None: return None
    stops, kinds = cells[hi], cells[hi + 1]
    k = next((i for i, s in enumerate(stops) if norm(s) == "kadikoy"), None)
    est = False
    if k is None:
        if not line_has_kadikoy: return None
        k, est = 0, True        # other end's departures: Kadıköy arrival = departure + TRAVEL_MIN (assumption)
    ev = []
    for c in cells[hi + 2:]:
        if len(c) != len(stops) or k >= len(c): continue
        m = re.match(r"(\d{1,2}):(\d{2})\s*(\**)", c[k])
        if not m: continue
        days = set(base)
        stars = len(m.group(3))
        if stars in rules:
            how, ds = rules[stars]
            days = days - ds if how == "not" else days & ds
        if not days: continue
        hh, mm = int(m.group(1)), int(m.group(2))
        if est:
            tot = hh * 60 + mm + TRAVEL_MIN
            ev.append({"kind": "arr", "t": f"{(tot // 60) % 24:02d}:{tot % 60:02d}", "days": sorted(days), "est": True})
            continue
        t0 = f"{hh:02d}:{mm:02d}"
        if len(kinds) == len(stops): kind = norm(kinds[k])
        else: kind = "kalkis" if k < len(stops) - 1 else "varis"
        if kind.startswith("kalk"):
            ev.append({"kind": "dep", "t": t0, "days": sorted(days)})
            if k > 0: ev.append({"kind": "arr", "t": t0, "days": sorted(days)})   # intermediate call: arrives and departs
        elif kind.startswith("var"):
            ev.append({"kind": "arr", "t": t0, "days": sorted(days)})
    return {"stops": stops, "events": ev}


def main():
    idx = get(INDEX)
    links = sorted(set(re.findall(r'href="(/tr/seferler/ic-hatlar/[^"/]+/[^"]+)"', idx)))
    pts = json.loads(PTS.read_text(encoding="utf-8"))["features"]
    piers = [(f["properties"]["ad"], [tokens(h.split("(")[0]) for h in str(f["properties"].get("hat", "")).split(";")]) for f in pts if f["properties"]["tur"] == "iskele"]
    sh_count = {ad: sum(1 for h in str(f["properties"].get("hat", "")).split(";") if "Şehir Hatları" in h) for f in pts if f["properties"]["tur"] == "iskele" for ad in [f["properties"]["ad"]]}
    fallback = max(sh_count, key=sh_count.get)
    lines, events = [], []
    for href in links:
        try:
            page = get(BASE + href)
        except Exception as e:
            print("atlandı", href, e); continue
        m = re.search(r"<title>(.*?)</title>", page, flags=re.S)
        if not m:
            print("başlık yok", href, len(page)); continue
        title = txt(m.group(1)).split(" Seferi")[0]
        kad = "kadikoy" in norm(title)
        tabs = [p for p in (parse_table(t, kad) for t in re.findall(r"<table.*?</table>", page, flags=re.S)) if p]
        if not any(e["kind"] == "dep" for tb in tabs for e in tb["events"]) and not any(norm(s) == "kadikoy" for tb in tabs for s in tb["stops"]): continue
        if not tabs: continue
        tk = tokens(title)
        served = [ad for ad, hats in piers if any(tk == h for h in hats)] or [ad for ad, hats in piers if any(tk <= h or h <= tk for h in hats if len(h) > 1)]
        assigned = served or [fallback]
        lines.append({"name": title, "url": BASE + href, "piers": assigned, "pier_match": "deniz hattı verisi" if served else "eşleşmedi: en çok Şehir Hatları hattı olan iskele (varsayım)"})
        for tb in tabs:
            for e in tb["events"]:
                events.append({**e, "line": title})
        print(f"{title}: {sum(len(t['events']) for t in tabs)} olay, iskele {assigned}")
    # de-duplicate (some pages repeat tables)
    seen, uniq = set(), []
    for e in events:
        key = (e["line"], e["kind"], e["t"], tuple(e["days"]))
        if key not in seen: seen.add(key); uniq.append(e)
    OUT.write_text(json.dumps({
        "source": INDEX, "fetched": date.today().isoformat(), "lines": lines, "events": sorted(uniq, key=lambda e: e["t"]),
        "notes": "Şehir Hatları resmî tarifesi (Kadıköy kalkış ve varışları). Gün türü: wd hafta içi, sat cumartesi, sun pazar ve resmî tatil. "
                 "est: true olan varışlar tarifede Kadıköy sütunu olmayan dönüş tablolarından, karşı iskele kalkışı + 20 dk sefer süresi varsayımıyla türetildi. Tarife yolcu sayısı içermez; özel işletmeciler (Turyol vb.) bu tarifede yoktur.",
    }, ensure_ascii=False, indent=0), encoding="utf-8")
    print("lines", len(lines), "events", len(uniq), "->", OUT)


if __name__ == "__main__":
    main()
