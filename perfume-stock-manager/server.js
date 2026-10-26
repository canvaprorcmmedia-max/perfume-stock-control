const express = require('express'), Database = require('better-sqlite3'), crypto = require('crypto'), path = require('path');
const db = new Database(path.join(__dirname, 'stok.db'));
db.pragma('journal_mode=WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY,username TEXT UNIQUE,nama TEXT,salt TEXT,hash TEXT);
CREATE TABLE IF NOT EXISTS products(id INTEGER PRIMARY KEY,sku TEXT UNIQUE NOT NULL,nama TEXT NOT NULL,brand TEXT NOT NULL,kategori TEXT NOT NULL,varian TEXT,ukuran TEXT,jenis TEXT,satuan TEXT DEFAULT 'botol',modal REAL DEFAULT 0,jual REAL DEFAULT 0,stok REAL DEFAULT 0,min_stok REAL DEFAULT 5,lokasi TEXT,foto TEXT,arsip INTEGER DEFAULT 0,dibuat TEXT,diperbarui TEXT);
CREATE TABLE IF NOT EXISTS trx(id INTEGER PRIMARY KEY,no TEXT UNIQUE,tipe TEXT,waktu TEXT,product_id INTEGER,qty REAL,harga REAL,total REAL,pihak TEXT,ref TEXT,alasan TEXT,catatan TEXT,user TEXT);
CREATE INDEX IF NOT EXISTS i_trx ON trx(tipe,waktu);
`);
const wib = () => new Date(Date.now() + 7 * 36e5).toISOString().slice(0, 19).replace('T', ' '); // waktu WIB
const hash = (p, s) => crypto.scryptSync(p, s, 32).toString('hex');
if (!db.prepare('SELECT 1 FROM users').get()) {
  const s = crypto.randomBytes(8).toString('hex');
  db.prepare('INSERT INTO users(username,nama,salt,hash) VALUES(?,?,?,?)').run('admin', 'Administrator', s, hash(process.env.ADMIN_PASSWORD || 'admin123', s));
}
const sess = new Map();
const app = express();
app.use(express.json({ limit: '3mb' }));
const h = f => (q, s) => { try { s.json(f(q, s)); } catch (e) { s.status(e.code || 400).json({ error: e.message }); } };
const getTok = q => ((q.headers.cookie || '').match(/sid=([a-f0-9]+)/) || [])[1];

app.post('/api/login', h((q, s) => {
  const u = db.prepare('SELECT * FROM users WHERE username=?').get(String(q.body.username || ''));
  const ok = u && crypto.timingSafeEqual(Buffer.from(hash(String(q.body.password || ''), u.salt)), Buffer.from(u.hash));
  if (!ok) throw new Error('Username atau kata sandi salah');
  const t = crypto.randomBytes(24).toString('hex');
  sess.set(t, { username: u.username, nama: u.nama });
  s.setHeader('Set-Cookie', `sid=${t}; HttpOnly; Path=/; SameSite=Lax; Max-Age=86400`);
  return sess.get(t);
}));
app.use('/api', (q, s, n) => {
  const u = sess.get(getTok(q));
  if (!u) return s.status(401).json({ error: 'Silakan masuk terlebih dahulu' });
  q.user = u; n();
});
app.get('/api/me', h(q => q.user));
app.post('/api/logout', h((q, s) => { sess.delete(getTok(q)); s.setHeader('Set-Cookie', 'sid=; Path=/; Max-Age=0'); return { ok: 1 }; }));

// ---------- Produk ----------
const COLS = 'id,sku,nama,brand,kategori,varian,ukuran,jenis,satuan,modal,jual,stok,min_stok,lokasi,(foto IS NOT NULL) AS ada_foto,dibuat,diperbarui';
const ST = { habis: 'stok<=0', menipis: 'stok>0 AND stok<=min_stok', aman: 'stok>min_stok' };
const SORT = ['nama', 'stok', 'jual', 'modal', 'dibuat', 'sku'];
const num = (v, n) => { const x = Number(v || 0); if (isNaN(x) || x < 0) throw new Error(n + ' tidak valid'); return x; };
function pData(b) {
  const t = k => String(b[k] ?? '').trim();
  for (const [k, l] of [['nama', 'Nama parfum'], ['brand', 'Merek'], ['kategori', 'Kategori']]) if (!t(k)) throw new Error(l + ' wajib diisi');
  return { sku: t('sku'), nama: t('nama'), brand: t('brand'), kategori: t('kategori'), varian: t('varian'), ukuran: t('ukuran'), jenis: t('jenis'), satuan: t('satuan') || 'botol',
    modal: num(b.modal, 'Harga modal'), jual: num(b.jual, 'Harga jual'), stok: num(b.stok, 'Stok'),
    min_stok: num(b.min_stok === undefined || b.min_stok === '' ? 5 : b.min_stok, 'Batas minimum stok'), lokasi: t('lokasi'), foto: b.foto || null };
}
function addProduct(b) {
  const d = pData(b);
  d.sku = d.sku || 'PRF-' + String(db.prepare('SELECT COALESCE(MAX(id),0)+1 n FROM products').get().n).padStart(5, '0');
  if (db.prepare('SELECT 1 FROM products WHERE sku=?').get(d.sku)) throw new Error(`Kode produk ${d.sku} sudah digunakan`);
  d.dibuat = d.diperbarui = wib();
  return db.prepare('INSERT INTO products(sku,nama,brand,kategori,varian,ukuran,jenis,satuan,modal,jual,stok,min_stok,lokasi,foto,dibuat,diperbarui) VALUES(@sku,@nama,@brand,@kategori,@varian,@ukuran,@jenis,@satuan,@modal,@jual,@stok,@min_stok,@lokasi,@foto,@dibuat,@diperbarui)').run(d).lastInsertRowid;
}
app.get('/api/products', h(q => {
  const { q: s, kategori, ukuran, status, sort, dir, page, all } = q.query;
  const w = ['arsip=0'], a = [];
  if (s) { w.push('(nama LIKE ? OR sku LIKE ? OR brand LIKE ?)'); a.push(`%${s}%`, `%${s}%`, `%${s}%`); }
  if (kategori) { w.push('kategori=?'); a.push(kategori); }
  if (ukuran) { w.push('ukuran=?'); a.push(ukuran); }
  if (ST[status]) w.push(ST[status]);
  const W = w.join(' AND '), per = 10, p = Math.max(1, +page || 1);
  const total = db.prepare(`SELECT COUNT(*) n FROM products WHERE ${W}`).get(...a).n;
  const ord = `ORDER BY ${SORT.includes(sort) ? sort : 'nama'} ${dir === 'desc' ? 'DESC' : 'ASC'}`;
  const rows = db.prepare(`SELECT ${COLS} FROM products WHERE ${W} ${ord} ${all ? '' : `LIMIT ${per} OFFSET ${(p - 1) * per}`}`).all(...a);
  return { rows, total, per };
}));
app.get('/api/meta', h(() => ({
  kategori: db.prepare("SELECT DISTINCT kategori v FROM products WHERE arsip=0 ORDER BY 1").all().map(x => x.v),
  ukuran: db.prepare("SELECT DISTINCT ukuran v FROM products WHERE arsip=0 AND ukuran<>'' ORDER BY 1").all().map(x => x.v)
})));
app.get('/api/products/:id', h(q => { const p = db.prepare('SELECT * FROM products WHERE id=?').get(+q.params.id); if (!p) throw new Error('Produk tidak ditemukan'); return p; }));
app.post('/api/products', h(q => ({ id: addProduct(q.body) })));
app.post('/api/products/import', h(q => {
  let ok = 0; const err = [];
  db.transaction(() => (q.body.rows || []).forEach((r, i) => { try { addProduct(r); ok++; } catch (e) { err.push(`Baris ${i + 2}: ${e.message}`); } }))();
  return { ok, err };
}));
app.put('/api/products/:id', h(q => {
  const id = +q.params.id, old = db.prepare('SELECT * FROM products WHERE id=?').get(id);
  if (!old) throw new Error('Produk tidak ditemukan');
  const d = pData(q.body); d.sku = d.sku || old.sku;
  if (db.prepare('SELECT 1 FROM products WHERE sku=? AND id<>?').get(d.sku, id)) throw new Error(`Kode produk ${d.sku} sudah digunakan`);
  d.foto = q.body.foto === undefined ? old.foto : q.body.foto; d.id = id; d.diperbarui = wib();
  db.prepare('UPDATE products SET sku=@sku,nama=@nama,brand=@brand,kategori=@kategori,varian=@varian,ukuran=@ukuran,jenis=@jenis,satuan=@satuan,modal=@modal,jual=@jual,min_stok=@min_stok,lokasi=@lokasi,foto=@foto,diperbarui=@diperbarui WHERE id=@id').run(d);
  return { ok: 1 };
}));
app.delete('/api/products/:id', h(q => { db.prepare('UPDATE products SET arsip=1,diperbarui=? WHERE id=?').run(wib(), +q.params.id); return { ok: 1 }; }));
app.get('/api/lowstock', h(() => db.prepare('SELECT id,nama,brand,ukuran,stok,min_stok,satuan FROM products WHERE arsip=0 AND stok<=min_stok ORDER BY stok LIMIT 30').all()));

// ---------- Transaksi ----------
app.post('/api/trx', h(q => {
  const b = q.body, tipe = b.tipe === 'keluar' ? 'keluar' : 'masuk', qty = Number(b.qty);
  if (!(qty > 0)) throw new Error('Jumlah harus lebih dari 0');
  return db.transaction(() => {
    const p = db.prepare('SELECT * FROM products WHERE id=? AND arsip=0').get(+b.product_id);
    if (!p) throw new Error('Pilih produk terlebih dahulu');
    if (tipe === 'keluar' && p.stok < qty) throw new Error(`Stok ${p.nama} tidak cukup (tersisa ${p.stok} ${p.satuan})`);
    const hv = b.harga === '' || b.harga == null ? null : b.harga;
    const alasan = tipe === 'keluar' ? (b.alasan || 'Penjualan') : 'Barang Masuk';
    const harga = tipe === 'masuk' ? num(hv ?? p.modal, 'Harga') : alasan === 'Penjualan' ? num(hv ?? p.jual, 'Harga') : 0;
    const waktu = wib(), tgl = waktu.slice(0, 10);
    const n = db.prepare('SELECT COUNT(*) n FROM trx WHERE tipe=? AND waktu LIKE ?').get(tipe, tgl + '%').n + 1;
    const no = `${tipe === 'masuk' ? 'IN' : 'OUT'}-${tgl.replace(/-/g, '')}-${String(n).padStart(4, '0')}`;
    db.prepare('UPDATE products SET stok=stok+?,diperbarui=? WHERE id=?').run(tipe === 'masuk' ? qty : -qty, waktu, p.id);
    db.prepare('INSERT INTO trx(no,tipe,waktu,product_id,qty,harga,total,pihak,ref,alasan,catatan,user) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(no, tipe, waktu, p.id, qty, harga, qty * harga, b.pihak || '', b.ref || '', alasan, b.catatan || '', q.user.nama);
    return { no };
  })();
}));
app.get('/api/trx', h(q => {
  const { tipe, q: s = '', page } = q.query, per = 10, p = Math.max(1, +page || 1), l = `%${s}%`;
  const W = 't.tipe=? AND (t.no LIKE ? OR p.nama LIKE ? OR p.sku LIKE ? OR t.pihak LIKE ? OR t.ref LIKE ?)', a = [tipe === 'keluar' ? 'keluar' : 'masuk', l, l, l, l, l];
  const total = db.prepare(`SELECT COUNT(*) n FROM trx t JOIN products p ON p.id=t.product_id WHERE ${W}`).get(...a).n;
  const rows = db.prepare(`SELECT t.*,p.nama,p.sku,p.satuan FROM trx t JOIN products p ON p.id=t.product_id WHERE ${W} ORDER BY t.id DESC LIMIT ${per} OFFSET ${(p - 1) * per}`).all(...a);
  return { rows, total, per };
}));

// ---------- Dashboard ----------
app.get('/api/dashboard', h(() => {
  const g = (sql, ...a) => db.prepare(sql).get(...a), today = wib().slice(0, 10);
  const k = g('SELECT COUNT(*) jenis,COALESCE(SUM(stok),0) stok,COALESCE(SUM(stok*modal),0) nilai,COALESCE(SUM(stok>0 AND stok<=min_stok),0) menipis,COALESCE(SUM(stok<=0),0) habis FROM products WHERE arsip=0');
  const cnt = t => g('SELECT COUNT(*) n FROM trx WHERE tipe=? AND waktu LIKE ?', t, today + '%').n;
  const sum = (t, d) => g('SELECT COALESCE(SUM(qty),0) n FROM trx WHERE tipe=? AND waktu LIKE ?', t, d + '%').n;
  const days = [...Array(7)].map((_, i) => new Date(Date.now() + 7 * 36e5 - (6 - i) * 864e5).toISOString().slice(0, 10));
  return {
    k, masukHari: cnt('masuk'), keluarHari: cnt('keluar'),
    mv: days.map(d => ({ d, masuk: sum('masuk', d), keluar: sum('keluar', d) })),
    top: db.prepare("SELECT p.nama label,SUM(t.qty) n FROM trx t JOIN products p ON p.id=t.product_id WHERE t.tipe='keluar' GROUP BY p.id ORDER BY n DESC LIMIT 5").all(),
    kat: db.prepare('SELECT kategori label,SUM(stok) n FROM products WHERE arsip=0 GROUP BY kategori ORDER BY n DESC').all()
  };
}));

app.use(express.static(path.join(__dirname, 'public')));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Perfume Stock Manager berjalan di http://localhost:${PORT}`));
