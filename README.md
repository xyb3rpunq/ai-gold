# AI GOLD — BULL OR BEAR · All Time Frame

Indikator bull/bear **XAUUSD** realtime di **15 timeframe** (1m, 2m, 3m, 5m, 10m, 15m, 30m, 45m, 1H, 2H, 3H, 4H, 1D, 1W, 1M).
Intinya adalah **AI yang dilatih langsung di browser** dari riwayat candle tiap timeframe, digabung dengan 60+ sinyal
teknikal & volume, korelasi DXY, yield, news high impact, dan sentimen.

**Live:** https://xyb3rpunq.github.io/ai-gold/

## Dua tampilan

- **Pemula** (bawaan): kondisi emas dalam bahasa awam — *condong naik / condong turun / belum jelas* — untuk gaya
  scalping, intraday, swing, atau jangka panjang, lengkap dengan checklist alasan (arah timeframe, AI, dolar AS,
  obligasi AS, berita, sesi), level penting, aturan aman, dan kamus istilah. Bagian Pro tidak dirender, jadi lebih ringan.
- **Pro**: dashboard lengkap — gauge, 15 timeframe, otak AI, 60+ sinyal, matriks, DXY, sentimen, headline.

## Dua mode harga

| Mode | Cara buka | Harga & candle |
|---|---|---|
| **Broker realtime (lokal)** | jalankan `start-ai-gold.bat`, buka `http://localhost:8787` | Candle & tick **persis** `PEPPERSTONE:XAUUSD` / `OANDA:XAUUSD` dari TradingView — sama dengan chart TradingView |
| **Web publik** | https://xyb3rpunq.github.io/ai-gold/ | Tick Binance XAUUSDT (WebSocket) dijangkarkan ke bid/ask broker dari scanner TradingView; selisih rata-rata ditampilkan di halaman |

TradingView hanya menerima koneksi WebSocket datanya dari `localhost` dan domain mereka sendiri. AI GOLD **tidak** mengakali
pembatasan itu (tidak ada proxy yang memalsukan header), jadi candle broker persis hanya tersedia di mode lokal.

## Inti AI

Untuk setiap timeframe:

1. **40 fitur** per bar: EMA/SMA/Hull MA, SuperTrend, PSAR, ADX, Aroon, Ichimoku, RSI, MACD, Stochastic, CCI, Williams %R,
   Bollinger, ATR, VWAP (σ), VWMA, OBV, A/D, CVD, MFI, CMF, Volume Oscillator, return 1/5 bar, return anti-DXY, jam sesi.
2. **Target:** apakah close 5 bar ke depan lebih tinggi.
3. **Model A — logistic regression** (L2, Newton-Raphson) dan **Model B — k-nearest neighbors** (analog pasar).
4. **Uji walk-forward:** 70% data lama untuk belajar, 30% terbaru untuk ujian yang belum pernah dilihat, dengan jeda H bar.
5. **Bobot AI di skor = 25% × reliabilitas**, dan reliabilitas diukur dari Brier skill score & akurasi out-of-sample.
   Model yang tidak lebih baik dari tebakan mayoritas otomatis tidak ikut memilih.
6. Dilatih ulang setiap ada bar baru yang tutup, di Web Worker.

Akurasi, Brier skill, jumlah sampel uji, fitur terpenting, dan analog historis ditampilkan apa adanya di panel **Otak AI**.

## Komposisi skor

- **Teknikal 45%**: Trend 27% · Momentum 18% · Volume 17% · Struktur 13% · Pola 10% · Konsensus TradingView 15%
- **AI 25% × reliabilitas**
- **DXY 15%** (kebalikan rating DXY × anti-korelasi emas~dolar yang terukur per timeframe)
- **Yield & VIX 7%** · **News makro 5%** (kejutan aktual vs forecast) · **Sentimen 3%** (posisi ritel Binance, funding, COT CFTC, headline)

Volume memakai dua sumber: tick volume broker (VWAP, Volume Profile, sama seperti chart TradingView) dan
**volume transaksi asli Binance XAUUSDT** (CVD dari taker delta sungguhan, OBV, A/D, Chaikin, CMF, Twiggs, MFI, PVT,
Force Index, Ease of Movement, Klinger, NVI/PVI, Volume Oscillator, Relative Volume).

## Validasi terhadap TradingView

`node scripts/validate-tv.mjs PEPPERSTONE 15 60 240` membandingkan indikator AI GOLD dengan nilai hitungan TradingView
pada candle broker yang sama. Hasil 17 Sep 2026: **78 perbandingan**, 24 dari 26 indikator identik **0,0000%**
(RSI, MACD, CCI, ADX/±DI, Bollinger, Ichimoku, VWMA, Hull MA 9, Ultimate, Stoch RSI, SMA, EMA20/50, Momentum, AO, Williams %R).
EMA200 & PSAR selisih ≤ 0,03% (panjang riwayat berbeda); Stochastic dibandingkan pada bar live (≤ 0,23%).

## Menjalankan

```bash
npm test                 # 138 tes, nol dependensi (node:test)
node scripts/smoke.mjs   # data sungguhan: semua TF + pelatihan AI
start-ai-gold.bat        # mode broker realtime di http://localhost:8787
```

Butuh Node ≥ 22 untuk tes dan Python 3 (atau server statis apa pun) untuk mode lokal.

## Sumber data

| Data | Sumber | Kadens |
|---|---|---|
| Candle & tick broker (lokal) | TradingView WebSocket | ±1 dtk |
| Tick & candle cadangan, volume asli | Binance XAUUSDT perpetual, PAXGUSDT | WebSocket ±250 ms |
| Quote broker, DXY, US10Y/02Y, VIX, rating teknikal, angka ekonomi | TradingView scanner | 5 dtk |
| Kalender ekonomi | ForexFactory (feed JSON publik) lewat GitHub Actions | ±15 mnt |
| Headline | TradingView news lewat GitHub Actions | ±15 mnt |
| Posisi & funding | Binance futures data | 60 dtk |
| COT | CFTC | mingguan |

"0 lag" secara harfiah tidak mungkin. Yang dilakukan: stream langsung tanpa server perantara, perhitungan di Web Worker,
reconnect otomatis + isi ulang celah, backoff sesuai `Retry-After` saat dibatasi, dan umur setiap feed ditampilkan.

> Bukan saran investasi. AI membaca probabilitas dari data masa lalu, bukan kepastian masa depan.
