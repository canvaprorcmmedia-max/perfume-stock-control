-- Jalankan setelah tabel tahap 1 berhasil dibuat.
-- Fungsi ini mencatat transaksi dan memperbarui stok dalam satu transaksi PostgreSQL.
CREATE OR REPLACE FUNCTION public.record_stock_trx(
  p_tipe TEXT,
  p_product_id BIGINT,
  p_qty NUMERIC,
  p_harga NUMERIC,
  p_pihak TEXT DEFAULT '',
  p_ref TEXT DEFAULT '',
  p_alasan TEXT DEFAULT '',
  p_catatan TEXT DEFAULT '',
  p_user TEXT DEFAULT ''
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_product public.products%ROWTYPE;
  v_now TIMESTAMP WITHOUT TIME ZONE;
  v_date TEXT;
  v_count INTEGER;
  v_no TEXT;
  v_total NUMERIC;
BEGIN
  IF p_tipe NOT IN ('masuk', 'keluar') THEN
    RAISE EXCEPTION 'Tipe transaksi tidak valid';
  END IF;
  IF p_qty IS NULL OR p_qty <= 0 THEN
    RAISE EXCEPTION 'Jumlah harus lebih dari 0';
  END IF;

  SELECT * INTO v_product
  FROM public.products
  WHERE id = p_product_id AND arsip = 0
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Produk tidak ditemukan atau sudah diarsipkan'; END IF;
  IF p_tipe = 'keluar' AND v_product.stok < p_qty THEN
    RAISE EXCEPTION 'Stok tidak mencukupi. Stok tersedia: %', v_product.stok;
  END IF;

  v_now := timezone('Asia/Jakarta', now());
  v_date := to_char(v_now, 'YYYY-MM-DD');
  -- Hindari nomor transaksi ganda saat dua transaksi berjalan bersamaan.
  PERFORM pg_advisory_xact_lock(hashtext(p_tipe || ':' || v_date));
  SELECT count(*) + 1 INTO v_count
  FROM public.trx
  WHERE tipe = p_tipe AND waktu LIKE v_date || '%';
  v_no := CASE WHEN p_tipe = 'masuk' THEN 'IN-' ELSE 'OUT-' END
          || to_char(v_now, 'YYYYMMDD') || '-' || lpad(v_count::TEXT, 4, '0');
  v_total := p_qty * COALESCE(p_harga, 0);

  UPDATE public.products
  SET stok = CASE WHEN p_tipe = 'masuk' THEN stok + p_qty ELSE stok - p_qty END,
      diperbarui = to_char(v_now, 'YYYY-MM-DD HH24:MI:SS')
  WHERE id = p_product_id;

  INSERT INTO public.trx(no, tipe, waktu, product_id, qty, harga, total, pihak, ref, alasan, catatan, "user")
  VALUES (v_no, p_tipe, to_char(v_now, 'YYYY-MM-DD HH24:MI:SS'), p_product_id,
          p_qty, COALESCE(p_harga, 0), v_total, COALESCE(p_pihak, ''), COALESCE(p_ref, ''),
          COALESCE(p_alasan, ''), COALESCE(p_catatan, ''), COALESCE(p_user, ''));

  RETURN jsonb_build_object('no', v_no);
END;
$$;

REVOKE ALL ON FUNCTION public.record_stock_trx(TEXT, BIGINT, NUMERIC, NUMERIC, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_stock_trx(TEXT, BIGINT, NUMERIC, NUMERIC, TEXT, TEXT, TEXT, TEXT, TEXT) TO service_role;
