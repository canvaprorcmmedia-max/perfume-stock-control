const express = require('express');
const crypto = require('crypto');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '3mb' }));

const wib = () => new Date(Date.now() + 7 * 36e5).toISOString().slice(0, 19).replace('T', ' ');
const errText = e => e?.message || 'Terjadi kesalahan pada server';

function route(fn) {
  return async (q, s) => {
    try { const result = await fn(q, s); if (!s.headersSent) s.json(result === undefined ? { ok: 1 } : result); }
    catch (e) {
      console.error('API error:', e);
      const status = Number(e.status || e.code);
      s.status(status >= 400 && status < 600 ? status : 400).json({ error: errText(e) });
    }
  };
}
function must(ok, message, status = 400) { if (!ok) { const e = new Error(message); e.status = status; throw e; } }

// Kunci service-role hanya digunakan di server. Jangan pernah kirim ke browser.
const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.SUPABASE_ANON_KEY;
if (!supabaseUrl || !serviceRoleKey || !anonKey) {
  console.warn('Environment Variables yang diperlukan: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.');
}
const db = createClient(supabaseUrl || 'https://example.supabase.co', serviceRoleKey || 'missing-service-role-key', {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
});

// Konfigurasi publik hanya mengirim URL dan anon/publishable key, bukan service-role key.
app.get('/api/config', (q, s) => {
  if (!supabaseUrl || !anonKey) return s.status(503).json({ error: 'Konfigurasi Supabase belum lengkap di Vercel.' });
  s.setHeader('Cache-Control', 'no-store');
  s.json({ supabaseUrl, supabaseAnonKey: anonKey });
});

// Semua endpoint API (selain config) memerlukan token Supabase Auth dan izin admin.
app.use('/api', async (q, s, next) => {
  if (q.path === '/config') return next();
  try {
    const auth = String(q.headers.authorization || '');
    const match = auth.match(/^Bearer\s+(.+)$/i);
    if (!match) return s.status(401).json({ error: 'Silakan masuk menggunakan akun yang diizinkan.' });
    const { data: authData, error: authError } =
  await db.auth.getUser(match[1]);

if (authError || !authData?.user) {
  console.error('Supabase Auth validation failed:', {
    message: authError?.message,
    status: authError?.status,
    code: authError?.code
  });

  return s.status(401).json({
    error: 'Sesi login tidak valid atau telah berakhir. Silakan masuk kembali.'
  });
}
    const user = authData.user;
    const { data: admin, error: adminError } = await db.from('app_admins').select('user_id').eq('user_id', user.id).maybeSingle();
    if (adminError) {
      console.error('Pemeriksaan app_admins gagal:', adminError.message);
      return s.status(503).json({ error: 'Daftar admin belum siap. Jalankan migration_stage3_auth.sql dan daftarkan UUID akun Anda.' });
    }
    if (!admin) return s.status(403).json({ error: 'Akun ini belum diizinkan mengakses aplikasi. Tambahkan UUID akun ke tabel app_admins di Supabase.' });
    q.user = { id: user.id, email: user.email, nama: user.user_metadata?.full_name || user.email || 'Admin' };
    next();
  } catch (e) {
    console.error('Auth middleware error:', e);
    s.status(500).json({ error: 'Gagal memverifikasi sesi login. Periksa Runtime Logs Vercel.' });
  }
});
app.get('/api/me', route(q => ({ id: q.user.id, email: q.user.email, nama: q.user.nama })));
app.post('/api/logout', route(async () => ({ ok: 1 })));

