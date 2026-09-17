// Pusat data (berjalan di Web Worker): TradingView WebSocket untuk harga & candle broker + DXY,
// Binance untuk volume transaksi asli (dan cadangan harga), scanner/sentimen/news/COT lewat polling.
// Menghitung ulang semua timeframe tiap detik dan melatih AI saat ada bar baru.
import { TIMEFRAMES, baseStreams, upsert, tvResolutions } from './candles.js';
import * as F from './feeds.js';
import { TvFeed, BROKERS, mergeBars } from './tvfeed.js';
import { computeAll, updateBasis, chartPayload } from './engine.js';

// TradingView hanya menerima WebSocket dari localhost (dan domain mereka). Di web publik feed ini
// dilewati sepenuhnya, bukan diakali.
export const tvAllowedHost = (hostname) => hostname === 'localhost';

const SCANNER_URL = 'https://scanner.tradingview.com/global/scan';
export const QUOTE_SYMBOLS = ['TVC:DXY', 'TVC:US10Y', 'TVC:US02Y', 'TVC:VIX', 'TVC:SILVER', 'NYMEX:CL1!'];
const GOLD_COUNT = { '1W': 1000, '1M': 500 };

export function seriesPlan(broker) {
  const symbol = BROKERS[broker] || BROKERS.PEPPERSTONE;
  return tvResolutions().flatMap((res) => [
    { key: `gold_${res}`, symbol, res, count: GOLD_COUNT[res] || 1500 },
    { key: `dxy_${res}`, symbol: 'TVC:DXY', res, count: 400 },
  ]);
}

// Sumber harga yang dipakai: TradingView bila hampir semua resolusi sudah terisi.
export function chooseSource(store, loaded) {
  const res = tvResolutions();
  const ready = res.filter((r) => (store.gold[r]?.length || 0) >= 60).length;
  if (ready >= res.length - 1) return 'tv';
  if ((loaded.perp || loaded.paxgIntraday) && loaded.paxg) return 'binance';
  return ready ? 'tv' : null;
}

export class DataHub {
  constructor(emit, { now = () => Date.now(), hostname = globalThis.location?.hostname || '', socket } = {}) {
    this.emit = emit;
    this.now = now;
    this.tvMode = tvAllowedHost(hostname);
    this.socket = socket;
    this.broker = 'PEPPERSTONE';
    this.store = { gold: {}, dxy: {}, perp: {}, paxg: {}, eur: {} };
    this.market = { scanner: null, quotes: {}, sentiment: {}, cot: [], news: { events: [], headlines: [] }, basis: {}, broker: this.broker, accuracy: null };
    this.status = {};
    this.selected = '15m';
    this.dirty = true;
    this.lastTickEmit = 0;
    this.lastPrice = { perp: NaN, paxg: NaN };
    this.econTickers = [];
    this.loaded = { perp: false, paxg: false, eur: false, paxgIntraday: false };
    this.aiCache = new Map();
    this.source = null;
    this.tv = null;
  }

  setStatus(key, patch) {
    this.status[key] = { ...(this.status[key] || {}), ...patch };
  }

  async guard(key, fn) {
    try {
      const out = await fn();
      this.setStatus(key, { ok: true, at: this.now(), error: null });
      return out;
    } catch (err) {
      this.setStatus(key, { ok: false, error: err.message || String(err), failedAt: this.now() });
      return undefined;
    }
  }

  // ---------- TradingView ----------
  startTv() {
    if (!this.tvMode) return;
    this.tv?.stop();
    this.store.gold = {};
    this.store.dxy = {};
    const symbol = BROKERS[this.broker];
    this.tv = new TvFeed({
      series: seriesPlan(this.broker),
      quotes: [BROKERS.PEPPERSTONE, BROKERS.OANDA, ...QUOTE_SYMBOLS],
      onBars: (key, bars, full) => this.onTvBars(key, bars, full),
      onQuote: (sym, values) => this.onTvQuote(sym, values, symbol),
      ...(this.socket ? { socket: this.socket } : {}),
      maxFailures: 5,
      onStatus: (st) => {
        if (st.state === 'error') this.setStatus('tv', { lastError: st.error });
        else if (st.state === 'rejected') this.setStatus('tv', { state: 'rejected', ok: false, error: st.error });
        else this.setStatus('tv', { state: st.state, ...(st.state === 'closed' ? { ok: false } : {}) });
      },
    });
  }

