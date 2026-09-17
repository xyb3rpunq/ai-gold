// Validasi silang: indikator AI GOLD vs nilai yang dihitung TradingView sendiri (scanner),
// pada candle broker yang sama (bar tutup terakhir, kolom [1], supaya bebas selisih bar live).
// Jalankan: node scripts/validate-tv.mjs [PEPPERSTONE|OANDA] [resolusi...]
import * as I from '../js/indicators.js';
import { toSeries } from '../js/candles.js';
import { TvFeed, BROKERS, mergeBars } from '../js/tvfeed.js';

const broker = process.argv[2] || 'PEPPERSTONE';
const resolutions = process.argv.slice(3).length ? process.argv.slice(3) : ['15', '60', '240'];
const symbol = BROKERS[broker];

async function candles(res) {
  let bars = [];
  await new Promise((resolve) => {
    const feed = new TvFeed({
      // Mode lokal: Node tidak mengirim Origin, jadi pakai localhost yang memang diizinkan TradingView.
      socket: (url) => new WebSocket(url, { headers: { Origin: 'http://localhost' } }),
      series: [{ key: 'v', symbol, res, count: 2000 }],
      quotes: [],
      onBars: (_k, b) => {
        bars = mergeBars(bars, b, 5000);
        setTimeout(() => { feed.stop(); resolve(); }, 800);
      },
    });
    setTimeout(() => { feed.stop(); resolve(); }, 15000);
  });
  return bars;
}

const COLS = {
  RSI: (s) => I.rsi(s.c, 14),
  EMA20: (s) => I.ema(s.c, 20),
  EMA50: (s) => I.ema(s.c, 50),
  EMA200: (s) => I.ema(s.c, 200),
  SMA20: (s) => I.sma(s.c, 20),
  SMA50: (s) => I.sma(s.c, 50),
  SMA200: (s) => I.sma(s.c, 200),
  'MACD.macd': (s) => I.macd(s.c).line,
  'MACD.signal': (s) => I.macd(s.c).signal,
  'Stoch.K': (s) => I.stoch(s.h, s.l, s.c, 14, 3, 3).k,
  'Stoch.D': (s) => I.stoch(s.h, s.l, s.c, 14, 3, 3).d,
  CCI20: (s) => I.cci(s.h, s.l, s.c, 20),
  ADX: (s) => I.dmi(s.h, s.l, s.c, 14, 14).adx,
  'ADX+DI': (s) => I.dmi(s.h, s.l, s.c, 14, 14).plus,
  'ADX-DI': (s) => I.dmi(s.h, s.l, s.c, 14, 14).minus,
  AO: (s) => I.awesome(s.h, s.l),
  Mom: (s) => I.momentum(s.c, 10),
  'W.R': (s) => I.williamsR(s.h, s.l, s.c, 14),
  'BB.upper': (s) => I.bollinger(s.c, 20, 2).upper,
  'BB.lower': (s) => I.bollinger(s.c, 20, 2).lower,
  'Ichimoku.BLine': (s) => I.ichimoku(s.h, s.l).kijun,
  VWMA: (s) => I.vwma(s.c, s.v, 20),
  HullMA9: (s) => I.hma(s.c, 9),
  UO: (s) => I.ultimate(s.h, s.l, s.c),
  'P.SAR': (s) => I.psar(s.h, s.l).sar,
  'Stoch.RSI.K': (s) => I.stochRsi(s.c).k,
};

// Kolom Stoch.K[1]/Stoch.D[1] scanner dihitung berbeda dari ta.stoch pada bar sebelumnya,
// sedangkan nilai live-nya identik — jadi Stochastic dibandingkan di bar live.
const LIVE_ONLY = new Set(['Stoch.K', 'Stoch.D']);
let worst = 0;
let compared = 0;
for (const res of resolutions) {
  const bars = await candles(res);
  if (bars.length < 300) { console.log(`${res}: bar kurang (${bars.length})`); continue; }
  const s = toSeries(bars);
  const tfKey = res === '1D' ? '' : `|${res}`;
  const names = Object.keys(COLS);
  const scanner = await fetch('https://scanner.tradingview.com/global/scan', {
    method: 'POST',
    body: JSON.stringify({ symbols: { tickers: [symbol] }, columns: ['close', ...names.map((n) => `${n}[1]${tfKey}`), ...names.map((n) => `${n}${tfKey}`)] }),
  }).then((r) => r.json());
  const d = scanner.data?.[0]?.d || [];
  console.log(`\n${symbol} resolusi ${res} · ${bars.length} bar · close TV ${d[0]} vs close kita ${s.c.at(-1)}`);
  names.forEach((name, k) => {
    const prevTv = d[1 + k];
    const liveTv = d[1 + names.length + k];
    const arr = COLS[name](s);
    const useClosed = Number.isFinite(prevTv) && !LIVE_ONLY.has(name);
    const tv = useClosed ? prevTv : liveTv;
    const ours = useClosed ? arr[arr.length - 2] : arr[arr.length - 1];
    if (!Number.isFinite(tv) || !Number.isFinite(ours)) {
      console.log(`  ${name.padEnd(15)} TV ${tv}  kita ${ours}  (dilewati)`);
      return;
    }
    const scale = Math.max(Math.abs(tv), 1e-9);
    const rel = Math.abs(ours - tv) / scale;
    compared++;
    if (useClosed) worst = Math.max(worst, rel);
    console.log(`  ${name.padEnd(15)} TV ${tv.toFixed(4).padStart(12)}  kita ${ours.toFixed(4).padStart(12)}  selisih ${(rel * 100).toFixed(4)}% ${useClosed ? '[bar tutup]' : '[bar live]'}`);
  });
}
console.log(`\n${compared} perbandingan · selisih relatif terbesar (bar tutup) ${(worst * 100).toFixed(4)}%`);
process.exit(0);