// ---------- Produk ----------
const SORT = ['nama', 'stok', 'jual', 'modal', 'dibuat', 'sku'];
const num = (v, n) => { const x = Number(v || 0); must(Number.isFinite(x) && x >= 0, n + ' tidak valid'); return x; };
function pData(b) {
  const t = k => String(b[k] ?? '').trim();
  for (const [k, l] of [['nama', 'Nama parfum'], ['brand', 'Merek'], ['kategori', 'Kategori']]) must(t(k), l + ' wajib diisi');
  return { sku: t('sku'), nama: t('nama'), brand: t('brand'), kategori: t('kategori'), varian: t('varian'), ukuran: t('ukuran'), jenis: t('jenis'), satuan: t('satuan') || 'botol', modal: num(b.modal, 'Harga modal'), jual: num(b.jual, 'Harga jual'), stok: num(b.stok, 'Stok'), min_stok: num(b.min_stok === undefined || b.min_stok === '' ? 5 : b.min_stok, 'Batas minimum stok'), lokasi: t('lokasi'), foto: b.foto || null };
}
async function addProduct(b) {
  const d = pData(b);
  if (!d.sku) d.sku = 'PRF-' + crypto.randomBytes(4).toString('hex').toUpperCase();
  const now = wib(); d.dibuat = now; d.diperbarui = now;
  const { data, error } = await db.from('products').insert(d).select('id').single();
  if (error?.code === '23505') throw new Error(`Kode produk ${d.sku} sudah digunakan`);
  if (error) throw error;
  return data.id;
}
app.get('/api/products', route(async q => {
  const { q: search, kategori, ukuran, status, sort, dir, page, all } = q.query;
  const per = 10, p = Math.max(1, Number(page) || 1);
  let query = db.from('products').select('*').eq('arsip', 0);
  if (search) { const safe = String(search).replace(/[,%()]/g, ' '); query = query.or(`nama.ilike.%${safe}%,sku.ilike.%${safe}%,brand.ilike.%${safe}%`); }
  if (kategori) query = query.eq('kategori', kategori);
  if (ukuran) query = query.eq('ukuran', ukuran);
  query = query.order(SORT.includes(sort) ? sort : 'nama', { ascending: dir !== 'desc' }).limit(1000);
  const { data, error } = await query;
  if (error) throw error;
  let rows = data || [];
  if (status === 'habis') rows = rows.filter(x => Number(x.stok) <= 0);
  else if (status === 'menipis') rows = rows.filter(x => Number(x.stok) > 0 && Number(x.stok) <= Number(x.min_stok));
  else if (status === 'aman') rows = rows.filter(x => Number(x.stok) > Number(x.min_stok));
  const total = rows.length;
  if (all === '1' || all === 'true') return { rows, total, per: total || 1 };
  return { rows: rows.slice((p - 1) * per, p * per), total, per };
}));
app.get('/api/meta', route(async () => {
  const { data, error } = await db.from('products').select('kategori,ukuran').eq('arsip', 0).limit(1000);
  if (error) throw error;
  return { kategori: [...new Set((data || []).map(x => x.kategori).filter(Boolean))].sort(), ukuran: [...new Set((data || []).map(x => x.ukuran).filter(Boolean))].sort() };
}));
app.get('/api/products/:id', route(async q => {
  const { data, error } = await db.from('products').select('*').eq('id', q.params.id).maybeSingle();
  if (error) throw error; must(data, 'Produk tidak ditemukan', 404); return data;
}));
app.post('/api/products', route(async q => ({ id: await addProduct(q.body || {}) })));
app.post('/api/products/import', route(async q => {
  let ok = 0; const err = [];
  for (const [i, row] of (q.body?.rows || []).entries()) {
    try { await addProduct(row); ok++; } catch (e) { err.push(`Baris ${i + 2}: ${errText(e)}`); }
  }
  return { ok, err };
}));
app.put('/api/products/:id', route(async q => {
  const id = q.params.id;
  const { data: old, error: oldErr } = await db.from('products').select('*').eq('id', id).maybeSingle();
  if (oldErr) throw oldErr; must(old, 'Produk tidak ditemukan', 404);
  const d = pData(q.body || {}); d.sku = d.sku || old.sku; d.foto = q.body?.foto === undefined ? old.foto : q.body.foto; d.diperbarui = wib();
  const { error } = await db.from('products').update({ sku: d.sku, nama: d.nama, brand: d.brand, kategori: d.kategori, varian: d.varian, ukuran: d.ukuran, jenis: d.jenis, satuan: d.satuan, modal: d.modal, jual: d.jual, min_stok: d.min_stok, lokasi: d.lokasi, foto: d.foto, diperbarui: d.diperbarui }).eq('id', id);
  if (error?.code === '23505') throw new Error(`Kode produk ${d.sku} sudah digunakan`);
  if (error) throw error; return { ok: 1 };
}));
app.delete('/api/products/:id', route(async q => {
  const { error } = await db.from('products').update({ arsip: 1, diperbarui: wib() }).eq('id', q.params.id);
  if (error) throw error; return { ok: 1 };
}));
app.get('/api/lowstock', route(async () => {
  const { data, error } = await db.from('products').select('id,nama,brand,ukuran,stok,min_stok,satuan').eq('arsip', 0).order('stok').limit(1000);
  if (error) throw error;
  return (data || []).filter(x => Number(x.stok) <= Number(x.min_stok)).slice(0, 30);
}));

