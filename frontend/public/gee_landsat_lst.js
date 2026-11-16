// TRANSHEAT TWIN — Landsat 8/9 Collection 2 Level-2 yüzey sıcaklığı (LST) üretimi
// Google Earth Engine Code Editor'a yapıştırıp çalıştırın; çıktı Google Drive'a GeoTIFF olarak gider.
// Çıktı birimi: °C (yüzey/deri sıcaklığı — hava sıcaklığı veya termal konfor DEĞİLDİR).
//
// Ölçekleme: ST_B10 × 0.00341802 + 149.0 = Kelvin (USGS Landsat Collection 2 Level-2 ürün tanımı).
// Bulut maskesi: QA_PIXEL bit 1 (dilate bulut), 2 (sirrus), 3 (bulut), 4 (bulut gölgesi).
// Çözünürlük: termal bant 100 m'de ölçülür, ürün 30 m'ye yeniden örneklenmiş olarak dağıtılır.

var region = ee.Geometry.Rectangle([29.0105, 40.9840, 29.0300, 41.0005]); // Kadıköy Meydanı çevresi (WGS84)
var start = '2024-06-01';
var end   = '2024-09-15';
var maxCloud = 20; // sahne bulutluluğu üst sınırı (%)

function maskAndScale(img) {
  var qa = img.select('QA_PIXEL');
  var clear = qa.bitwiseAnd(1 << 1).eq(0)
    .and(qa.bitwiseAnd(1 << 2).eq(0))
    .and(qa.bitwiseAnd(1 << 3).eq(0))
    .and(qa.bitwiseAnd(1 << 4).eq(0));
  var lst = img.select('ST_B10').multiply(0.00341802).add(149.0).subtract(273.15).rename('LST_C');
  return lst.updateMask(clear).copyProperties(img, ['system:time_start', 'SPACECRAFT_ID', 'CLOUD_COVER']);
}

var col = ee.ImageCollection('LANDSAT/LC08/C02/T1_L2')
  .merge(ee.ImageCollection('LANDSAT/LC09/C02/T1_L2'))
  .filterBounds(region)
  .filterDate(start, end)
  .filter(ee.Filter.lt('CLOUD_COVER', maxCloud))
  .map(maskAndScale);

print('Kullanılan sahne sayısı', col.size());
print('Sahne tarihleri', col.aggregate_array('system:time_start').map(function (t) { return ee.Date(t).format('YYYY-MM-dd'); }));

// Yaz dönemi medyanı (tek sahne yerine; tarih aralığını raporlayın)
var lst = col.median().clip(region);
Map.centerObject(region, 15);
Map.addLayer(lst, {min: 25, max: 50, palette: ['313695', '74add1', 'ffffbf', 'f46d43', 'a50026']}, 'LST (°C)');

Export.image.toDrive({
  image: lst.toFloat(),
  description: 'kadikoy_lst_' + start + '_' + end,
  region: region,
  scale: 30,
  crs: 'EPSG:32635',
  maxPixels: 1e9,
  fileFormat: 'GeoTIFF'
});
