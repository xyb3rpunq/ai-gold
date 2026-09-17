// Lapisan jaringan. Fungsi murni (URL, request, parser) di atas; kelas yang menyentuh
// WebSocket/fetch di bawah dan hanya dipakai di browser.
import { parseKline, parseWsKline } from './candles.js';

export const PERP_SYMBOL = 'XAUUSDT';
export const PAXG_SYMBOL = 'PAXGUSDT';
export const EUR_SYMBOL = 'EURUSDT';

export const TV_TFS = ['1', '5', '15', '30', '60', '120', '240', '', '1W', '1M'];
export const SCANNER_TICKERS = {
  gold: 'OANDA:XAUUSD',
  pepperstone: 'PEPPERSTONE:XAUUSD',
  dxy: 'TVC:DXY',
  us10y: 'TVC:US10Y',
  us02y: 'TVC:US02Y',
  vix: 'TVC:VIX',
  oil: 'NYMEX:CL1!',
  silver: 'TVC:SILVER',
  EURUSD: 'OANDA:EURUSD',
  USDJPY: 'OANDA:USDJPY',
  GBPUSD: 'OANDA:GBPUSD',
  USDCAD: 'OANDA:USDCAD',
  USDSEK: 'FX_IDC:USDSEK',
  USDCHF: 'OANDA:USDCHF',
};

export const NEWS_URL = 'https://raw.githubusercontent.com/xyb3rpunq/ai-gold/data/news.json';
export const COT_URL = 'https://publicreporting.cftc.gov/resource/72hh-3qpy.json?cftc_contract_market_code=088691'
  + '&$order=report_date_as_yyyy_mm_dd%20DESC&$limit=156'
  + '&$select=report_date_as_yyyy_mm_dd,m_money_positions_long_all,m_money_positions_short_all,open_interest_all';

// Kolom bid/ask dan close scanner tidak sama segarnya — kadang bid/ask membeku berjam-jam,
// kadang close yang tertinggal. Lacak kapan tiap kandidat terakhir berubah dan pakai yang terbaru.
// Seri (belum ada yang berubah) → close.
export function freshestRef(quote, track = {}, nowMs = Date.now()) {
  const mid = Number.isFinite(quote?.bid) && Number.isFinite(quote?.ask) && quote.ask >= quote.bid ? (quote.bid + quote.ask) / 2 : NaN;
  const close = Number.isFinite(quote?.close) ? quote.close : NaN;
  const next = {};
  for (const [key, value] of [['close', close], ['mid', mid]]) {
    const prev = track[key];
    if (!Number.isFinite(value)) continue;
    next[key] = !prev || prev.v !== value ? { v: value, t: prev ? nowMs : 0 } : prev;
  }
  const c = next.close;
  const m = next.mid;
  let field = null;
  if (c && m) field = m.t > c.t ? 'mid' : 'close';
  else if (c) field = 'close';
  else if (m) field = 'mid';
  const spread = Number.isFinite(mid) && quote.ask - quote.bid < 2 ? quote.ask - quote.bid : NaN;
  return { ref: field ? next[field].v : NaN, field, track: next, spread };
}

export function klineUrl(feed, interval, limit) {
  // limit ≤ 1000 = bobot 5 (1500 = bobot 10) — hemat kuota supaya IP pengunjung tidak kena 429/418.
  if (feed === 'perp') return `https://fapi.binance.com/fapi/v1/klines?symbol=${PERP_SYMBOL}&interval=${interval}&limit=${limit ?? 1000}`;
  const sym = feed === 'paxg' ? PAXG_SYMBOL : EUR_SYMBOL;
  return `https://api.binance.com/api/v3/klines?symbol=${sym}&interval=${interval}&limit=${limit ?? 1000}`;
}

export function wsUrl(feed, intervals) {
  // Stream pasar USDⓈ-M sekarang di /market/stream — endpoint lama /stream tidak lagi mengirim data.
  if (feed === 'perp') {
    const sym = PERP_SYMBOL.toLowerCase();
    return `wss://fstream.binance.com/market/stream?streams=${[`${sym}@aggTrade`, ...intervals.map((i) => `${sym}@kline_${i}`)].join('/')}`;
  }
  return `wss://stream.binance.com:9443/stream?streams=${intervals.map((i) => `${PAXG_SYMBOL.toLowerCase()}@kline_${i}`).join('/')}`;
}

export const ratingColumns = () => TV_TFS.map((tf) => (tf ? `Recommend.All|${tf}` : 'Recommend.All'));

// Tanpa header Content-Type: preflight scanner hanya mengizinkan Referer/Accept,
// jadi body dikirim sebagai text/plain (CORS-safelisted) dan server tetap membaca JSON.
export function scannerRequest(econTickers = []) {
  const tickers = [...Object.values(SCANNER_TICKERS), ...econTickers];
  return { symbols: { tickers, query: { types: [] } }, columns: ['close', 'change', 'update_mode', 'bid', 'ask', ...ratingColumns()] };
}

