# TRANSHEAT TWIN — Kadıköy Kentsel Isı ve Ulaşım Karar Destek Sistemi (MVP)

Kadıköy Meydanı yarışma alanı için dijital ikiz / karar destek prototipi. Kullanıcı haritada bir alan seçer, bir müdahale tanımlar
(ağaçlandırma, yeşil alan, gölgeleme, PV gölgeleme, zemin değişimi, geçirgen yüzey, cool pavement, yaya güzergâhı, aktarma alanı)
ve sistem **Mevcut durum → Müdahale → Beklenen sonuç** mantığıyla göstergeleri hesaplar. Her sonuçta yöntem etiketi ve
“Bu sonuç nasıl hesaplandı?” açıklaması vardır. Sistem “en iyi senaryo” hükmü vermez.

## Paylaşılabilir sürüm

Analiz motoru tarayıcıda çalışır (`frontend/src/engine/`): sunucu gerekmez. Derlenen sürüm statik dosya olarak herhangi bir web sunucusundan yayınlanabilir.
Hesaplar 0,5 m analiz ızgarasında (canvas) yapılır; güneş konumu NOAA algoritmasıyla (pvlib ile 0,01° içinde aynı),
yürüme mesafesi 2 m ızgarada Dijkstra ile. Kayıtlı senaryolar her izleyicinin tarayıcısında saklanır; JSON olarak kopyalanıp
paylaşılabilir. Statik veri paketi `etl/export_static.py` ile `frontend/public/data/` altına üretilir.

## Çalıştırma

```
baslat.bat            (çift tıklayın; http://localhost:8000 açılır)
```

veya proje kökünde:

```
.venv\Scripts\python -m uvicorn backend.app.main:app --port 8000
```

