# Veri kaynakları ve lisansları

## Depoda bulunan (açık verilerden türetilmiş) dosyalar — `frontend/public/data/`

| Dosya | İçerik | Kaynak | Lisans / koşul |
|---|---|---|---|
| `lst_2025.json` | Landsat 8/9 yüzey sıcaklığı, 2025 yaz bileşimi (°C), çalışma alanı | USGS / NASA Landsat, Google Earth Engine ile işlendi (`frontend/public/gee_landsat_lst.js`) | Landsat verisi kamu malıdır (USGS) |
| `ridership_kadikoy.json` | Kadıköy raylı sistem ve iskele yolcu özetleri, saatlik dağılım | İBB Açık Veri Portalı (data.ibb.gov.tr) | İBB Açık Veri Lisansı; kaynak gösterilerek |
| `ferry_kadikoy.json` | Kadıköy vapur kalkış/varış tarifeleri | Şehir Hatları A.Ş. (sehirhatlari.istanbul) | Kamuya açık tarife; kaynak gösterilerek |
| `traffic_segments.geojson`, `traffic_snapshot.json` | Çevredeki 101 yol parçası ve örnek trafik yoğunluğu | İBB Ulaşım Yönetim Merkezi (uym.ibb.gov.tr) | Kamuya açık servis; kaynak gösterilerek |
| `meta.json` | Katman meta verisi (kaynak, tarih, yöntem notları) | Proje ekibi | CC BY 4.0 |

## Uygulamanın canlı çektiği veriler (dosya yok)

| Veri | Kaynak | Lisans |
|---|---|---|
| Hava durumu (sıcaklık, nem, rüzgâr, bulutluluk, ışınım, yağış) | Open-Meteo | CC BY 4.0 |
| Hava kalitesi (Avrupa AQI, PM2.5, PM10, NO₂, O₃, SO₂) | Copernicus CAMS, Open-Meteo üzerinden | CC BY 4.0 |
| Canlı trafik yoğunluğu | İBB Ulaşım Yönetim Merkezi | Kamuya açık servis |

## Depoya konmayan veriler

Aşağıdaki veriler yarışma kapsamında kurumlardan alınmıştır; yeniden dağıtım izni olmadığı için depoda yer almaz.
ETL betikleri (`etl/`) bu verilerden katmanları yeniden üretir.

- İBB yarışma belgeleri: halihazır harita (2B/3B), ortofoto, ağaç rölevesi ve raporu, Kadıköy Meydanı Düzenleme Projesi,
  mülkiyet, tescilli yapılar ve sit alanları, altyapı (AYEDAŞ, İGDAŞ, İSKİ), taksi-dolmuş ve deniz ulaşımı hatları,
  yolcu kullanım istatistikleri 2019–2020, 2020 kamuoyu anketi
- İETT aktif durak ve güzergâh verisi (07.10.2026)

## Literatür parametreleri

`backend/app/literature/params.yaml`: ağaç ve yeşil alanın soğutma etkisi katsayıları (Santamouris 2013, EPA 2008,
Armson 2012, Lee 2013, Bowler 2010). Her parametrenin kaynağı dosyada yazılıdır.
