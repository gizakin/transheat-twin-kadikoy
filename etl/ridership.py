"""Kadıköy transfer demand from İBB open data → frontend/public/data/ridership_kadikoy.json (pedestrian simulation input).

Sources (data.ibb.gov.tr, downloaded to work/ibbdata by this script if missing):
  * Raylı Sistemler İstasyon Bazlı Yolcu ve Yolculuk Sayıları 2025 (daily, per station) → M4 Kadıköy (Doğu) + (Batı), passage_cnt
  * İstanbul Deniz İskeleleri Yolcu Sayıları 2025 (monthly, per pier and operator) → all Kadıköy piers, yolcu_sayisi
  * Saatlik Toplu Ulaşım Verisi, Eylül 2024 (hourly, per station; datastore query town=KADIKOY) → hour-of-day shares only
    (its absolute volumes are lower than the two sets above, so only its profile is used)
All counts are validations at the gates, i.e. boardings. Alightings are taken equal to boardings over a day (assumption).
"""
import json
import calendar
import urllib.parse
import urllib.request
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
WORK = ROOT / "work" / "ibbdata"
OUT = ROOT / "frontend" / "public" / "data" / "ridership_kadikoy.json"
API = "https://data.ibb.gov.tr/api/3/action"
RAIL = "cce8e138-686a-4b8d-bac0-c2a0ab294a6e"
PIER = "569932a5-96c3-455c-ba57-31893965af12"
HOURLY = "4546fb79-e598-4dc7-888b-626361110e37"


def get(url):
    try:
        import truststore
        truststore.inject_into_ssl()
    except Exception:
        pass
    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "transheat-twin-etl"}), timeout=600) as r:
        return r.read()


def resource_csv(rid):
    f = WORK / f"{rid}.csv"
    if not f.exists():
        url = json.loads(get(f"{API}/resource_show?id={rid}"))["result"]["url"]
        f.write_bytes(get(url))
    return pd.read_csv(f, sep=None, engine="python", encoding="utf-8-sig")


def hourly_kadikoy():
    f = WORK / "kadikoy_hourly_2024_09.csv"
    if not f.exists():
        rows, off = [], 0
        while True:
            q = urllib.parse.urlencode({"resource_id": HOURLY, "filters": json.dumps({"town": "KADIKOY"}), "limit": 32000, "offset": off,
                                        "fields": "transition_date,transition_hour,road_type,line_name,station_poi_desc_cd,number_of_passage,number_of_passenger"})
            d = json.loads(get(f"{API}/datastore_search?{q}"))["result"]
            rows += d["records"]; off += len(d["records"])
            if not d["records"] or off >= d.get("total", 0):
                break
        pd.DataFrame(rows).to_csv(f, index=False)
    return pd.read_csv(f)