  onTvBars(key, bars, full) {
    if (!key || !bars.length) return;
    const [kind, res] = key.split('_');
    const bucket = kind === 'gold' ? this.store.gold : this.store.dxy;
    bucket[res] = full && !bucket[res] ? bars : mergeBars(bucket[res] || [], bars, kind === 'gold' ? 2000 : 500);
    if (kind === 'gold') this.setStatus('tv', { ok: true, at: this.now(), error: null });
    this.dirty = true;
  }

  onTvQuote(symbol, values, brokerSymbol) {
    const prev = this.market.quotes[symbol] || {};
    const q = { ...prev, ...values, at: this.now() };
    this.market.quotes[symbol] = q;
    if (symbol === brokerSymbol && Number.isFinite(q.lp)) {
      const nowMs = this.now();
      // lp_time beresolusi detik dan hanya berubah saat harga last berubah → ukur hanya saat ikut dikirim.
      const latency = Number.isFinite(values.lp_time) ? Math.max(0, nowMs - values.lp_time * 1000) : this.status.tv_quote?.latency ?? null;
      this.setStatus('tv_quote', { ok: true, at: nowMs, latency });
      if (nowMs - this.lastTickEmit >= 120) {
        this.lastTickEmit = nowMs;
        this.emit({ type: 'tick', price: q.lp, bid: q.bid, ask: q.ask, chp: q.chp, at: nowMs, source: 'tv' });
      }
      // Basis Binance terhadap broker untuk mode cadangan.
      this.market.basis = {
        perp: updateBasis(this.market.basis.perp, this.lastPrice.perp, q.lp),
        paxg: updateBasis(this.market.basis.paxg, this.lastPrice.paxg, q.lp),
      };
    }
    this.dirty = true;
  }

  setBroker(broker) {
    if (!BROKERS[broker] || broker === this.broker) return;
    this.broker = broker;
    this.market.broker = broker;
    this.market.basis = {};
    this.market.accuracy = null;
    this.aiCache.clear();
    this.startTv();
    this.dirty = true;
  }

  // Mode web publik: jangkarkan harga Binance ke bid/ask broker dari scanner, dan ukur selisihnya.
  anchorToBroker(sc) {
    if (this.source === 'tv') return;
    const quote = sc.brokers?.[this.broker];
    const fresh = F.freshestRef(quote, this.quoteTrack?.[this.broker], this.now());
    this.quoteTrack = { ...(this.quoteTrack || {}), [this.broker]: fresh.track };
    const ref = fresh.ref;
    if (!Number.isFinite(ref)) return;
    const feed = this.primaryFeed();
    const prevBasis = this.market.basis[feed];
    if (Number.isFinite(prevBasis) && Number.isFinite(this.lastPrice[feed])) {
      const err = Math.abs(this.lastPrice[feed] - prevBasis - ref);
      const prev = this.market.accuracy;
      this.market.accuracy = { last: err, mae: prev ? 0.9 * prev.mae + 0.1 * err : err, n: (prev?.n || 0) + 1 };
    }
    this.market.basis = {
      perp: updateBasis(this.market.basis.perp, this.lastPrice.perp, ref),
      paxg: updateBasis(this.market.basis.paxg, this.lastPrice.paxg, ref),
    };
    this.market.brokerQuote = { bid: quote.bid, ask: quote.ask, close: quote.close, ref, field: fresh.field, spread: fresh.spread, at: this.now() };
  }

  // ---------- Binance ----------
  async loadKlines(feed) {
    const streams = baseStreams()[feed] || [];
    await Promise.all(streams.map(async (iv) => {
      this.store[feed][iv] = F.parseKlines(await F.fetchJson(F.klineUrl(feed, iv)));
    }));
    this.lastPrice[feed] = this.store[feed][streams[0]]?.at(-1)?.c ?? NaN;
    this.loaded[feed] = true;
    this.dirty = true;
  }

  // Cadangan kedua: interval intraday diambil dari PAXGUSDT spot bila perp gagal dimuat.
  async enablePaxgFallback() {
    if (this.loaded.perp || this.loaded.paxgIntraday) return;
    const intervals = baseStreams().perp.filter((iv) => !(baseStreams().paxg || []).includes(iv));
    await Promise.all(intervals.map(async (iv) => {
      this.store.paxg[iv] = F.parseKlines(await F.fetchJson(F.klineUrl('paxg', iv)));
    }));
    this.loaded.paxgIntraday = true;
    this.dirty = true;
    new F.LiveSocket(F.wsUrl('paxg', intervals), {
      onMessage: (t) => this.onWs('paxg', t),
      onStatus: (s) => this.setStatus('ws_paxg_intraday', { state: s, ...(s === 'closed' ? { ok: false } : {}) }),
      onOpen: ({ reconnect }) => { if (reconnect) this.guard('rest_paxg_intraday', () => this.enablePaxgFallbackReload(intervals)); },
    });
  }

