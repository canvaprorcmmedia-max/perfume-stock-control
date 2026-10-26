# Perfume Stock Manager

Aplikasi web pencatatan stok parfum (Node.js + Express + SQLite).

## Menjalankan
1. Pasang Node.js 18+ (https://nodejs.org)
2. Di folder ini jalankan:
   npm install
   npm start
3. Buka http://localhost:3000
4. Login awal: admin / admin123
   (ganti dengan: ADMIN_PASSWORD=katasandibaru npm start — saat pertama kali dijalankan)

Database tersimpan di file `stok.db` (dibuat otomatis).

## Format CSV impor/ekspor
Pemisah koma atau titik koma. Kolom:
sku;nama;brand;kategori;varian;ukuran;jenis;satuan;modal;jual;stok;min_stok;lokasi
(sku boleh kosong, akan dibuat otomatis)