def main():
    WORK.mkdir(parents=True, exist_ok=True)
    rail = resource_csv(RAIL)
    m4 = rail[rail["station_name"].isin(["Kadıköy (Doğu)", "Kadıköy (Batı)"])]
    m4_day = m4.groupby(["transaction_month", "transaction_day"])["passage_cnt"].sum().groupby(level=0).mean()

    pier = resource_csv(PIER)
    kp = pier[pier["istasyon_adi"].astype(str).str.contains("KADIKOY|Kadıköy", regex=True)]
    year = int(kp["yil"].iloc[0])
    pier_month = kp.groupby("ay")["yolcu_sayisi"].sum()
    pier_day = pd.Series({m: pier_month[m] / calendar.monthrange(year, int(m))[1] for m in pier_month.index})
    piers = sorted(kp["istasyon_adi"].unique().tolist())

    h = hourly_kadikoy()
    h["h"] = h["transition_hour"].astype(int)
    sea = h[(h["road_type"] == "DENİZ") & h["station_poi_desc_cd"].astype(str).str.contains("KADIKOY")]
    rail_h = h[(h["line_name"] == "M4") & h["station_poi_desc_cd"].isin(["KADIKOY (DOGU)", "KADIKOY (BATI)"])]
    prof = lambda d: (d.groupby("h")["number_of_passage"].sum().reindex(range(24), fill_value=0) / d["number_of_passage"].sum()).round(5).tolist()

    # share of boardings that are İstanbulkart transfers from another vehicle (transfer_type == "Aktarma"), Sep 2024
    tf = WORK / "kadikoy_hourly_transfer_2024_09.csv"
    transfer = None
    if tf.exists():
        t = pd.read_csv(tf)
        pick = {"iskele": (t["road_type"] == "DENİZ") & t["station_poi_desc_cd"].astype(str).str.contains("KADIKOY"),
                "metro": (t["line_name"] == "M4") & t["station_poi_desc_cd"].isin(["KADIKOY (DOGU)", "KADIKOY (BATI)"])}
        transfer = {k: round(100 * float(t[m & (t["transfer_type"] == "Aktarma")]["number_of_passage"].sum()) / float(t[m]["number_of_passage"].sum()), 1) for k, m in pick.items()}
    # weekday / weekend hour profiles and the ratio of a weekday's (weekend day's) total to the mean day (Sep 2024)
    h["we"] = pd.to_datetime(h["transition_date"]).dt.dayofweek >= 5
    def by_day(d):
        tot = d.groupby("transition_date")["number_of_passage"].sum()
        we = pd.to_datetime(tot.index).dayofweek >= 5
        mean = tot.mean()
        return ({k: (d[d["we"] == w].groupby("h")["number_of_passage"].sum().reindex(range(24), fill_value=0) / d[d["we"] == w]["number_of_passage"].sum()).round(5).tolist()
                 for k, w in (("wd", False), ("we", True))},
                {"wd": round(float(tot[~we].mean() / mean), 4), "we": round(float(tot[we].mean() / mean), 4)})
    sea["we"] = h.loc[sea.index, "we"]; rail_h["we"] = h.loc[rail_h.index, "we"]
    pi, ri = by_day(sea), by_day(rail_h)
    auth = kp.groupby("otorite_adi")["yolcu_sayisi"].sum()
    ibb_share = round(float(auth[auth.index.str.contains("IBB")].sum() / auth.sum()), 4)
    out = {
        "profileByDay": {"iskele": pi[0], "metro": ri[0]},
        "dayRatio": {"iskele": pi[1], "metro": ri[1]},
        "operatorShare": {"ibb": ibb_share, "note": "Kadıköy iskelelerinde yolcunun İBB (Şehir Hatları) otoritesindeki payı; kalanı Turyol ve diğerleri (" + str(year) + ")"},
        "transfer": transfer,
        "year": year,
        "daily": {"iskele": {int(m): round(float(v)) for m, v in pier_day.items()}, "metro": {int(m): round(float(v)) for m, v in m4_day.items()}},
        "profile": {"iskele": prof(sea), "metro": prof(rail_h)},
        "piers": piers,
        "sources": [
            f"İBB Açık Veri – İstanbul Deniz İskeleleri Yolcu Sayıları {year} (aylık, Kadıköy iskeleleri: {', '.join(piers)})",
            "İBB Açık Veri – Raylı Sistemler İstasyon Bazlı Yolcu ve Yolculuk Sayıları 2025 (günlük, M4 Kadıköy Doğu + Batı, geçiş sayısı)",
            "İBB Açık Veri – Saatlik Toplu Ulaşım Verisi, Eylül 2024 (Kadıköy; saatlik dağılım ve aktarmalı biniş payı)",
        ],
        "notes": "Sayılar biniş (turnike/validasyon) sayısıdır; günlük inişin binişe eşit olduğu varsayılır. Hafta içi/hafta sonu saatlik dağılımı ve gün oranı Eylül 2024 verisinden.",
    }
    OUT.write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")
    print("piers/day by month", out["daily"]["iskele"])
    print("M4/day by month", out["daily"]["metro"])
    print("peak hour iskele", max(range(24), key=lambda i: out["profile"]["iskele"][i]), "metro", max(range(24), key=lambda i: out["profile"]["metro"][i]))


if __name__ == "__main__":
    main()