  async enablePaxgFallbackReload(intervals) {
    await Promise.all(intervals.map(async (iv) => {
      this.store.paxg[iv] = F.parseKlines(await F.fetchJson(F.klineUrl('paxg', iv)));
    }));
    this.dirty = true;
  }

  // Feed Binance utama untuk harga tick & basis: perp bila ada, kalau tidak PAXG.
  primaryFeed() {
    return this.loaded.perp ? 'perp' : 'paxg';
  }

  async loadEur() {
    const all = [...new Set(Object.values(baseStreams()).flat())];
    await Promise.all(all.map(async (iv) => {
      this.store.eur[iv] = F.parseKlines(await F.fetchJson(F.klineUrl('eur', iv)));
    }));
    this.loaded.eur = true;
    this.dirty = true;
  }

  onWs(feed, text) {
    let k;
    try {
      k = F.parseStreamMessage(text);
    } catch {
      return;
    }
    if (!k || !this.loaded[feed]) return;
    const nowMs = this.now();
    if (k.kind === 'trade') {
      if (!Number.isFinite(k.price)) return;
      this.lastPrice[feed] = k.price;
      this.setStatus(`ws_${feed}`, { ok: true, at: nowMs, latency: k.eventTime ? Math.max(0, nowMs - k.eventTime) : null });
      if (this.source === 'binance' && nowMs - this.lastTickEmit >= 150) {
        this.lastTickEmit = nowMs;
        const basis = this.market.basis.perp;
        const bq = this.market.brokerQuote;
        const half = bq && Number.isFinite(bq.spread) ? bq.spread / 2 : NaN;
        const price = Number.isFinite(basis) ? k.price - basis : NaN;
        this.emit({ type: 'tick', price, bid: price - half, ask: price + half, at: nowMs, source: 'binance' });
      }
      return;
    }
    const arr = this.store[feed][k.interval];
    if (!arr) return;
    upsert(arr, k, feed === 'perp' ? 1500 : 1000);
    const priceInterval = feed === 'perp' || this.loaded.paxgIntraday ? '1m' : '1d';
    if (k.interval === priceInterval) {
      this.lastPrice[feed] = k.c;
      this.setStatus(`ws_${feed}`, { ok: true, at: nowMs, latency: k.eventTime ? Math.max(0, nowMs - k.eventTime) : null });
      // Mode cadangan PAXG: tick harga datang dari kline 1m PAXGUSDT.
      if (feed === 'paxg' && !this.loaded.perp && this.source === 'binance' && nowMs - this.lastTickEmit >= 150) {
        this.lastTickEmit = nowMs;
        const basis = this.market.basis.paxg;
        const bq = this.market.brokerQuote;
        const half = bq && Number.isFinite(bq.spread) ? bq.spread / 2 : NaN;
        const price = Number.isFinite(basis) ? k.c - basis : NaN;
        this.emit({ type: 'tick', price, bid: price - half, ask: price + half, at: nowMs, source: 'paxg' });
      }
    }
    this.dirty = true;
  }

  connectBinance(feed) {
    new F.LiveSocket(F.wsUrl(feed, baseStreams()[feed]), {
      onMessage: (t) => this.onWs(feed, t),
      onStatus: (s) => this.setStatus(`ws_${feed}`, { state: s, ...(s === 'closed' ? { ok: false } : {}) }),
      onOpen: ({ reconnect }) => { if (reconnect && this.loaded[feed]) this.guard(`rest_${feed}`, () => this.loadKlines(feed)); },
    });
  }

  // ---------- polling ----------
  async pollScanner() {
    const json = await F.fetchJson(SCANNER_URL, { method: 'POST', body: JSON.stringify(F.scannerRequest(this.econTickers)) });
    const sc = F.parseScanner(json);
    if (!sc.gold || !Number.isFinite(sc.gold.close)) throw new Error('XAUUSD tidak ada di respons scanner');
    this.market.scanner = sc;
    this.anchorToBroker(sc);
    this.dirty = true;
  }