// ---------- Transaksi ----------
app.post('/api/trx', route(async q => {
  const b = q.body || {}, tipe = b.tipe === 'keluar' ? 'keluar' : 'masuk', qty = Number(b.qty);
  must(Number.isFinite(qty) && qty > 0, 'Jumlah harus lebih dari 0');
  const { data: p, error } = await db.from('products').select('*').eq('id', b.product_id).eq('arsip', 0).maybeSingle();
  if (error) throw error; must(p, 'Pilih produk terlebih dahulu');
  if (tipe === 'keluar') must(Number(p.stok) >= qty, `Stok ${p.nama} tidak cukup (tersisa ${p.stok} ${p.satuan})`);
  const alasan = tipe === 'keluar' ? (b.alasan || 'Penjualan') : 'Barang Masuk';
  const hv = b.harga === '' || b.harga == null ? null : b.harga;
  const harga = tipe === 'masuk' ? num(hv ?? p.modal, 'Harga') : alasan === 'Penjualan' ? num(hv ?? p.jual, 'Harga') : 0;
  const { data, error: trxError } = await db.rpc('record_stock_trx', {
    p_tipe: tipe, p_product_id: Number(b.product_id), p_qty: qty, p_harga: harga,
    p_pihak: String(b.pihak || ''), p_ref: String(b.ref || ''), p_alasan: alasan,
    p_catatan: String(b.catatan || ''), p_user: q.user.nama
  });
  if (trxError) throw new Error('Transaksi gagal. Pastikan SQL fungsi record_stock_trx sudah dijalankan: ' + trxError.message);
  return data;
}));
app.get('/api/trx', route(async q => {
  const tipe = q.query.tipe === 'keluar' ? 'keluar' : 'masuk', search = String(q.query.q || '').toLowerCase(), per = 10, p = Math.max(1, Number(q.query.page) || 1);
  const { data, error } = await db.from('trx').select('*,products!inner(nama,sku,satuan)').eq('tipe', tipe).order('id', { ascending: false }).limit(1000);
  if (error) throw error;
  let rows = (data || []).map(({ products, ...t }) => ({ ...t, nama: products?.nama, sku: products?.sku, satuan: products?.satuan }));
  if (search) rows = rows.filter(t => [t.no, t.pihak, t.ref, t.nama, t.sku].some(v => String(v || '').toLowerCase().includes(search)));
  const total = rows.length;
  return { rows: rows.slice((p - 1) * per, p * per), total, per };
}));
// ---------- Dashboard ----------
app.get('/api/dashboard', route(async () => {
  const [{ data: products, error: pe }, { data: trx, error: te }] = await Promise.all([
    db.from('products').select('id,nama,kategori,stok,min_stok,modal,arsip').eq('arsip', 0).limit(1000),
    db.from('trx').select('tipe,waktu,qty,product_id,products!inner(nama)').order('id', { ascending: false }).limit(5000)
  ]);
  if (pe) throw pe; if (te) throw te;
  const ps = products || [], ts = trx || [], today = wib().slice(0, 10);
  const k = { jenis: ps.length, stok: ps.reduce((a, p) => a + Number(p.stok || 0), 0), nilai: ps.reduce((a, p) => a + Number(p.stok || 0) * Number(p.modal || 0), 0), menipis: ps.filter(p => Number(p.stok) > 0 && Number(p.stok) <= Number(p.min_stok)).length, habis: ps.filter(p => Number(p.stok) <= 0).length };
  const cnt = (type) => ts.filter(t => t.tipe === type && String(t.waktu).startsWith(today)).length;
  const days = [...Array(7)].map((_, i) => new Date(Date.now() + 7 * 36e5 - (6 - i) * 864e5).toISOString().slice(0, 10));
  const mv = days.map(d => ({ d, masuk: ts.filter(t => t.tipe === 'masuk' && String(t.waktu).startsWith(d)).reduce((a, t) => a + Number(t.qty || 0), 0), keluar: ts.filter(t => t.tipe === 'keluar' && String(t.waktu).startsWith(d)).reduce((a, t) => a + Number(t.qty || 0), 0) }));
  const topMap = {};
  ts.filter(t => t.tipe === 'keluar').forEach(t => { const name = t.products?.nama || 'Produk'; topMap[name] = (topMap[name] || 0) + Number(t.qty || 0); });
  const top = Object.entries(topMap).map(([label, n]) => ({ label, n })).sort((a, b) => b.n - a.n).slice(0, 5);
  const katMap = {};
  ps.forEach(p => { katMap[p.kategori] = (katMap[p.kategori] || 0) + Number(p.stok || 0); });
  const kat = Object.entries(katMap).map(([label, n]) => ({ label, n })).sort((a, b) => b.n - a.n);
  return { k, masukHari: cnt('masuk'), keluarHari: cnt('keluar'), mv, top, kat };
}));

app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (q, s, next) => { if (q.path.startsWith('/api/')) return next(); s.sendFile(path.join(__dirname, 'public', 'index.html')); });
app.use((err, q, s, next) => { console.error(err); s.status(500).json({ error: 'Terjadi kesalahan server' }); });

if (!process.env.VERCEL) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`Perfume Stock Manager berjalan di http://localhost:${port}`));
}
module.exports = app;