export function parseScanner(json) {
  const byTicker = {};
  for (const row of json?.data || []) {
    const [close, change, mode, bid, ask, ...ratings] = row.d;
    const r = {};
    TV_TFS.forEach((tf, i) => { if (Number.isFinite(ratings[i])) r[tf] = ratings[i]; });
    byTicker[row.s] = { close, change, mode, bid, ask, ratings: r };
  }
  const pick = (k) => byTicker[SCANNER_TICKERS[k]] || null;
  const econ = {};
  for (const [t, v] of Object.entries(byTicker)) if (t.startsWith('ECONOMICS:')) econ[t] = v.close;
  return {
    gold: pick('gold'), dxy: pick('dxy'), us10y: pick('us10y'), us02y: pick('us02y'), vix: pick('vix'),
    oil: pick('oil'), silver: pick('silver'),
    brokers: { PEPPERSTONE: pick('pepperstone'), OANDA: pick('gold') },
    fx: Object.fromEntries(['EURUSD', 'USDJPY', 'GBPUSD', 'USDCAD', 'USDSEK', 'USDCHF'].map((k) => [k, pick(k)?.close])),
    econ,
  };
}

export function parseCot(rows) {
  return (rows || [])
    .map((r) => ({
      date: r.report_date_as_yyyy_mm_dd?.slice(0, 10),
      long: Number(r.m_money_positions_long_all),
      short: Number(r.m_money_positions_short_all),
      oi: Number(r.open_interest_all),
    }))
    .filter((r) => Number.isFinite(r.long) && Number.isFinite(r.short))
    .map((r) => ({ ...r, net: r.long - r.short }));
}

export function parseKlines(raw) {
  if (!Array.isArray(raw)) throw new Error('respons kline bukan array');
  const out = raw.map(parseKline).filter((b) => [b.o, b.h, b.l, b.c, b.v].every(Number.isFinite) && b.h >= b.l);
  if (!out.length) throw new Error('kline kosong');
  return out;
}

export function parseStreamMessage(text) {
  const msg = JSON.parse(text);
  const data = msg.data || msg;
  if (data.e === 'aggTrade') return { kind: 'trade', price: Number(data.p), eventTime: data.E };
  if (data.e !== 'kline') return null;
  return { kind: 'kline', ...parseWsKline(data), eventTime: data.E };
}

// ---------------- browser ----------------

// Batas rate per host: setelah 429/418, host itu tidak dihubungi lagi sampai Retry-After lewat.
export const backoffUntil = new Map();

export function retryAfterMs(status, header, nowMs = Date.now()) {
  const secs = Number(header);
  if (Number.isFinite(secs) && secs > 0) return nowMs + secs * 1000;
  return nowMs + (status === 418 ? 180_000 : 60_000);
}

export async function fetchJson(url, { timeout = 10_000, ...init } = {}) {
  const host = new URL(url).host;
  const wait = (backoffUntil.get(host) || 0) - Date.now();
  if (wait > 0) throw new Error(`menunggu batas rate ${host} (${Math.ceil(wait / 1000)} dtk)`);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal, cache: 'no-store' });
    if (res.status === 429 || res.status === 418) {
      backoffUntil.set(host, retryAfterMs(res.status, res.headers.get('retry-after')));
      throw new Error(`HTTP ${res.status} — dibatasi, mundur sesuai Retry-After`);
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// WebSocket dengan reconnect eksponensial + watchdog diam. onOpen dipanggil tiap tersambung
// (dipakai untuk resync REST supaya celah saat putus tertutup).
export class LiveSocket {
  constructor(url, { onMessage, onOpen, onStatus, silenceMs = 20_000 }) {
    Object.assign(this, { url, onMessage, onOpen, onStatus, silenceMs });
    this.attempt = 0;
    this.lastMsg = 0;
    this.connect();
    this.watchdog = setInterval(() => {
      if (this.ws?.readyState === 1 && Date.now() - this.lastMsg > this.silenceMs) this.ws.close();
    }, 5_000);
  }

  connect() {
    this.onStatus?.('connecting');
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.onopen = () => {
      this.attempt = 0;
      this.lastMsg = Date.now();
      this.onStatus?.('open');
      // Hanya sambungan ulang yang perlu mengisi celah lewat REST; sambungan pertama sudah punya data.
      this.onOpen?.({ reconnect: this.opened === true });
      this.opened = true;
    };
    ws.onmessage = (e) => {
      this.lastMsg = Date.now();
      this.onMessage(e.data);
    };
    ws.onclose = () => {
      this.onStatus?.('closed');
      const delay = Math.min(30_000, 500 * 2 ** this.attempt++);
      setTimeout(() => this.connect(), delay);
    };
    ws.onerror = () => ws.close();
  }
}
