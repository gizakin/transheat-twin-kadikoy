# TRANSHEAT TWIN

**Kadıköy Meydanı Ulaşım ve Kentsel Isı Dijital İkizi**
Marmara Belediyeler Birliği · *Yer Gözlemden Dijital İkize* Programı

Ekip: Büşra Ertaş, Gizem Kaya, Meltem Özden, Bengüsu Turan, Yavuz Yalçın

**Canlı arayüz / Live app: https://gizakin.github.io/transheat-twin-kadikoy-web/**

**Tanıtım filmleri / Films:** [Releases → Tanıtım filmleri](https://github.com/gizakin/transheat-twin-kadikoy/releases/tag/v1.0-film)
— kısa film 1:11 (16:9), tanıtım filmi 3:27 (16:9), teaser 0:30 (9:16). Seslendirme: ElevenLabs (yalnızca ticari olmayan kullanım).

**Sunum / Presentation:** [PDF](docs/TRANSHEAT_TWIN_Sunum.pdf) · [PowerPoint](https://github.com/gizakin/transheat-twin-kadikoy/releases/tag/v1.0-sunum)

---

## Türkçe

TRANSHEAT TWIN, kentsel ısı adası etkisini ulaşım ve yaya hareketliliğiyle birlikte değerlendirmek için geliştirilen,
tarayıcıda çalışan bir dijital ikiz ve karar destek prototipidir. Uydu tabanlı yüzey sıcaklığını (Landsat), gölge
geometrisini, İBB canlı trafik, hava durumu ve hava kalitesi verilerini ve 24 saatlik yaya ajan simülasyonunu tek
ortamda birleştirir; ağaçlandırma ve gölgelendirme gibi müdahalelerin etkisini aynı yolcu hareketliliği altında
mevcut durum ve proje ile karşılaştırır.

Örnek bulgu (simülasyon): sahil yaya aksına 30 ağaç eklenen senaryoda, 15 Temmuz 14:00–15:00 arasında aktarma yapan
1.620 yolcunun güneş altında yürüdüğü süre **%8,9** azalır.

### Neler var

| Modül | Açıklama |
|---|---|
| Isı | Landsat 2025 yüzey sıcaklığı, yerel kalibrasyonlu ve literatür tabanlı ısı simülasyonu (ΔLST) |
| Gölge | NOAA güneş konumu; bina ve ağaç gölgesi, 0,5 m ızgara, istenen tarih ve saat |
| Ulaşım | İETT, dolmuş, vapur, M4; İBB canlı trafik; aktarma güzergâhları, durağa 400 m erişim |
| Yaya | 24 saatlik talep modeli (İBB yolcu verisi + Şehir Hatları tarifesi), ajan simülasyonu, güneşte geçen süre |
| Senaryo | Ağaç, yeşil alan, gölgelik, zemin değişimi; mevcut / proje / senaryo karşılaştırması |
| Görselleştirme | 2B/3B harita, yaya gözü (1,7 m), bölünmüş ekran, yüksek çözünürlüklü görsel dışa aktarma |

### Klasörler

```
frontend/   React + TypeScript + MapLibre GL arayüzü; analiz motoru tarayıcıda (src/engine)
backend/    FastAPI sunucusu ve Python hesaplama modülleri
etl/        Veri hazırlama betikleri (DWG → CBS, ortofoto, LST, İBB açık veri, tarife, trafik)
docs/       Ayrıntılı kurulum ve geliştirme notları
```

### Kurulum

```
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
cd frontend
npm install
npm run dev            # http://localhost:5173
```

Ayrıntılar: [docs/GELISTIRME.md](docs/GELISTIRME.md)

### Veri

Bu depoda yalnızca **açık verilerden türetilen** dosyalar bulunur (`frontend/public/data/`). Yarışma kapsamında İBB'den
alınan veriler (halihazır, ağaç rölevesi, ortofoto, proje çizimi, mülkiyet, altyapı vb.) ve İETT durak/güzergâh verisi
yeniden dağıtım izni olmadığı için depoya konmamıştır; bu nedenle uygulama depodan tek başına tam çalışmaz. Ayrıntı ve
kaynaklar: [VERI.md](VERI.md).

### Sınırlar

Senaryo sıcaklıkları ve yaya sonuçları **simülasyondur, ölçüm değildir**. Yüzey sıcaklığı 30 m çözünürlüklü tek bir
Landsat bileşimidir; termal konfor (Tmrt, UTCI, PET) hesaplanmaz; gölgeler bulutsuz gökyüzü varsayımıyla hesaplanır;
yaya talebinin bir kısmı varsayımdır. Saha doğrulaması henüz yapılmamıştır. Sistem "en iyi senaryo" hükmü vermez.

---

## English

TRANSHEAT TWIN is a browser-based digital twin and decision-support prototype that assesses the urban heat island
effect together with transport and pedestrian mobility at Kadıköy Square, Istanbul. It combines Landsat land surface
temperature, shadow geometry, live İBB traffic, weather and air-quality data and a 24-hour pedestrian agent simulation,
and compares interventions such as tree planting and shading against the current state and the official square design
under the same passenger flows. Example (simulation): adding 30 trees along the waterfront walkway reduces the time
transferring passengers spend walking in the sun by **8.9%** (15 July, 14:00–15:00, 1,620 passengers).

Only open-data-derived files are included; datasets provided by İBB for the competition are not redistributed (see
[VERI.md](VERI.md)). Results are simulations, not measurements; field validation has not been carried out yet.

## Lisans

- Kod: [MIT](LICENSE)
- İçerik ve dokümantasyon: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/deed.tr)
- Üçüncü taraf veriler kendi lisanslarına tabidir ([VERI.md](VERI.md)).
- Tanıtım filmleri CC BY 4.0 kapsamında değildir: seslendirme ElevenLabs ücretsiz planıyla üretildiğinden yalnızca ticari olmayan amaçlarla, "Seslendirme: ElevenLabs" atfıyla paylaşılabilir.
