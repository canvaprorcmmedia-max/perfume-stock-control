const $ = s => document.querySelector(s), main = $('#main');
const IC = {
  home: '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>',
  box: '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="M3.3 7L12 12l8.7-5M12 22V12"/>',
  in: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  out: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>',
  bell: '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0"/>',
  menu: '<path d="M3 6h18M3 12h18M3 18h18"/>'
};
const ic = n => `<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${IC[n]}</svg>`;
const PAGES = [['dashboard', 'Dasbor', 'home'], ['produk', 'Data Produk', 'box'], ['masuk', 'Barang Masuk', 'in'], ['keluar', 'Barang Keluar', 'out']];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rp = n => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(n || 0);
const tgl = s => s ? new Date(s.replace(' ', 'T') + 'Z').toLocaleString('id-ID', { timeZone: 'UTC', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-';
let me = null, charts = [], reload = () => {}, authClient = null, accessToken = null;
const ps = { q: '', kategori: '', ukuran: '', status: '', sort: 'nama', dir: 'asc', page: 1 }, trxS = {};

function toast(m, err) { const t = document.createElement('div'); t.className = 'toast' + (err ? ' err' : ''); t.textContent = m; document.body.appendChild(t); setTimeout(() => t.remove(), 3500); }
async function api(u, m = 'GET', b) {
  const headers = { 'Content-Type': 'application/json' };
  if (accessToken) headers.Authorization = 'Bearer ' + accessToken;
  const r = await fetch('/api' + u, { method: m, headers, body: b ? JSON.stringify(b) : undefined });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { if (r.status === 401) showLogin(); throw new Error(d.error || 'Terjadi kesalahan'); }
  return d;
}
function modal(title, body, onOk, okText = 'Simpan') {
  const m = document.createElement('div'); m.className = 'modal';
  m.innerHTML = `<div class="box"><div class="mh"><b>${title}</b><button class="x" type="button">✕</button></div><form><div class="mb">${body}</div>${onOk ? `<div class="mf"><button type="button" class="btn ghost x">Batal</button><button class="btn">${okText}</button></div>` : ''}</form></div>`;
  document.body.appendChild(m);
  m.querySelectorAll('.x').forEach(b => b.onclick = () => m.remove());
  m.querySelector('form').onsubmit = async e => {
    e.preventDefault(); if (!onOk) return;
    try { if (await onOk(Object.fromEntries(new FormData(e.target)), e.target) !== false) m.remove(); } catch (x) { toast(x.message, 1); }
  };
  return m;
}
const pg = (el, d, st, fn) => {
  const n = Math.max(1, Math.ceil(d.total / d.per));
  el.insertAdjacentHTML('beforeend', `<div class="pg"><span>${d.total} data · Halaman ${st.page}/${n}</span><span><button class="btn ghost" ${st.page <= 1 ? 'disabled' : ''} data-p="-1">‹</button><button class="btn ghost" ${st.page >= n ? 'disabled' : ''} data-p="1">›</button></span></div>`);
  el.querySelectorAll('[data-p]').forEach(b => b.onclick = () => { st.page += +b.dataset.p; fn(); });
};
const badge = p => p.stok <= 0 ? '<span class="bd no">Habis</span>' : p.stok <= p.min_stok ? '<span class="bd lo">Menipis</span>' : '<span class="bd ok">Aman</span>';

// ---------- Supabase Auth & routing ----------
function showLogin() { $('#login').hidden = false; $('#app').hidden = true; }
async function initAuth() {
  try {
    const r = await fetch('/api/config', { cache: 'no-store' });
    const cfg = await r.json();
    if (!r.ok) throw new Error(cfg.error || 'Konfigurasi Supabase belum tersedia.');
    if (!window.supabase?.createClient) throw new Error('Library Supabase Auth gagal dimuat. Periksa koneksi internet/CDN.');
    authClient = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
    const { data: { session } } = await authClient.auth.getSession();
    accessToken = session?.access_token || null;
    authClient.auth.onAuthStateChange((_event, sessionNow) => {
      accessToken = sessionNow?.access_token || null;
      if (!accessToken) showLogin();
    });
    if (accessToken) await boot(); else showLogin();
  } catch (e) {
    showLogin(); toast(e.message || 'Gagal memulai autentikasi Supabase.', 1);
  }
}
$('#lf').onsubmit = async e => {
  e.preventDefault();
  if (!authClient) return toast('Autentikasi belum siap. Muat ulang halaman.', 1);
  const form = Object.fromEntries(new FormData(e.target));
  const submit = e.target.querySelector('button[type="submit"],button:not([type])');
  if (submit) submit.disabled = true;
  try {
    const { data, error } = await authClient.auth.signInWithPassword({ email: String(form.email || '').trim(), password: String(form.password || '') });
    if (error) throw error;
    accessToken = data.session?.access_token || null;
    e.target.password.value = '';
    await boot();
    // Jika autentikasi valid tetapi akun tidak ada dalam app_admins, API akan menolak akses.
  } catch (x) { toast(x.message || 'Login gagal.', 1); }
  finally { if (submit) submit.disabled = false; }
};
$('#nav').innerHTML = PAGES.map(([k, l, i]) => `<a href="#${k}" data-k="${k}">${ic(i)}${l}</a>`).join('');
$('#burger').innerHTML = ic('menu'); $('#bell').insertAdjacentHTML('afterbegin', ic('bell'));
$('#burger').onclick = () => $('#side').classList.toggle('open');
$('#prof').onclick = async () => { if (confirm('Keluar dari aplikasi?')) { try { if (authClient) await authClient.auth.signOut(); } finally { accessToken = null; me = null; showLogin(); } } };
$('#gs').onkeydown = e => { if (e.key === 'Enter') { ps.q = e.target.value; ps.page = 1; e.target.value = ''; location.hash === '#produk' ? route() : location.hash = '#produk'; } };
$('#bell').onclick = async () => {
  const l = await api('/lowstock');
  modal('Notifikasi Stok', l.length ? `<table>${l.map(p => `<tr><td><b>${esc(p.nama)}</b><br><small>${esc(p.brand)} ${esc(p.ukuran)}</small></td><td>${p.stok} ${esc(p.satuan)}</td><td>${p.stok <= 0 ? '<span class="bd no">Habis</span>' : '<span class="bd lo">Menipis</span>'}</td></tr>`).join('')}</table>` : '<p class="empty">Semua stok aman 🎉</p>');
};
async function notif() { try { const l = await api('/lowstock'); $('#bn').hidden = !l.length; $('#bn').textContent = l.length; } catch {} }
async function boot() {
  try { me = await api('/me'); } catch (e) { if (e.message) toast(e.message, 1); return showLogin(); }
  $('#login').hidden = true; $('#app').hidden = false; $('#uname').textContent = me.nama; $('.av').textContent = me.nama[0];
  route(); notif();
}
function route() {
  const k = (location.hash.slice(1) || 'dashboard'), pg_ = PAGES.find(p => p[0] === k) || PAGES[0];
  charts.forEach(c => c.destroy()); charts = []; $('#side').classList.remove('open');
  document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('on', a.dataset.k === pg_[0]));
  $('#title').textContent = pg_[1];
  main.innerHTML = '<p class="empty">Memuat...</p>';
  ({ dashboard: pageDash, produk: pageProduk, masuk: () => pageTrx('masuk'), keluar: () => pageTrx('keluar') })[pg_[0]]().catch(e => toast(e.message, 1));
}
window.onhashchange = route;
initAuth();

// ---------- Dasbor ----------
async function pageDash() {
  const d = await api('/dashboard'), k = d.k;
  const cards = [['Jenis Produk', k.jenis], ['Total Stok', k.stok], ['Nilai Modal Persediaan', rp(k.nilai)], ['Stok Menipis', k.menipis], ['Stok Habis', k.habis], ['Barang Masuk Hari Ini', d.masukHari], ['Barang Keluar Hari Ini', d.keluarHari]];
  main.innerHTML = `<div class="cards">${cards.map(([l, v]) => `<div class="card stat"><span>${l}</span><b>${v}</b></div>`).join('')}</div>
  <div class="grid3"><div class="card"><h4>Pergerakan Stok (7 hari)</h4><canvas id="c1"></canvas></div><div class="card"><h4>Produk Terlaris</h4><canvas id="c2"></canvas></div><div class="card"><h4>Komposisi Stok per Kategori</h4><canvas id="c3"></canvas></div></div>`;
  if (!window.Chart) return;
  const gold = '#b8975a', ch = '#2b2d33', pal = ['#b8975a', '#2b2d33', '#d8c7a0', '#7d7a72', '#8f6f3a', '#e9e0cc'];
  charts = [
    new Chart($('#c1'), { type: 'line', data: { labels: d.mv.map(x => x.d.slice(8) + '/' + x.d.slice(5, 7)), datasets: [{ label: 'Masuk', data: d.mv.map(x => x.masuk), borderColor: gold, backgroundColor: gold, tension: .3 }, { label: 'Keluar', data: d.mv.map(x => x.keluar), borderColor: ch, backgroundColor: ch, tension: .3 }] } }),
    new Chart($('#c2'), { type: 'bar', data: { labels: d.top.map(x => x.label), datasets: [{ label: 'Jumlah keluar', data: d.top.map(x => x.n), backgroundColor: gold }] }, options: { indexAxis: 'y', plugins: { legend: { display: false } } } }),
    new Chart($('#c3'), { type: 'doughnut', data: { labels: d.kat.map(x => x.label), datasets: [{ data: d.kat.map(x => x.n), backgroundColor: pal }] } })
  ];
}

// ---------- Produk ----------
const KAT = ['Eau de Parfum', 'Eau de Toilette', 'Eau de Cologne', 'Body Mist', 'Bibit Parfum', 'Parfum Refill'];
function pform(p = {}) {
  const f = (n, l, t = 'text', x = '') => `<label>${l}<input name="${n}" type="${t}" value="${esc(p[n] ?? '')}" ${x}></label>`;
  const s = (n, l, a) => `<label>${l}<select name="${n}">${a.map(o => `<option ${o == p[n] ? 'selected' : ''}>${o}</option>`).join('')}</select></label>`;
  return `<div class="g2">${f('nama', 'Nama parfum *', 'text', 'required')}${f('brand', 'Merek / brand *', 'text', 'required')}
  <label>Kategori *<input name="kategori" list="kl" value="${esc(p.kategori || '')}" required><datalist id="kl">${KAT.map(k => `<option>${k}`).join('')}</datalist></label>
  ${f('varian', 'Varian aroma')}${f('ukuran', 'Ukuran (mis. 30 ml)')}${s('jenis', 'Jenis produk', ['Parfum Original', 'Parfum Botolan', 'Parfum Refill', 'Bibit Parfum'])}
  ${s('satuan', 'Satuan stok', ['botol', 'pcs', 'ml'])}${f('modal', 'Harga modal / satuan', 'number', 'min=0 step=any')}${f('jual', 'Harga jual / satuan', 'number', 'min=0 step=any')}
  ${p.id ? '' : f('stok', 'Stok awal', 'number', 'min=0 step=any')}${f('min_stok', 'Batas minimum stok', 'number', 'min=0 step=any placeholder=5')}${f('lokasi', 'Lokasi / rak')}
  <label>Foto (opsional)<input type="file" name="fotoFile" accept="image/*"></label></div>
  <p class="hint">${p.id ? `Kode: ${esc(p.sku)} · stok diubah lewat transaksi barang masuk/keluar.` : 'Kode produk (SKU) dibuat otomatis.'}</p>`;
}
async function pSubmit(fd, id) {
  const file = fd.fotoFile; delete fd.fotoFile;
  if (file && file.size) {
    if (file.size > 1.5e6) throw new Error('Ukuran foto maksimal 1,5 MB');
    fd.foto = await new Promise(r => { const x = new FileReader(); x.onload = () => r(x.result); x.readAsDataURL(file); });
  }
  await api(id ? '/products/' + id : '/products', id ? 'PUT' : 'POST', fd);
  toast('Produk tersimpan'); reload(); notif();
}
function parseCSV(t) {
  t = t.replace(/^\uFEFF/, ''); const l1 = t.split('\n')[0];
  const dl = (l1.match(/;/g) || []).length > (l1.match(/,/g) || []).length ? ';' : ',';
  const R = []; let r = [], c = '', q = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (q) { if (ch == '"' && t[i + 1] == '"') { c += '"'; i++; } else if (ch == '"') q = false; else c += ch; }
    else if (ch == '"') q = true;
    else if (ch == dl) { r.push(c); c = ''; }
    else if (ch == '\n' || ch == '\r') { if (ch == '\r' && t[i + 1] == '\n') i++; r.push(c); c = ''; R.push(r); r = []; }
    else c += ch;
  }
  if (c || r.length) { r.push(c); R.push(r); }
  const H = R.shift().map(x => x.trim().toLowerCase());
  return R.filter(x => x.some(v => v.trim())).map(x => Object.fromEntries(H.map((k, i) => [k, (x[i] || '').trim()])));
}
const CSVH = ['sku', 'nama', 'brand', 'kategori', 'varian', 'ukuran', 'jenis', 'satuan', 'modal', 'jual', 'stok', 'min_stok', 'lokasi'];
async function pageProduk() {
  const meta = await api('/meta');
  const opt = (a, v) => a.map(x => `<option ${x == v ? 'selected' : ''}>${esc(x)}</option>`).join('');
  main.innerHTML = `<div class="bar"><input id="fq" placeholder="Cari nama, kode, atau merek..." value="${esc(ps.q)}">
  <select id="fk"><option value="">Semua kategori</option>${opt(meta.kategori, ps.kategori)}</select><select id="fu"><option value="">Semua ukuran</option>${opt(meta.ukuran, ps.ukuran)}</select>
  <select id="fs"><option value="">Semua status</option><option value="aman">Aman</option><option value="menipis">Menipis</option><option value="habis">Habis</option></select>
  <select id="fo"><option value="nama">Urut: Nama</option><option value="stok">Urut: Stok</option><option value="jual">Urut: Harga</option><option value="dibuat">Urut: Tanggal</option></select><button class="btn ghost" id="fd" title="Arah urutan">↑↓</button></div>
  <div class="bar"><button class="btn" id="add">+ Tambah Produk</button><button class="btn ghost" id="imp">Impor CSV</button><button class="btn ghost" id="exp">Ekspor CSV</button></div><div class="card" id="tbl"></div>`;
  $('#fs').value = ps.status; $('#fo').value = ps.sort;
  async function load() {
    const d = await api('/products?' + new URLSearchParams(ps)), t = $('#tbl');
    t.innerHTML = `<div class="tw"><table><thead><tr><th>Kode</th><th>Produk</th><th>Kategori</th><th>Ukuran</th><th>Stok</th><th>Modal</th><th>Jual</th><th>Status</th><th></th></tr></thead><tbody>${d.rows.map(p => `<tr><td>${esc(p.sku)}</td><td><b>${esc(p.nama)}</b><br><small>${esc(p.brand)}</small></td><td>${esc(p.kategori)}</td><td>${esc(p.ukuran)}</td><td>${p.stok} ${esc(p.satuan)}</td><td>${rp(p.modal)}</td><td>${rp(p.jual)}</td><td>${badge(p)}</td><td class="act"><button data-a="v" data-id="${p.id}">Detail</button><button data-a="e" data-id="${p.id}">Edit</button><button data-a="d" data-id="${p.id}">Arsip</button></td></tr>`).join('') || '<tr><td colspan="9" class="empty">Belum ada produk</td></tr>'}</tbody></table></div>`;
    pg(t, d, ps, load);
    t.querySelectorAll('[data-a]').forEach(b => b.onclick = async () => {
      const id = b.dataset.id, a = b.dataset.a;
      if (a == 'd') { if (confirm('Arsipkan produk ini? Riwayat transaksi tetap tersimpan.')) { await api('/products/' + id, 'DELETE'); toast('Produk diarsipkan'); load(); notif(); } return; }
      const p = await api('/products/' + id);
      if (a == 'e') modal('Edit Produk', pform(p), fd => pSubmit(fd, id));
      else modal('Detail Produk', `${p.foto ? `<img src="${p.foto}" style="max-width:100%;max-height:200px;border-radius:10px;margin-bottom:12px">` : ''}<dl class="det">${[['Kode', p.sku], ['Nama', p.nama], ['Merek', p.brand], ['Kategori', p.kategori], ['Varian aroma', p.varian], ['Ukuran', p.ukuran], ['Jenis', p.jenis], ['Stok', p.stok + ' ' + p.satuan], ['Batas minimum', p.min_stok], ['Harga modal', rp(p.modal)], ['Harga jual', rp(p.jual)], ['Lokasi', p.lokasi], ['Dibuat', tgl(p.dibuat)], ['Diperbarui', tgl(p.diperbarui)]].map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v) || '-'}</dd></div>`).join('')}</dl>`);
    });
  }
  reload = load; load();
  let tm; $('#fq').oninput = e => { clearTimeout(tm); tm = setTimeout(() => { ps.q = e.target.value; ps.page = 1; load(); }, 300); };
  [['fk', 'kategori'], ['fu', 'ukuran'], ['fs', 'status'], ['fo', 'sort']].forEach(([i, k]) => $('#' + i).onchange = e => { ps[k] = e.target.value; ps.page = 1; load(); });
  $('#fd').onclick = () => { ps.dir = ps.dir == 'asc' ? 'desc' : 'asc'; load(); toast('Urutan: ' + (ps.dir == 'asc' ? 'naik' : 'turun')); };
  $('#add').onclick = () => modal('Tambah Produk', pform(), fd => pSubmit(fd));
  $('#imp').onclick = () => {
    const i = document.createElement('input'); i.type = 'file'; i.accept = '.csv,.txt';
    i.onchange = async () => {
      try {
        const r = await api('/products/import', 'POST', { rows: parseCSV(await i.files[0].text()) });
        toast(`${r.ok} produk diimpor` + (r.err.length ? `, ${r.err.length} gagal` : ''), !r.ok);
        if (r.err.length) modal('Hasil Impor', `<p>${r.ok} berhasil.</p><ul>${r.err.map(e => `<li>${esc(e)}</li>`).join('')}</ul>`);
        load(); notif();
      } catch (e) { toast(e.message, 1); }
    };
    i.click();
  };
  $('#exp').onclick = async () => {
    const d = await api('/products?' + new URLSearchParams({ ...ps, all: 1 }));
    const csv = '\uFEFF' + [CSVH, ...d.rows.map(r => CSVH.map(k => r[k]))].map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(';')).join('\r\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = 'produk-parfum.csv'; a.click();
  };
}

// ---------- Transaksi ----------
function cetak(t) {
  const m = t.tipe == 'masuk', w = open('', '_blank');
  w.document.write(`<html><head><title>${esc(t.no)}</title></head><body style="font-family:sans-serif;max-width:420px;margin:30px auto"><h3>Perfume Stock Manager</h3><p><b>Bukti Barang ${m ? 'Masuk' : 'Keluar'}</b><br>No: ${esc(t.no)}<br>${tgl(t.waktu)}</p><hr><p>${esc(t.nama)} (${esc(t.sku)})<br>${t.qty} ${esc(t.satuan)} × ${rp(t.harga)} = <b>${rp(t.total)}</b></p><p>${m ? 'Supplier' : 'Tujuan'}: ${esc(t.pihak) || '-'}<br>${m ? 'Nota' : 'Alasan'}: ${esc(m ? t.ref : t.alasan) || '-'}<br>Catatan: ${esc(t.catatan) || '-'}<br>Petugas: ${esc(t.user)}</p><script>print()<\/script></body></html>`);
  w.document.close();
}
async function trxForm(tipe) {
  const { rows: P } = await api('/products?all=1'), masuk = tipe == 'masuk';
  const m = modal(`Catat Barang ${masuk ? 'Masuk' : 'Keluar'}`, `<div class="g2"><label class="w2">Produk *<select name="product_id" required><option value="">— Pilih produk —</option>${P.map(p => `<option value="${p.id}">${esc(p.nama)} · ${esc(p.brand)} ${esc(p.ukuran)} (stok ${p.stok})</option>`).join('')}</select></label>
  <label>Jumlah *<input name="qty" type="number" min="0.01" step="any" required></label>
  ${masuk ? '' : `<label>Alasan pengeluaran<select name="alasan">${['Penjualan', 'Pemakaian Internal', 'Barang Rusak', 'Tester', 'Lainnya'].map(x => `<option>${x}</option>`).join('')}</select></label>`}
  <label class="hg">${masuk ? 'Harga modal / satuan' : 'Harga jual / satuan'}<input name="harga" type="number" min="0" step="any"></label>
  <label>${masuk ? 'Supplier / sumber barang' : 'Pelanggan / tujuan (opsional)'}<input name="pihak"></label>
  ${masuk ? '<label>Nomor nota / referensi<input name="ref"></label>' : ''}<label class="w2">Catatan<input name="catatan"></label></div><p class="tot">Total: <b id="tt">Rp0</b></p>`,
    async fd => { const r = await api('/trx', 'POST', { ...fd, tipe }); toast(`Transaksi ${r.no} tersimpan`); reload(); notif(); });
  const $$ = n => m.querySelector(`[name=${n}]`), hg = m.querySelector('.hg');
  const upd = () => { const sale = masuk || $$('alasan').value == 'Penjualan'; hg.hidden = !sale; $('#tt').textContent = rp(sale ? $$('qty').value * $$('harga').value : 0); };
  $$('product_id').onchange = () => { const p = P.find(x => x.id == $$('product_id').value); if (p) $$('harga').value = masuk ? p.modal : p.jual; upd(); };
  ['qty', 'harga'].forEach(n => $$(n).oninput = upd); if (!masuk) $$('alasan').onchange = upd;
}
async function pageTrx(tipe) {
  const st = trxS[tipe] || (trxS[tipe] = { q: '', page: 1 }), masuk = tipe == 'masuk';
  main.innerHTML = `<div class="bar"><input id="tq" placeholder="Cari no. transaksi, produk, ${masuk ? 'supplier' : 'tujuan'}, atau nota..." value="${esc(st.q)}"><button class="btn" id="add">+ Catat Barang ${masuk ? 'Masuk' : 'Keluar'}</button></div><div class="card" id="tbl"></div>`;
  async function load() {
    const d = await api(`/trx?tipe=${tipe}&q=${encodeURIComponent(st.q)}&page=${st.page}`), t = $('#tbl');
    t.innerHTML = `<div class="tw"><table><thead><tr><th>No. Transaksi</th><th>Waktu</th><th>Produk</th><th>Jumlah</th><th>${masuk ? 'Harga modal' : 'Harga jual'}</th><th>Total</th><th>${masuk ? 'Supplier / Nota' : 'Tujuan / Alasan'}</th><th>Petugas</th><th></th></tr></thead><tbody>${d.rows.map((r, i) => `<tr><td>${esc(r.no)}</td><td>${tgl(r.waktu)}</td><td><b>${esc(r.nama)}</b><br><small>${esc(r.sku)}</small></td><td>${r.qty} ${esc(r.satuan)}</td><td>${r.harga ? rp(r.harga) : '-'}</td><td>${r.total ? rp(r.total) : '-'}</td><td>${masuk ? `${esc(r.pihak) || '-'}<br><small>${esc(r.ref)}</small>` : `${esc(r.pihak) || '-'}<br><small>${esc(r.alasan)}</small>`}</td><td>${esc(r.user)}</td><td class="act"><button data-i="${i}">Cetak</button></td></tr>`).join('') || '<tr><td colspan="9" class="empty">Belum ada transaksi</td></tr>'}</tbody></table></div>`;
    pg(t, d, st, load);
    t.querySelectorAll('[data-i]').forEach(b => b.onclick = () => cetak({ ...d.rows[b.dataset.i], tipe }));
  }
  reload = load; load();
  let tm; $('#tq').oninput = e => { clearTimeout(tm); tm = setTimeout(() => { st.q = e.target.value; st.page = 1; load(); }, 300); };
  $('#add').onclick = () => trxForm(tipe);
}
boot();