  async pollSentiment() {
    const base = 'https://fapi.binance.com';
    const [ls, prem, oi] = await Promise.all([
      F.fetchJson(`${base}/futures/data/globalLongShortAccountRatio?symbol=${F.PERP_SYMBOL}&period=5m&limit=1`),
      F.fetchJson(`${base}/fapi/v1/premiumIndex?symbol=${F.PERP_SYMBOL}`),
      F.fetchJson(`${base}/fapi/v1/openInterest?symbol=${F.PERP_SYMBOL}`),
    ]);
    const row = ls?.[0] || {};
    this.market.sentiment = {
      longShort: Number(row.longShortRatio),
      longPct: Number(row.longAccount),
      funding: Number(prem.lastFundingRate),
      nextFunding: Number(prem.nextFundingTime),
      openInterest: Number(oi.openInterest),
    };
    this.dirty = true;
  }

  async pollNews() {
    const json = await F.fetchJson(`${F.NEWS_URL}?t=${Math.floor(this.now() / 60_000)}`);
    if (!Array.isArray(json?.events)) throw new Error('news.json tidak valid');
    this.market.news = json;
    this.econTickers = [...new Set(json.events.filter((e) => e.ticker && e.importance >= 1).map((e) => e.ticker))].slice(0, 40);
    this.dirty = true;
  }

  async pollCot() {
    this.market.cot = F.parseCot(await F.fetchJson(F.COT_URL, { timeout: 20_000 }));
    this.dirty = true;
  }

  every(ms, key, fn) {
    const run = () => this.guard(key, fn);
    run();
    return setInterval(run, ms);
  }

  select(tfId) {
    if (TIMEFRAMES.some((t) => t.id === tfId)) {
      this.selected = tfId;
      this.dirty = true;
    }
  }

  snapshot() {
    const nowMs = this.now();
    this.source = chooseSource(this.store, this.loaded);
    const t0 = (globalThis.performance || Date).now();
    const out = this.source
      ? computeAll(this.store, this.market, nowMs, { source: this.source, aiCache: this.aiCache, maxTrain: 2, selected: this.selected })
      : { results: {}, summary: null, global: null };
    const computeMs = (globalThis.performance || Date).now() - t0;
    const sel = out.results[this.selected];
    const chart = chartPayload(sel);
    if (sel) {
      delete sel.ind;
      delete sel.series;
    }
    return {
      type: 'snapshot',
      at: nowMs,
      computeMs,
      source: this.source,
      broker: this.broker,
      brokerSymbol: BROKERS[this.broker],
      selected: this.selected,
      chart,
      ...out,
      market: {
        scanner: this.market.scanner,
        quotes: this.market.quotes,
        sentiment: this.market.sentiment,
        cotLatest: this.market.cot[0] || null,
        cotHistory: this.market.cot.slice(0, 52).map((r) => ({ date: r.date, net: r.net })),
        newsGeneratedAt: this.market.news.generatedAt || null,
        headlines: this.market.news.headlines || [],
        basis: this.market.basis,
        perp: this.lastPrice.perp,
        accuracy: this.market.accuracy,
        brokerQuote: this.market.brokerQuote || null,
      },
      tvMode: this.tvMode,
      aiModels: this.aiCache.size,
      status: this.status,
    };
  }

  async start() {
    this.startTv();
    // Binance: volume transaksi asli + cadangan harga. Dimuat paralel, tidak menahan TradingView.
    Promise.all([
      this.guard('rest_perp', () => this.loadKlines('perp')),
      this.guard('rest_paxg', () => this.loadKlines('paxg')),
    ]).then(() => {
      if (this.loaded.perp) this.connectBinance('perp');
      else if (!this.tvMode) this.guard('rest_paxg_intraday', () => this.enablePaxgFallback());
      if (this.loaded.paxg) this.connectBinance('paxg');
    });
    if (!this.tvMode) this.guard('rest_eur', () => this.loadEur());
    this.every(5_000, 'scanner', () => this.pollScanner());
    this.every(60_000, 'sentiment', () => this.pollSentiment());
    this.every(60_000, 'news', () => this.pollNews());
    this.every(6 * 3_600_000, 'cot', () => this.pollCot());
    // EURUSDT hanya diperlukan kalau DXY TradingView tidak tersedia (mode cadangan).
    setInterval(() => {
      if (this.source === 'binance') this.guard('rest_eur', () => this.loadEur());
      for (const feed of ['perp', 'paxg']) {
        if (this.loaded[feed]) continue;
        this.guard(`rest_${feed}`, async () => {
          await this.loadKlines(feed);
          this.connectBinance(feed);
        });
      }
    }, 60_000);
    const loop = () => {
      if (!this.dirty) return;
      this.dirty = false;
      try {
        this.emit(this.snapshot());
        this.setStatus('engine', { ok: true, at: this.now(), error: null });
      } catch (err) {
        this.setStatus('engine', { ok: false, error: err.message });
      }
    };
    setInterval(loop, 1_000);
  }
}
