/* =====================================================================
   GK · Görev Kahramanı — ortak kod (gk-app.js)
   Hem çocuk ekranı (gk-index.html) hem ebeveyn paneli (gk-ebeveyn.html)
   bu dosyayı kullanır.
   ===================================================================== */

// ===== 1) SUPABASE BAĞLANTISI =====
// URL ve anahtar gk-ayar.js dosyasındadır. Güncellemelerde o dosyaya dokunulmaz.
const gkDb = window.supabase.createClient(GK_SUPABASE_URL, GK_SUPABASE_ANON_KEY, {
  db: { schema: 'gk' },
  auth: { persistSession: false, autoRefreshToken: false }
});

// ===== 2) SABİTLER =====
const GK_GUNLER = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
const GK_GUN_KISA = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];
const GK_AYLAR = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
const GK_DONEM_ETIKET = { hafta: 'Haftalık', ay: 'Aylık', ceyrek: '3 aylık', yariyil: '6 aylık' };
const GK_DONEM_SIRA = { hafta: 1, ay: 2, ceyrek: 3, yariyil: 4 };

// ===== 3) TARİH YARDIMCILARI (yerel saatle çalışır) =====
function gkTarihStr(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function gkTarih(s) {
  const [y, m, g] = s.split('-').map(Number);
  return new Date(y, m - 1, g);
}
function gkBugun() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function gkGunEkle(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function gkUzunTarih(d) {
  return d.getDate() + ' ' + GK_AYLAR[d.getMonth()] + ' ' + GK_GUNLER[d.getDay()];
}

// Bir tarihin içinde bulunduğu dönemin başı ve sonu
function gkDonem(tur, d, haftaBas) {
  if (tur === 'hafta') {
    const fark = (d.getDay() - haftaBas + 7) % 7;
    const bas = gkGunEkle(d, -fark);
    return { bas, bit: gkGunEkle(bas, 6) };
  }
  const adim = { ay: 1, ceyrek: 3, yariyil: 6 }[tur];
  const basAy = Math.floor(d.getMonth() / adim) * adim;
  return {
    bas: new Date(d.getFullYear(), basAy, 1),
    bit: new Date(d.getFullYear(), basAy + adim, 0)
  };
}
function gkOncekiDonem(tur, donem, haftaBas) {
  return gkDonem(tur, gkGunEkle(donem.bas, -1), haftaBas);
}
function gkDonemAdi(tur, d) {
  const { bas, bit } = d;
  if (tur === 'hafta') {
    return bas.getMonth() === bit.getMonth()
      ? `${bas.getDate()}–${bit.getDate()} ${GK_AYLAR[bit.getMonth()]}`
      : `${bas.getDate()} ${GK_AYLAR[bas.getMonth()]} – ${bit.getDate()} ${GK_AYLAR[bit.getMonth()]}`;
  }
  if (tur === 'ay') return `${GK_AYLAR[bas.getMonth()]} ${bas.getFullYear()}`;
  return `${GK_AYLAR[bas.getMonth()]}–${GK_AYLAR[bit.getMonth()]} ${bas.getFullYear()}`;
}

// ===== 4) VERİ =====
const gk = { ayarlar: null, gorevler: [], oduller: [], teslimler: [], kayitlar: new Map() };

function gkKontrol(sonuc) {
  if (sonuc.error) throw sonuc.error;
  return sonuc.data;
}

async function gkTumunuYukle() {
  const [a, g, o, t] = await Promise.all([
    gkDb.from('gk_ayarlar').select('id,cocuk_adi,baslangic_tarihi,hafta_baslangic_gunu').eq('id', 1).single(),
    gkDb.from('gk_gorevler').select('*').order('sira').order('id'),
    gkDb.from('gk_oduller').select('*').order('id'),
    gkDb.from('gk_odul_teslimleri').select('*')
  ]);
  gk.ayarlar = gkKontrol(a);
  gk.gorevler = gkKontrol(g);
  gk.oduller = gkKontrol(o);
  gk.teslimler = gkKontrol(t);

  // Kayıtlar başlangıç tarihinden itibaren, 1000'erli sayfalarla
  const satirlar = [];
  const boyut = 1000;
  for (let i = 0; ; i += boyut) {
    const sayfa = gkKontrol(await gkDb.from('gk_kayitlar').select('*')
      .gte('tarih', gk.ayarlar.baslangic_tarihi).order('id').range(i, i + boyut - 1));
    satirlar.push(...sayfa);
    if (sayfa.length < boyut) break;
  }
  gk.kayitlar = new Map(satirlar.map(k => [k.gorev_id + '|' + k.tarih, k]));
}

function gkKayit(gorevId, tarihStr) {
  return gk.kayitlar.get(gorevId + '|' + tarihStr);
}
function gkGorevBul(id) {
  return gk.gorevler.find(g => g.id === id);
}
function gkOdullerSirali(liste) {
  return [...liste].sort((a, b) => GK_DONEM_SIRA[a.donem] - GK_DONEM_SIRA[b.donem] || a.id - b.id);
}

// ===== 5) PUAN HESAPLARI =====
// O gün yapılması gereken GÜNLÜK görevler
function gkGunGorevleri(d) {
  const s = gkTarihStr(d);
  if (s < gk.ayarlar.baslangic_tarihi) return [];
  return gk.gorevler.filter(g =>
    (g.tip || 'gunluk') === 'gunluk' &&
    g.baslangic <= s && (!g.bitis || s <= g.bitis) && g.gunler.includes(d.getDay()));
}

// Bir tarihin içinde bulunduğu haftanın ilk günü
function gkHaftaBasi(d) {
  return gkDonem('hafta', d, gk.ayarlar.hafta_baslangic_gunu).bas;
}

// O haftanın HAFTALIK görevleri (her hafta tekrarlayanlar + sadece o haftaya ait olanlar)
// Her hafta tekrarlayan görev, eklendiği günden sonraki ilk hafta başından itibaren geçerlidir.
// Haftalık görevin kaydı, haftanın ilk gününün tarihiyle tutulur.
function gkHaftaGorevleri(haftaBas) {
  const basS = gkTarihStr(haftaBas);
  const bitS = gkTarihStr(gkGunEkle(haftaBas, 6));
  if (bitS < gk.ayarlar.baslangic_tarihi) return [];
  return gk.gorevler.filter(g => {
    if (g.tip !== 'haftalik') return false;
    if (g.hafta) return g.hafta === basS;
    return g.baslangic <= basS && (!g.bitis || g.bitis >= basS);
  });
}

// Bir tarih aralığının puan özeti
// maks: o aralıkta alınabilecek en yüksek puan
// net: onaylanan puanlar − cezalar (yapılmayan / reddedilen görevler)
// Haftalık görevler, haftanın son gününe yazılır.
function gkDonemHesapla(bas, bit) {
  const bugunStr = gkTarihStr(gkBugun());
  const sonGun = (gk.ayarlar.hafta_baslangic_gunu + 6) % 7;
  const o = { maks: 0, net: 0, kazanilan: 0, ceza: 0, yapilan: 0, kacirilan: 0, bekleyen: 0, muaf: 0 };

  const isle = (g, kayitTarihi, sonTarih) => {
    const k = gkKayit(g.id, kayitTarihi);
    // "Bugün yok" işaretli görev: ne puan ne ceza, hedef hesabına da girmez
    if (k && k.durum === 'muaf') { o.muaf++; return; }
    o.maks += g.puan;
    if (kayitTarihi > bugunStr) return;
    if (k && k.durum === 'onaylandi') { o.kazanilan += (k.puan ?? g.puan); o.yapilan++; }
    else if (k && k.durum === 'reddedildi') { o.ceza += g.ceza; o.kacirilan++; }
    else if (k && k.durum === 'bekliyor') { o.bekleyen++; }
    else if (sonTarih < bugunStr) { o.ceza += g.ceza; o.kacirilan++; }
  };

  for (let d = new Date(bas); d <= bit; d = gkGunEkle(d, 1)) {
    const s = gkTarihStr(d);
    for (const g of gkGunGorevleri(d)) isle(g, s, s);
    if (d.getDay() === sonGun) {
      const haftaBas = gkGunEkle(d, -6);
      for (const g of gkHaftaGorevleri(haftaBas)) isle(g, gkTarihStr(haftaBas), s);
    }
  }
  o.net = o.kazanilan - o.ceza;
  return o;
}

// Puan hareketleri: gkDonemHesapla ile aynı kurallarla, satır satır
// Her satır: { tarih, gorev, puan (+/-), aciklama }
// Onaylanan/reddedilen haftalık görev onay gününe, yapılmayan haftalık görev haftanın son gününe yazılır.
function gkPuanHareketleri(bas, bit) {
  const bugunStr = gkTarihStr(gkBugun());
  const sonGun = (gk.ayarlar.hafta_baslangic_gunu + 6) % 7;
  const satirlar = [];
  let bekleyen = 0;
  const onayGunu = (k, yedek) => k.onay_zamani ? gkTarihStr(new Date(k.onay_zamani)) : yedek;

  for (let d = new Date(bas); d <= bit; d = gkGunEkle(d, 1)) {
    const s = gkTarihStr(d);
    for (const g of gkGunGorevleri(d)) {
      if (s > bugunStr) continue;
      const k = gkKayit(g.id, s);
      if (k && k.durum === 'muaf') continue;
      if (k && k.durum === 'onaylandi') satirlar.push({ tarih: s, gorev: g, puan: k.puan ?? g.puan, aciklama: 'Yaptı' });
      else if (k && k.durum === 'reddedildi') satirlar.push({ tarih: s, gorev: g, puan: -g.ceza, aciklama: 'Yapmadı' });
      else if (k && k.durum === 'bekliyor') bekleyen++;
      else if (s < bugunStr) satirlar.push({ tarih: s, gorev: g, puan: -g.ceza, aciklama: 'İşaretlenmedi' });
    }
    if (d.getDay() === sonGun) {
      const haftaBas = gkGunEkle(d, -6);
      const hs = gkTarihStr(haftaBas);
      if (hs > bugunStr) continue;
      for (const g of gkHaftaGorevleri(haftaBas)) {
        const k = gkKayit(g.id, hs);
        if (k && k.durum === 'muaf') continue;
        if (k && k.durum === 'onaylandi') satirlar.push({ tarih: onayGunu(k, hs), gorev: g, puan: k.puan ?? g.puan, aciklama: 'Haftalık görev, yaptı' });
        else if (k && k.durum === 'reddedildi') satirlar.push({ tarih: onayGunu(k, hs), gorev: g, puan: -g.ceza, aciklama: 'Haftalık görev, yapmadı' });
        else if (k && k.durum === 'bekliyor') bekleyen++;
        else if (s < bugunStr) satirlar.push({ tarih: s, gorev: g, puan: -g.ceza, aciklama: 'Haftalık görev, yapılmadı' });
      }
    }
  }
  return { satirlar, bekleyen };
}

// Ödül ya da ceza için bir dönemin sonucu
// Ödül: net >= hedef ise kazanılır. Ceza: dönem sonunda net < hedef ise uygulanır
// (onay bekleyen görev varken ceza kesinleşmez).
// teslim: ödülde "teslim edildi", cezada "uygulandı" kaydı
function gkOdulDurumu(odul, donem) {
  const h = gkDonemHesapla(donem.bas, donem.bit);
  const hedef = Math.ceil(h.maks * odul.esik_yuzde / 100);
  const basStr = gkTarihStr(donem.bas);
  const teslim = gk.teslimler.find(t => t.odul_id === odul.id && t.donem_baslangic === basStr);
  return {
    ...h, hedef, teslim,
    kazandi: h.maks > 0 && h.net >= hedef,
    dustu: h.maks > 0 && h.net < hedef && h.bekleyen === 0
  };
}

// Dönemin dünkü güne kadar olan gidişatı (yüzde). Henüz geçmiş gün yoksa null.
function gkGidisat(donem) {
  const dun = gkGunEkle(gkBugun(), -1);
  if (dun < donem.bas) return null;
  const bit = dun < donem.bit ? dun : donem.bit;
  const h = gkDonemHesapla(donem.bas, bit);
  if (h.maks === 0) return null;
  return Math.round(h.net / h.maks * 100);
}

function gkOduller() { return gk.oduller.filter(o => (o.tur || 'odul') === 'odul'); }
function gkCezalar() { return gk.oduller.filter(o => o.tur === 'ceza'); }

// Telafi görevi hangi haftaya eklenir: bu haftanın 3 veya daha fazla günü kaldıysa bu hafta,
// yoksa gelecek hafta
function gkTelafiHaftasi() {
  const bugun = gkBugun();
  const bas = gkHaftaBasi(bugun);
  const kalanGun = 6 - Math.round((bugun - bas) / 86400000) + 1;
  return gkTarihStr(kalanGun >= 3 ? bas : gkGunEkle(bas, 7));
}

// ===== 6) YAZMA İŞLEMLERİ =====
async function gkIsaretle(gorevId, tarihStr) {
  gkKontrol(await gkDb.from('gk_kayitlar').insert({ gorev_id: gorevId, tarih: tarihStr, durum: 'bekliyor' }));
}
async function gkIsaretKaldir(gorevId, tarihStr) {
  gkKontrol(await gkDb.from('gk_kayitlar').delete()
    .eq('gorev_id', gorevId).eq('tarih', tarihStr).eq('durum', 'bekliyor'));
}
async function gkDurumYaz(gorev, tarihStr, durum, onaylayan) {
  gkKontrol(await gkDb.from('gk_kayitlar').upsert({
    gorev_id: gorev.id,
    tarih: tarihStr,
    durum,
    puan: durum === 'onaylandi' ? gorev.puan : null,
    onay_zamani: new Date().toISOString(),
    onaylayan: onaylayan || null
  }, { onConflict: 'gorev_id,tarih' }));
}
async function gkKayitSil(gorevId, tarihStr) {
  gkKontrol(await gkDb.from('gk_kayitlar').delete().eq('gorev_id', gorevId).eq('tarih', tarihStr));
}

// ===== 7) ARAYÜZ YARDIMCILARI =====
function gkEsc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function gkMesaj(metin, tur) {
  let el = document.getElementById('gkMesaj');
  if (!el) {
    el = document.createElement('div');
    el.id = 'gkMesaj';
    el.className = 'gk-mesaj';
    el.setAttribute('role', 'status');
    document.body.appendChild(el);
  }
  el.textContent = metin;
  el.dataset.tur = tur || 'bilgi';
  el.classList.add('gorunur');
  clearTimeout(el._zaman);
  el._zaman = setTimeout(() => el.classList.remove('gorunur'), 2800);
}
function gkHata(e) {
  console.error(e);
  gkMesaj('Bağlantı sorunu: ' + (e && e.message ? e.message : 'bilinmeyen hata'), 'hata');
}
function gkCubuk(net, hedef) {
  const yuzde = hedef > 0 ? Math.max(0, Math.min(100, net / hedef * 100)) : 0;
  const tamam = hedef > 0 && net >= hedef;
  return `<div class="gk-cubuk${tamam ? ' tamam' : ''}" role="progressbar" aria-valuemin="0" aria-valuemax="${hedef}" aria-valuenow="${Math.max(0, Math.min(net, hedef))}"><span style="width:${yuzde.toFixed(1)}%"></span></div>`;
}
function gkSekmeKur(onDegis) {
  document.querySelectorAll('[data-sekme]').forEach(b => b.addEventListener('click', () => {
    const ad = b.dataset.sekme;
    document.querySelectorAll('[data-sekme]').forEach(x => x.setAttribute('aria-selected', x === b ? 'true' : 'false'));
    document.querySelectorAll('[data-panel]').forEach(p => { p.hidden = p.dataset.panel !== ad; });
    if (onDegis) onDegis(ad);
  }));
}