Geliştirme modunda ön yüz: `cd frontend && npm run dev` (http://localhost:5173, API isteklerini 8000'e yönlendirir).

## Kurulum (sıfırdan)

```
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
cd frontend
set NODE_OPTIONS=--use-system-ca      (kurum ağındaki TLS denetimi için Windows sertifika deposunu kullanır)
npm install
npm run build
```

Veri hazırlama (ETL) — ham yarışma klasörü (depoda yok, bkz. VERI.md; yolu `TRANSHEAT_RAW` ortam değişkeniyle verilir, varsayılan `raw/`) salt okunur kullanılır:

```
tools\libredwg\dwgread.exe -O JSON -o work\cad\plan.json "<ham>\2_13_Mevcut Projeler\2_13_2_...\01 - PLAN.dwg"
tools\libredwg\dwg2dxf.exe  -y -o work\cad\halihazir.dxf "<ham>\2_3_Halihazir\2_3_1_Halihazir_2B.dwg"
tools\libredwg\dwg2dxf.exe  -y -o work\cad\agac.dxf      "<ham>\2_12_Agac_Rolovesi\2_12_1_Agac_Rolovesi.dwg"
cd etl
..\.venv\Scripts\python ortho.py             (10 pafta → COG, 0,25 m)
..\.venv\Scripts\python build_layers.py all  (sınır, ağaç, bina, yüzeyler, proje, referans katmanlar)
..\.venv\Scripts\python transfer_points.py   (aktarma noktaları)
..\.venv\Scripts\python infra.py             (altyapı hatları)
..\.venv\Scripts\python insitu_georef.py     (INSITU önerisi bindirmesi)
..\.venv\Scripts\python export_static.py      (tarayıcı motoru için statik veri paketi)
```

`build_layers.py proj` yalnızca proje yüzeylerini, `build_layers.py ref` yalnızca referans/ulaşım katmanlarını yeniden üretir.

## Mimari

| Katman | Teknoloji |
|---|---|
| Ön yüz | React 19, TypeScript, Vite (tek dosya derleme), MapLibre GL JS 5, Terra Draw, ECharts, proj4, geotiff.js, shpjs |
| Tarayıcı motoru | `frontend/src/engine/` — veri, raster ızgara, güneş, gölge, KPI, ağ, senaryo, yükleme (Python çekirdeğinin portu) |
| Arka uç | FastAPI, GeoPandas, Shapely 2, Rasterio, rio-tiler, pvlib (NREL SPA), scikit-image (yürüme mesafesi) |
| Veri | GeoPackage `data/processed/kadikoy.gpkg` (EPSG:5254), web için GeoJSON (WGS84), raster COG, SQLite (senaryolar, yüklemeler) |
| CAD | LibreDWG 0.14 (`dwgread` JSON — `01 - PLAN.dwg` içindeki 01_PLN bloğu DXF çıktısında kayboluyor), ezdxf |

`backend/app/core/store.py` tek kalıcılık katmanıdır; PostGIS'e geçişte yalnızca bu modül değişir.

```
etl/                 veri hazırlama (CAD/SHP/Excel/ortofoto → GPKG, GeoJSON, COG)
backend/app/core/    data, state, shadow, kpi, network, scenario, ingest, rasters, report, store
backend/app/literature/params.yaml   doğrulanmış literatür parametreleri ve varsayımlar
backend/app/templates/report.html    karar destek raporu
frontend/src/        map/, panels/, pages/, components/
data/                processed/, web/, rasters/, uploads/, transheat.sqlite
```

## Üretilen veri (gerçek kaynaklardan)

| Katman | Adet | Kaynak / yöntem |
|---|---:|---|
| Ağaçlar | 973 | DWG taç daireleri + Excel (tür, boy, taç); 940 ağaç numarayla eşleşti, 33 yalnız DWG; 134 ağacın boyu tür medyanı |
| Binalar | 1.725 | Halihazır B_* katmanları; 1.312 bina yüksekliği **ölçümden** (çatı kotu − zemin kotu), 345 kat adedi × 3 m, 68 varsayım |
| Mevcut yüzeyler | 2.325 | Ortofoto bitki indeksi (ExG) + halihazır park/havuz/bina; sert zemin kalan alan, ölçüm çizgileriyle parçalanmış |
| Proje yüzeyleri | 5.823 | İBB Meydan Düzenleme Projesi 01_PLN malzeme taramaları + desen çizgisi yoğunluğu; kapsam dışı alanlar mevcut durumdan |
| Aktarma noktaları | 48 | 5 iskele, 9 M4 yapısı (giriş/şaft ayrımı doğrulanamadı), 5 otobüs durak grubu, 29 minibüs durağı |
| Altyapı hatları | 1.412 | İSKİ, İGDAŞ, AYEDAŞ (ağaç–altyapı çakışma kontrolü) |
| INSITU önerisi | raster | 1/2000 plan; nominal ölçek + bina izi korelasyonu (IoU 0,52); yalnızca görsel referans |

## Yöntem ilkeleri

* **Veri tabanlı gözlem / Geometrik hesaplama / Literatür tabanlı tahmin / Varsayım / Model tabanlı sonuç** etiketleri her göstergede gösterilir.
* Fiziksel mikroklima modeli çalıştırılmadığı için **hiçbir sıcaklık değeri üretilmez**; Tmrt/UTCI/PET “Model çalıştırılmadı” olarak gösterilir.
* Literatür değerleri yalnızca kaynak metni kontrol edilerek `params.yaml`'a girer (Santamouris 2013, EPA 2008, Armson vd. 2012,
  Lee vd. 2013, Bowler vd. 2010). Kaynağı olmayan parametre “Literatür parametresi tanımlanmamış” olarak gösterilir.
* Gölge: pvlib güneş konumu + bina prizmaları + küre taçlı ağaçlar; yatay zemin, opak taç, bulutsuz gökyüzü varsayımı.
* Yürüme mesafesi: kara − bina yüzeyinde 2 m ızgara en kısa yol; taşıt yolları ayrıştırılamadığı için alt sınırdır.

## Bilinen sınırlar / eksik veri

* Uydu LST ısı haritası, meteoroloji ve yaya sayımı klasörde yok. Isı katmanı için `frontend/public/gee_landsat_lst.js`
  (Google Earth Engine, Landsat 8/9 C2 L2) ile üretilen GeoTIFF “Veri kataloğu” sekmesinden yüklenebilir.
* Mevcut durumda asfalt / doğal taş ayrımı yapılamadı (albedo “tanımlanmamış”).
* T3 tramvay durakları ve İETT hat öznitelikleri kaynakta yok.
* 3B halihazır modeli (.skp/.max) programla okunamadı; 3B görünüm bina yüksekliklerinden üretilir.

## Test

```
.venv\Scripts\python work\e2e.py     (kurulu Edge ile uçtan uca arayüz testi; ekran görüntüleri work\e2e\)
```
