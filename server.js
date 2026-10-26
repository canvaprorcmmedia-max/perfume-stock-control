const express = require('express');
const crypto = require('crypto');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '3mb' }));

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !supabaseKey) {
  console.warn('Peringatan: SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY harus diatur pada Environment Variables.');
}
const db = createClient(supabaseUrl || 'https://example.supabase.co', supabaseKey || 'missing-service-role-key', {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
});

const wib = () => new Date(Date.now() + 7 * 36e5).toISOString().slice(0, 19).replace('T', ' ');
const hash = (p, s) => crypto.scryptSync(p, s, 32).toString('hex');
const hashToken = t => crypto.createHash('sha256').update(t).digest('hex');
const getTok = q => ((q.headers.cookie || '').match(/(?:^|;\s*)sid=([a-f0-9]+)/) || [])[1];
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
async function result(promise) {
  const { data, error, count } = await promise;
  if (error) { const e = new Error(error.message || 'Database error'); e.status = 400; throw e; }
  return { data, count };
}
async function ensureAdmin() {
  const { data: users, error } = await db.from('users').select('id').limit(1);
  if (error) throw new Error('Koneksi Supabase gagal: ' + error.message);
  if (users?.length) return;
  const username = String(process.env.ADMIN_USERNAME || 'admin').trim();
  const password = process.env.ADMIN_PASSWORD;
  must(password && password.length >= 12, 'Atur ADMIN_PASSWORD minimal 12 karakter pada Environment Variables sebelum login pertama.', 500);
  const salt = crypto.randomBytes(16).toString('hex');
  const { error: insertError } = await db.from('users').insert({ username, nama: 'Administrator', salt, hash: hash(password, salt) });
  if (insertError && insertError.code !== '23505') throw new Error('Gagal menyiapkan akun admin: ' + insertError.message);
}

app.post('/api/login', route(async (q, s) => {
  await ensureAdmin();
  const username = String(q.body?.username || '');
  const password = String(q.body?.password || '');
  const { data: u, error } = await db.from('users').select('id,username,nama,salt,hash').eq('username', username).maybeSingle();
  if (error) throw error;
  let ok = false;
  if (u) {
    const a = Buffer.from(hash(password, u.salt), 'hex');
    const b = Buffer.from(u.hash, 'hex');
    ok = a.length === b.length && crypto.timingSafeEqual(a, b);
  }
  must(ok, 'Username atau kata sandi salah', 401);
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const { error: se } = await db.from('sessions').insert({ token_hash: hashToken(token), username: u.username, nama: u.nama, expires_at: expires });
  if (se) throw se;
  s.setHeader('Set-Cookie', `sid=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=86400${process.env.VERCEL ? '; Secure' : ''}`);
  return { username: u.username, nama: u.nama };
}));

app.use('/api', async (q, s, next) => {
  if (q.path === '/login') return next();
  try {
    const token = getTok(q);
    if (!token) return s.status(401).json({ error: 'Silakan masuk terlebih dahulu' });
    const { data, error } = await db.from('sessions').select('username,nama,expires_at').eq('token_hash', hashToken(token)).gt('expires_at', new Date().toISOString()).maybeSingle();
    if (error) throw error;
    if (!data) return s.status(401).json({ error: 'Sesi berakhir. Silakan masuk kembali.' });
    q.user = { username: data.username, nama: data.nama };
    next();
  } catch (e) { console.error(e); s.status(401).json({ error: 'Sesi tidak valid. Silakan masuk kembali.' }); }
});
app.get('/api/me', route(q => q.user));
app.post('/api/logout', route(async (q, s) => {
  const token = getTok(q);
  if (token) { const { error } = await db.from('sessions').delete().eq('token_hash', hashToken(token)); if (error) throw error; }
  s.setHeader('Set-Cookie', 'sid=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0' + (process.env.VERCEL ? '; Secure' : ''));
  return { ok: 1 };
}));

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
