// Kullanım kılavuzu ve yardım sayfası. Metin, arayüzdeki gerçek düğme ve sekme adlarını kullanır.
const TOC: [string, string][] = [
  ['hizli', 'Hızlı başlangıç'], ['ekran', 'Ekran düzeni'], ['akis', 'Adım adım kullanım'], ['mudahale', 'Müdahale türleri'],
  ['gosterge', 'Göstergeler ve yöntem etiketleri'], ['zaman', 'Tarih, saat ve gölge'], ['katman', 'Katmanlar'], ['karsilastirma', 'Karşılaştırma'],
  ['rapor', 'Rapor ve paylaşım'], ['veri', 'Veri yükleme ve ısı haritası'], ['sinir', 'Sınırlar ve bilinmesi gerekenler'], ['sss', 'Sık sorulan sorular'],
]

const H = ({ id, children }: { id: string; children: React.ReactNode }) => <h3 id={`h-${id}`} className="help-h">{children}</h3>

export default function HelpPage({ goMap }: { goMap: () => void }) {
  const jump = (id: string) => document.getElementById(`h-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  return <div className="page help">
    <h2>Kullanım kılavuzu</h2>
    <div className="muted">Dijital İkiz ve Kentsel Analiz Platformu (Kadıköy Meydanı Ulaşım ve Kentsel Isı Dijital İkizi; geliştirici: Transheat Twin), Kadıköy Meydanı'nda bir alanı değiştirdiğinizde yeşil alan, gölge, sert zemin ve yaya aktarma göstergelerinin nasıl
      değişeceğini hesaplar. Sistem karar vermez; değişimi, yöntemini ve belirsizliğini gösterir.</div>

    <nav className="card help-toc" aria-label="İçindekiler">
      {TOC.map(([id, l], i) => <button key={id} className="how" onClick={() => jump(id)}>{i + 1}. {l}</button>)}
    </nav>

    <div className="card">
      <H id="hizli">1. Hızlı başlangıç (2 dakika)</H>
      <ol className="steps">
        <li><b>Harita ve senaryo</b> sekmesinde haritada meydandaki gri (sert zemin) bir alana tıklayın.</li>
        <li>Açılan pencerede <b>“Bu alanı nasıl değiştirmek istiyorsunuz?”</b> sorusunun altından <b>Ağaç ekle</b>'yi seçin.</li>
        <li>Sol panelde ağaç sayısı, taç çapı ve boyu düzenleyin; senaryoya bir ad verin.</li>
        <li><b>Senaryoyu Çalıştır</b>'a basın. Sağ panelde önce/sonra göstergeleri, haritada yeni ağaçlar (yeşil daire) ve yeni gölge (mavi) görünür.</li>
        <li>Beğendiyseniz <b>Senaryoyu Kaydet</b>; sonra <b>Karşılaştırma</b> ve <b>Rapor</b> sekmelerinde kullanın.</li>
      </ol>
      <button className="btn primary small" onClick={goMap}>Haritaya git</button>
    </div>

    <div className="card">
      <H id="ekran">2. Ekran düzeni</H>
      <dl className="help-dl">
        <dt>Üst çubuk</dt><dd>Sekmeler (Harita ve senaryo, Karşılaştırma, Literatür ve varsayımlar, Veri kataloğu, Rapor, Yardım); <b>MEVCUT / PROJE / Split Screen</b> görünüm düğmeleri;{' '}
          <b>3B</b> düğmesi; tarih, mevsim ve saat seçicisi.</dd>
        <dt>Sol panel</dt><dd>Senaryo adı, temel durum (Mevcut / Proje), seçilen alanın özeti, müdahale kartları, <b>Senaryoyu Çalıştır</b> ve <b>Senaryoyu Kaydet</b>; altında katman listesi.</dd>
        <dt>Harita</dt><dd>Ortofoto üzerinde yüzey sınıfları, binalar, ağaçlar, gölge ve senaryo çizimleri. Üstte <b>Alan seç (çiz)</b> ve sonuç varken <b>Etkilenen alanları göster</b>.</dd>
        <dt>Sağ panel</dt><dd>Senaryo yokken seçili durumun göstergeleri ve gün içi gölge grafiği; senaryo çalıştırınca sonuç, literatür etkileri ve etki analizi.</dd>
      </dl>
    </div>

    <div className="card">
      <H id="akis">3. Adım adım kullanım</H>
      <ol className="steps">
        <li><b>Çalışma alanını açın.</b> Harita yarışma alanı sınırıyla (beyaz kesikli çizgi) açılır.</li>
        <li><b>Mevcut durumu inceleyin.</b> Sağ paneldeki kartlar tüm çalışma alanı içindir. Her kartta yöntem etiketi ve <b>Nasıl hesaplandı?</b> bağlantısı vardır.</li>
        <li><b>Isı haritasını açın.</b> Landsat LST 2025 katmanı yüklü gelir: sol listeden <b>Isı haritası (uydu LST)</b>'yi işaretleyin.
          Sağ panelde °C lejantı, çalışma alanı istatistikleri ve “Verinin söyledikleri” özeti görünür.</li>
        <li><b>Proje durumunu açın.</b> <b>PROJE</b> düğmesi İBB Meydan Düzenleme Projesi'nin yüzeylerini gösterir. <b>Split Screen</b>'de solda MEVCUT, sağda PROJE vardır;
          ortadaki <b>⇔</b> tutamacını sürükleyerek (ya da klavyede ←/→) sınırı kaydırırsınız. İki harita birlikte hareket eder; alan çizimi soldaki (MEVCUT) haritada yapılır.</li>
        <li><b>Bir alan seçin.</b> İki yol: (a) haritada bir yüzeye tıklayın — ölçüm çizgilerine göre bölünmüş hazır parçalar seçilir; (b) <b>Alan seç (çiz)</b> ile kendi poligonunuzu çizin
          (köşelere tıklayın, ilk noktaya tıklayarak kapatın).</li>
        <li><b>Müdahale seçin.</b> Açılan penceredeki seçeneklerden birini seçin ya da sol paneldeki <b>Müdahale ekle</b> listesini kullanın.</li>
        <li><b>Parametreleri girin.</b> Kartta alanı <b>Alan çiz</b> / <b>Seçili alanı kullan</b> ile bağlayın; “✓ Alan tanımlı” yazmalıdır.</li>
        <li><b>Senaryoyu Çalıştır.</b> Birkaç saniye sürer.</li>
        <li><b>Haritada değişimi görün.</b> Turuncu çerçeve müdahale alanı, yeşil daireler yeni ağaçlar, mavi yeni gölge, kırmızı çizgiler etkilenen aktarma güzergâhlarıdır.</li>
        <li><b>KPI değişimlerini görün.</b> Kartlarda ▲/▼ ve “önce” değeri yazar; yeşil istenen yönde, kırmızı istenmeyen yönde değişimdir.</li>
        <li><b>Senaryoyu Kaydet.</b></li>
        <li><b>Karşılaştırın.</b> <b>Karşılaştırma</b> sekmesinde en fazla 3 senaryo seçin.</li>
        <li><b>Rapor oluşturun.</b> <b>Rapor</b> sekmesinde senaryoları işaretleyip <b>Raporu oluştur</b>.</li>
      </ol>
      <div className="info small">Birden fazla müdahale eklerseniz (ör. ağaç + geçirgen yüzey + gölgeleme) senaryo türü otomatik olarak <b>Karma senaryo</b> olur.</div>
    </div>

    <div className="card">
      <H id="mudahale">4. Müdahale türleri ve parametreleri</H>
      <div className="tablewrap"><table className="t">
        <thead><tr><th>Müdahale</th><th>Parametreler</th><th>Ne hesaplanır</th></tr></thead>
        <tbody>
          <tr><td>Ağaçlandırma</td><td>Ağaç sayısı, taç çapı, boy, tür</td><td>Ağaçlar alana taç çapı aralığıyla altıgen düzende yerleşir (bina, su ve mevcut taçların üstüne konmaz). Taç örtüsü, gölge, altyapı hattına yakınlık.</td></tr>
          <tr><td>Yeşil alan / Sert zemini azalt</td><td>Alan</td><td>Seçilen sert zemin çim/bitkili alana dönüşür (bina ve su değişmez).</td></tr>
          <tr><td>Gölgeleme elemanı</td><td>Yükseklik, gölgeleme oranı (%), tür</td><td>Elemanın gölgesi güneş açısına göre kaydırılır; %100'ün altındaki oran kısmi gölge olarak ağırlıklandırılır.</td></tr>
          <tr><td>Fotovoltaik gölgeleme</td><td>Yükseklik, gölgeleme oranı</td><td>Yalnızca gölgesi hesaplanır; enerji üretimi için doğrulanmış parametre yoktur.</td></tr>
          <tr><td>Zemin malzemesi değişimi</td><td>Mevcut malzeme, yeni malzeme, yeni albedo</td><td>Mevcut malzeme asfalt veya betonsa albedo farkı ve literatüre dayalı yüzey sıcaklığı aralığı verilir; diğerlerinde “tanımlanmamış”.</td></tr>
          <tr><td>Açık renkli / cool pavement</td><td>Mevcut malzeme, albedo</td><td>Aynı yöntem; varsayılan yeni albedo 0,40.</td></tr>
          <tr><td>Geçirgen yüzey</td><td>Yeni malzeme</td><td>Geçirgen yüzey oranı değişir; sıcaklık etkisi için sayısal literatür değeri yoktur.</td></tr>
          <tr><td>Yaya güzergâhı</td><td>Çizgi</td><td>Uzunluk ve seçilen saatte gölgede kalan pay.</td></tr>
          <tr><td>Aktarma alanı</td><td>Nokta, tür (otobüs, minibüs, iskele, metro), ad</td><td>Yeni noktayla en kısa yürüme yolları yeniden hesaplanır; ortalama aktarma mesafesi değişir.</td></tr>
        </tbody></table></div>
    </div>

    <div className="card">
      <H id="gosterge">5. Göstergeler ve yöntem etiketleri</H>
      <p>Her göstergenin yanında hangi yolla üretildiği yazar. <b>Nasıl hesaplandı?</b> bağlantısı veri kaynağını, tarihini, parametreyi, formülü, literatürü, varsayımları ve belirsizliği gösterir.</p>
      <ul className="plain">
        <li><span className="badge data">Veri tabanlı gözlem</span> Yarışma verisinden (CAD, SHP, ortofoto) ya da yüklediğiniz uydu rasterından gelir.</li>
        <li><span className="badge geometric">Geometrik hesaplama</span> Alan, oran, gölge ve mesafe; 0,5 m ızgarada hesaplanır.</li>
        <li><span className="badge literature">Literatür tabanlı tahmin</span> Doğrulanmış kaynaklardaki aralıklar; Kadıköy'de ölçülmemiştir.</li>
        <li><span className="badge assumption">Varsayım</span> Açıkça yazılan kabuller (kat yüksekliği 3 m, opak ağaç tacı vb.).</li>
        <li><span className="badge model">Model tabanlı sonuç</span> Fiziksel mikroklima modeli; bu prototipte çalıştırılmadığı için Tmrt/UTCI/PET “Model çalıştırılmadı” yazar.</li>
      </ul>
      <dl className="help-dl">
        <dt>Güneşe açık sert zemin</dt><dd>Isı maruziyetinin geometrik vekilidir: gölgede olmayan geçirimsiz yüzey (m²). Bir sıcaklık değeri değildir.</dd>
        <dt>Gölgeli alan oranı</dt><dd>Seçilen tarih ve saatte binaların, ağaçların ve gölgeleme elemanlarının açık zemine düşen gölgesi.</dd>
        <dt>Aktarma yürüme mesafesi</dt><dd>İskele, metro yapıları, otobüs ve minibüs durakları arasındaki en kısa yürüme yolları ortalaması.</dd>
        <dt>İETT durağına ≤400 m erişim</dt><dd>Çalışma alanındaki yürünebilir zeminin, en yakın aktif İETT durağına (07.10.2026 verisi) 400 m (≈5 dk) içinde kalan payı. Katmanlar → “Durağa yürüme erişimi” haritada 0–200 / 200–400 / 400 m üzeri bantlarını gösterir; senaryoya eklenen otobüs durakları hesaba katılır.</dd>
        <dt>Hava durumu (Open-Meteo)</dt><dd>Sağ paneldeki bölüm, seçili tarih ve saat için Open-Meteo sayısal hava modelinden sıcaklık, hissedilen sıcaklık, nem, rüzgâr, bulutluluk, direkt ve yayılı güneş ışınımı ile UV indeksini gösterir; bugün için 15 dakikalık güncel değer kullanılır ve canlı modda 15 dakikada bir yenilenir. Son üç ay ile önümüzdeki 15 gün tahmin servisinden, daha eski tarihler arşivden (yeniden analiz) gelir. Değerler modelin ızgara hücresine aittir, istasyon ölçümü değildir (Model tabanlı sonuç). Direkt normal ışınım WMO güneşlenme eşiği olan 120 W/m²'nin üzerindeyse güneş “açık” sayılır ve hesaplanan gölgeler o saat için anlamlıdır; altındaysa güneş bulut arkasındadır ve gölge farkı zayıftır. Gölge hesabı bulutları içermez. Veri: Open-Meteo.com (CC BY 4.0).</dd>
        <dt>Paneller ve bölümler</dt><dd>Sol panelde senaryo, çalışma alanı, müdahaleler, harita katmanları ve analiz araçları; sağ panelde genel durum, hava, kentsel ısı, yeşil alan ve gölge, ulaşım, yaya simülasyonu ile performans ve karşılaştırma bölümleri vardır. Bölümler kapalı açılır; başlığa tıklayınca açılır ve tarayıcı hangi bölümleri açık bıraktığınızı hatırlar. Paneller başlıktaki ‹ › düğmesiyle veya haritanın kenarındaki sekmeyle kapatılıp açılır; harita boşalan alanı kaplar. Panel ile harita arasındaki çizgi sürüklenerek panel genişletilir. Senaryoyu Çalıştır ve Kaydet düğmeleri sol panelin altında her zaman görünür.</dd>
        <dt>Aydınlık / karanlık mod</dt><dd>Üst çubuğun sağındaki güneş ve ay düğmeleri temayı değiştirir. İlk açılışta işletim sisteminin teması kullanılır; seçtiğiniz tema tarayıcıda saklanır. Tema değişirken sayfa yeniden yüklenmez; harita, katmanlar ve yaya simülasyonu kaldığı yerden devam eder. Karanlık modda ortofoto altlık korunur, yalnızca parlaklığı hafifçe azaltılır; dışa aktarılan görseller bundan etkilenmez.</dd>
        <dt>Simülasyon zaman çizelgesi</dt><dd>Yaya akışı açıkken haritanın altında görünür: yeniden başlat, oynat/duraklat/devam, durdur (başa döner), ×10/×30/×60 hız ve simülasyon saati. Çizelgedeki küçük çizgiler vapur varışlarıdır (sefer aralığı varsayımdan); çizelgeye tıklayarak veya sürükleyerek istenen ana gidilir. Sağ paneldeki “İskele çevresinde” ve “M4 çevresinde” sayıları, o anda iskeleye veya M4 yapısına 50 m'den yakın yürüyen yolculardır (model tabanlı).</dd>
        <dt>Zamansal yolcu yoğunluğu</dt><dd>Sol paneldeki bölüm yaya simülasyonunun talebini günün saatine, hafta içi/hafta sonuna, mevsime, resmî tatile, yağışa ve özel etkinliklere göre üretir (dinamik model). Vapur ve M4 binişlerinin günlük hacmi ve hafta içi/hafta sonu saatlik dağılımı İBB açık verisinden; vapur kalkış ve varışları Şehir Hatları resmî tarifesinden gelir. İnişlerin saatlik dağılımı, çarşı ve meydan/sahil yayası, Turyol sefer aralığı, bekleme süreleri ve tüm çarpanlar varsayımdır; her biri düzenlenebilir ve 1,00 günlük ortalama saattir. Binen yolcular kalkıştan önce iskeleye gelip bekler, aktarma yolcuları otobüs ve dolmuş duraklarında bekler (haritada mavi). Simülasyon tek saat ya da 24 saat çalıştırılabilir; her saatin yürüyüşü o saatin gölgesiyle hesaplanır. Sonuçlar: saatlik üretilen yolculuk, iskeleden çıkan ve iskeleye gelen yolcu, aktarmalar, bekleyenler, aynı anda yürüyenler ve bölgesel yoğunluk (kişi/100 m², yürünebilir alan). Çalışma alanında Marmaray istasyonu yoktur; metro bağlantısı M4 Kadıköy’dür. “Basit” model önceki tek pencereli simülasyondur.</dd>
        <dt>Veri alınamadığında</dt><dd>Hava, hava kalitesi veya İBB canlı trafik verisine ulaşılamazsa ilgili bölümde küçük bir durum satırı, son başarılı alım saati ve “Tekrar dene” bağlantısı görünür. Aynı tarihe ait son alınan değerler varsa onlar gösterilir; hiçbir zaman tahmini bir değer gerçek veri gibi gösterilmez.</dd>
        <dt>Görseli dışa aktar</dt><dd>Üst çubuktaki “Dışa aktar” düğmesi haritayı ve analiz sonuçlarını akademik çalışma, jüri sunumu ve rapor için yüksek çözünürlüklü görsel olarak indirir. Görsel türü (ekrandaki görünüm, mevcut durum, proje, seçili senaryo, Mevcut ↔ Proje veya müdahale öncesi ↔ sonrası karşılaştırması), içerik ön ayarı (ekrandaki katmanlar, kentsel ısı, yeşil alan ve gölge, ulaşım ve aktarma), çözünürlük (2K, 4K veya cihazın grafik kartının izin verdiği en yüksek değer, en fazla 8192 px), PNG/JPEG ve yatay/dikey düzen seçilir. İsteğe bağlı olarak başlık, lejant ve renk skalası, ölçek çubuğu ve kuzey oku, veri kaynağı ve yöntem, tarih ve çözünürlük bilgisi ile açıklama eklenir. Harita seçilen çözünürlükte yeniden çizilir (ekran görüntüsü büyütülmez); düğmeler, menüler ve imleç görsele girmez. Lejant ve açıklamalar yalnızca haritada görünen katmanlardan ve hesaplanmış sonuçlardan üretilir; simülasyon çıktıları “literatür tabanlı tahmin, ölçüm değildir” olarak, hava ve hava kalitesi “model tabanlı” olarak etiketlenir. Eğik (3B) görünümde ölçek çubuğu çizilmez.</dd>
        <dt>Hava kalitesi (CAMS · Open-Meteo)</dt><dd>Seçili saat için Copernicus CAMS Avrupa hava kalitesi modelinden Avrupa hava kalitesi indeksi (İyi, Makul, Orta, Kötü, Çok kötü, Son derece kötü) ile PM2.5, PM10, NO₂, ozon ve SO₂ değerleri gösterilir. Günlük ortalamalar WHO 2021 kılavuz değerleriyle karşılaştırılır (24 saatlik; ozon için en yüksek 8 saatlik ortalama); aşım ▲ ile işaretlenir. Model çözünürlüğü yaklaşık 11 km'dir, istasyon ölçümü değildir.</dd>
        <dt>Canlı saat</dt><dd>Platform açıldığında gölge, İstanbul'daki gerçek tarih ve saate göre hesaplanır ve her dakika güncellenir (üst çubukta “● canlı”). Tarih, mevsim veya saat elle değiştirilince canlı takip durur; “Şimdi” düğmesi gerçek zamana geri döndürür. Güneş ufkun altındayken “gece” yazar ve gölge göstergeleri anlamlı değildir.</dd>
        <dt>Yaya akışı (ajan simülasyonu)</dt><dd>Katmanlar → “Yaya akışı” iskelelere yanaşan vapurlardan ve M4 trenlerinden inen yolcuları ajan olarak simüle eder: her yolcu en kısa yürüme yolundan otobüs, dolmuş veya metroya yürür, haritada güneşteyse turuncu, gölgedeyse koyu yeşil nokta olarak görünür. Sağ panelde oynat/duraklat, hız (×10, ×30, ×60), simülasyon saati, anlık yürüyen ve güneşte yürüyen kişi sayısı yer alır. “Aynı yolcular, farklı durumlar” tablosu aynı yolcu kümesinin mevcut durumda, projede ve çalıştırılan senaryoda güneşte geçirdiği toplam kişi-dakikayı karşılaştırır. Yolcu sayıları, sefer aralıkları, yön payları ve yürüme hızı ölçüm değil, “Varsayımlar” bölümünden değiştirilebilen varsayımlardır; güneş/gölge başlangıç saatinin geometrik gölgesidir (bulutsuz gökyüzü).</dd>
        <dt>Yaya konforu (aktarma güzergâhları)</dt><dd>Katmanlar → “Yaya konforu” her aktarma güzergâhının (iskele, M4, İETT, dolmuş arası 33 en kısa yürüme yolu) seçilen tarihte 07:00–20:00 arasında saat saat ne kadarının gölgede kaldığını hesaplar. Sağ paneldeki tabloda satırlar güzergâhlar, sütunlar saatlerdir; koyu hücre gölgeli, açık hücre güneşli demektir. Bir hücreye tıklayınca o saate geçilir. Seçilen güzergâh için gölgeli pay, güneşte yürüme süresi (varsayım: 1,2 m/s), en gölgeli ve en güneşli saat, güzergâh boyunca uydu yüzey sıcaklığı ve diğer durumla (mevcut/proje) karşılaştırma verilir. “Neler yapılabilir?” bölümü 15 m'den uzun kesintisiz güneşli kesimleri listeler; “senaryoda ağaç dene” kesimin iki yanına 3 m'lik bir şerit çizip ağaçlandırma müdahalesi ekler, etkisi senaryo çalıştırılınca ölçülür. Konfor burada gölgeli paydır; Tmrt, UTCI ve PET hesaplanmaz, bulutsuz gökyüzü varsayılır.</dd>
        <dt>Yaya gözü (sokak görünümü)</dt><dd>Üst çubuktaki “Yaya gözü” düğmesi kamerayı 1,7 m göz hizasına indirir. Haritaya tıklayınca o noktaya gidilir (en fazla 120 m), sürükleyince etrafa bakılır; ok tuşları veya W A S D ile yürünür, fare tekerleği ileri-geri götürür. Split Screen'de mevcut ve proje aynı noktadan, aynı yöne bakarak görünür. Binalar ölçülen yüksekliklerine göre, ağaçlar boy ve taç çapına göre hacim olarak çizilir; zemin ortofoto ve yüzey sınıflarıdır. Görünüm fotoğraf gerçekliğinde değildir; doku veya süs eklenmez.</dd>
        <dt>Canlı trafik yoğunluğu (İBB)</dt><dd>Katmanlar → “Canlı trafik yoğunluğu (İBB)” açıldığında çalışma alanının 1,5 km çevresindeki 101 yol parçasının hızı ve yoğunluk sınıfı İBB Ulaşım Yönetim Merkezi'nden (Trafik Yoğunluk Haritası ile aynı kaynak) alınır ve her 60 saniyede yenilenir. Renkler İBB haritasıyla aynıdır: Serbest, Açık, Akıcı, Yoğun, Çok yoğun. Sağ panel çalışma alanındaki ve çevredeki uzunluk ağırlıklı ortalama hızı ve sınıflara göre yol uzunluğunu gösterir. Canlı bağlantı kurulamazsa son anlık görüntü gösterilir ve “anlık görüntü” olarak etiketlenir. Bu veri gözlemdir; ısı ve senaryo hesaplarına girdi olarak katılmaz.</dd>
        <dt>Canlı trafiğin diğer analizlere bağlanması</dt><dd>İBB canlı trafik verisi üç yerde gözlem olarak kullanılır (tahmin yapılmaz): (1) Yaya konforu: aktarma güzergâhlarının şu an “Yoğun/Çok yoğun” yol parçalarına ≤10 m olan kesimleri (sıcaklık değil, maruziyet göstergesi; seçili güzergâhta haritada bordo kesikli). (2) Senaryo: müdahale alanının kestiği yol parçaları, canlı hızları ve oradan geçen otobüs hattı sayısı; müdahalenin trafiğe etkisi tahmin edilmez. (3) Hat seçici: seçilen İETT hattının çalışma alanının 1,5 km çevresindeki kesiminin yol parçası hızlarından hesaplanan canlı geçiş süresi (durakta bekleme dahil değil). Trafik verisi her zaman şu anki ölçümdür; seçili saat başka bir saatse panelde belirtilir.</dd>
        <dt>Otobüs hat yoğunluğu ve hat seçici</dt><dd>“Otobüs hat yoğunluğu” katmanında çizgi kalınlığı ve rengi o yol parçasından geçen farklı hat sayısını gösterir. Sol paneldeki “İETT hattını göster” listesinden bir hat seçildiğinde gidiş (mavi) ve dönüş (pembe) güzergâhı çizilir, hattın uğramadığı duraklar soluklaşır. Durağa tıklayınca o duraktan başlayan ve yakından geçen hatlar görünür; durak–hat eşleşmesi güzergâha ≤12 m yakınlıktan türetilmiştir, resmi durak-hat tablosu değildir.</dd>
        <dt>Semboller (+, ++, +++)</dt><dd>Karşılaştırmada Mevcut duruma göre göreli değişim: %1'den az “0”, %1–10 “±”, %10–30 “±±”, %30'dan fazla “±±±”. İşaret, göstergenin istenen yönüne göredir.</dd>
      </dl>
    </div>

    <div className="card">
      <H id="zaman">6. Tarih, saat ve gölge</H>
      <p>Üst çubukta <b>Mevsim</b> listesinden 21 Mart, 21 Haziran, 15 Temmuz, 23 Eylül veya 21 Aralık'ı seçin, ya da tarihi elle girin. Kaydırıcı saati 06:00–20:00 arasında değiştirir.
        Gölge ve tüm gölgeye bağlı göstergeler hemen yeniden hesaplanır. Sağ paneldeki <b>Gün içi gölge profili</b> seçilen gündeki saatlik gölge oranını gösterir.</p>
      <div className="note small">Meteorolojik veri olmadığı için hesap bulutsuz gökyüzü varsayar. Senaryo sonuçlarında bu durum ayrıca not edilir.</div>
    </div>

    <div className="card">
      <H id="katman">7. Katmanlar</H>
      <p>Sol paneldeki <b>Katmanlar</b> listesinden açıp kapatın. Bir katmanın üzerine gelince kaynağı ve tarihi görünür. Önemli katmanlar:</p>
      <ul className="plain">
        <li><b>Yüzey sınıfları</b>: yeşil, geçirgen, sert zemin, asfalt, su (renk anahtarı listenin altında).</li>
        <li><b>INSITU önerisi</b>: 2020 yarışma önerisinin 1/2000 planı; yalnızca görsel referanstır, göstergeler bundan hesaplanmaz.</li>
        <li><b>Aktarma noktaları ve güzergâhları</b>, <b>Tescilli yapılar</b>, <b>Sit alanları</b>, <b>Mülkiyet</b>, <b>Altyapı hatları</b>.</li>
      </ul>
      <p>Haritada bir binaya tıklayınca kat adedi ve yüksekliğin nereden geldiği, bir ağaca tıklayınca tür, boy, taç ve sağlık bilgisi görünür. <b>3B</b> düğmesi binaları ve ağaçları yükseklikleriyle gösterir.</p>
    </div>

    <div className="card">
      <H id="karsilastirma">8. Karşılaştırma</H>
      <p>Kayıtlı senaryolardan en fazla üçünü işaretleyin. Tüm sütunlar <b>aynı alan (tüm çalışma alanı) ve aynı saat</b> için hesaplanır; bu yüzden değerler, senaryonun kendi sonuç
        panelindeki (müdahale çevresindeki) değerlerden küçük görünebilir. Ekranda gösterge tablosu, çok kriterli sembol tablosu, çubuk grafik, radar ve göreli değişim matrisi bulunur.</p>
      <div className="info small">Sistem senaryoları sıralamaz ve “en iyi” demez. Değerlendirme cümleleri yalnızca hesaplanan değişimlerden üretilir.</div>
    </div>

    <div className="card">
      <H id="rapor">9. Rapor ve paylaşım</H>
      <ul className="plain">
        <li><b>Raporu oluştur</b>: seçili senaryolar için 14 bölümlük rapor sayfada oluşur (veriler, yöntem, sonuçlar, şematik harita, grafik, varsayımlar, belirsizlikler, kaynaklar).</li>
        <li><b>CSV'yi kopyala</b>: gösterge tablosunu panoya kopyalar; Excel'e yapıştırabilirsiniz.</li>
        <li><b>JSON kopyala</b>: senaryonun tanımını kopyalar. Bir başkası <b>Senaryo JSON'u içe aktar</b> ile aynı senaryoyu kendi ekranında açabilir.</li>
      </ul>
      <div className="note small">Kayıtlı senaryolar yalnızca sizin tarayıcınızda saklanır; başkaları göremez. Paylaşmak için JSON'u gönderin.</div>
    </div>

    <div className="card">
      <H id="veri">10. Veri yükleme ve ısı haritası</H>
      <p>Uygulamada <b>Landsat LST 2025</b> katmanı hazır yüklüdür ve göstergelerdeki <b>Yüzey sıcaklığı (uydu)</b> değerini doldurur. Başka bir dönem için yeni bir GeoTIFF yükleyip
        <b>Isı katmanı yap</b> ile değiştirebilirsiniz. İki bantlı dosyalarda ikinci bant 0/255 maskesiyse otomatik maske olarak kullanılır; nodata tanımsızsa 0 değerleri “veri yok” sayılır.</p>
      <p><b>Isı simülasyonu.</b> PROJE görünümünde, Split Screen'in sağ tarafında ve bir senaryo sonucunda ısı katmanı <i>simüle edilmiş</i> haritayı gösterir;
        MEVCUT tarafı her zaman ölçülen Landsat verisidir. Sağ paneldeki <b>Isı simülasyonu</b> kartından yöntemi seçin:</p>
      <ul className="plain">
        <li><b>Yerel kalibrasyon</b> (önerilen): ΔLST = β × Δ(bitki örtüsü payı). β ≈ −1,5 °C, aynı Landsat verisinde Kadıköy'ün 2.545 kara pikselinden hesaplanmıştır.</li>
        <li><b>Literatür üst sınırı</b>: −24 °C × Δ(çim payı) − 19 °C × Δ(yeni ağaç tacı payı) (Armson vd., 2012). Nokta ölçümü üst sınırları olduğu için etkiyi abartabilir.</li>
        <li><b>Değişim (ΔLST)</b> görünümü yalnızca farkı gösterir: mavi serinleme, kırmızı ısınma. Küçük farklar normal LST renk ölçeğinde görünmeyebilir.</li>
      </ul>
      <div className="note small">Simülasyon ölçüm değildir; gölgeleme elemanları ve PV için uydu görüntüsü simüle edilmez. Sonuçlar yüzey sıcaklığı içindir, hava sıcaklığı veya konfor değildir.</div>
      <p><b>Veri kataloğu</b> sekmesinden GeoJSON, Shapefile (.zip), GeoTIFF, CSV (lon/lat veya x/y) ve KML yükleyebilirsiniz. Sistem türü ve koordinat sistemini (CRS) kontrol eder;
        CRS yoksa veriyi haritaya koymaz, ne yapmanız gerektiğini yazar. Dosyalar bilgisayarınızdan çıkmaz ve sayfa yenilenince silinir.</p>
      <ol className="steps">
        <li>Veri kataloğundaki <b>Google Earth Engine</b> bölümünden <b>Betiği kopyala</b>.</li>
        <li>GEE Code Editor'a yapıştırıp çalıştırın; tarih aralığını gerekirse değiştirin.</li>
        <li>Drive'a inen GeoTIFF'i <b>Isı haritası olarak kullan</b> işaretli yükleyin.</li>
        <li>Harita ekranında <b>Isı haritası (uydu LST)</b> katmanını açın; sağ panelde min/ortalama/maks ve sıcak nokta eşiği görünür, göstergelerde <b>Yüzey sıcaklığı (uydu)</b> dolar.</li>
      </ol>
      <div className="note small">Landsat yüzey sıcaklığı 30 m çözünürlüklüdür ve hava sıcaklığı değil, yüzey (deri) sıcaklığıdır.</div>
    </div>

    <div className="card">
      <H id="sinir">11. Sınırlar ve bilinmesi gerekenler</H>
      <ul className="plain">
        <li>Hiçbir sıcaklık değeri fiziksel model çalıştırılarak üretilmez; termal etkiler yalnızca literatür aralığıdır.</li>
        <li>Mevcut durumda asfalt/taş ayrımı yapılamadı; sert zemin kalan alan olarak türetildi.</li>
        <li>Proje durumu İBB Meydan Düzenleme Projesi çiziminden çıkarıldı; çizimin kapsamadığı yerlerde mevcut durum korunur. Projede ağaç katmanı olmadığından mevcut ağaçlar korunmuş varsayılır.</li>
        <li>Yürüme mesafeleri taşıt yollarını ayırmadığı için olduğundan kısa çıkabilir; 9 metro yapısında giriş/şaft ayrımı yapılamadı; T3 tramvay durakları veride yok.</li>
        <li>Ortofoto bu sürümde yaklaşık 0,5 m çözünürlüktedir.</li>
      </ul>
    </div>

    <div className="card">
      <H id="sss">12. Sık sorulan sorular</H>
      <dl className="help-dl">
        <dt>Senaryoyu Çalıştır düğmesi pasif.</dt><dd>En az bir müdahale ekleyin ve her müdahalenin kartında “✓ Alan tanımlı” yazdığından emin olun.</dd>
        <dt>İstediğim sayıda ağaç yerleşmedi.</dt><dd>Alan, taç çapı aralığıyla o kadar ağaca yetmiyor ya da bina/mevcut ağaçlarla çakışıyor. Sonuçta uyarı yazar; taç çapını küçültün veya alanı büyütün.</dd>
        <dt>Değişimler çok küçük görünüyor.</dt><dd>Karşılaştırma tüm çalışma alanı içindir. Müdahalenin yerel etkisini senaryonun kendi sonuç panelinde (müdahale çevresi analizinde) görün.</dd>
        <dt>Gölge hiç yok.</dt><dd>Seçilen saatte güneş ufkun altında olabilir; saati 07:00–19:00 arasına alın.</dd>
        <dt>Kaydettiğim senaryolar kayboldu.</dt><dd>Senaryolar tarayıcı deposunda tutulur; gizli pencere veya temizlenen site verisi bunları siler. Önemli senaryoları JSON olarak saklayın.</dd>
        <dt>Çizimi iptal etmek istiyorum.</dt><dd>Harita üstündeki <b>İptal</b> düğmesine basın.</dd>
      </dl>
    </div>
  </div>
}
