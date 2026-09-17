// Perakit: dari data mentah (candle broker + DXY + Binance flow + scanner + news + sentimen)
// ke hasil lengkap per timeframe, termasuk prediksi AI. Tanpa DOM/jaringan → bisa diuji di Node.
import { TIMEFRAMES, DAY, aggregate, toSeries, alignedReturns, lastClosed, lastClosedYear } from './candles.js';
import { evaluate, computeIndicatorSet, computeVolumeSet } from './signals.js';
import { technicalScore, finalScore, topReasons, aggregate as aggregateTfs } from './score.js';
import { vwapAnchorFor } from './sessions.js';
import * as M from './macro.js';
import * as AI from './ai.js';
import { mergeLiveActual } from './news.js';

const fin = Number.isFinite;

// Candle harga utama. source 'tv' = broker TradingView (akurat), 'binance' = cadangan.
export function candlesFor(tf, store, source = 'tv') {
  if (source === 'tv') {
    const base = store?.gold?.[tf.res] || [];
    return tf.factor > 1 ? aggregate(base, tf.ms) : base;
  }
  const [, interval, factor] = tf.bn;
  const base = store?.[binanceFeedFor(tf, store)]?.[interval] || [];
  return factor > 1 ? aggregate(base, tf.ms) : base;
}

// Feed Binance yang benar-benar dipakai: XAUUSDT perp, atau PAXGUSDT spot bila perp tidak tersedia
// (IP dibatasi 418/429, atau Binance Futures diblokir di negara pengunjung).
export function binanceFeedFor(tf, store) {
  const [feed, interval] = tf.bn;
  if (feed === 'perp' && !store?.perp?.[interval]?.length && store?.paxg?.[interval]?.length) return 'paxg';
  return feed;
}

// Candle Binance untuk analisa volume transaksi asli (selalu dari jalur bn).
export const flowCandlesFor = (tf, store) => candlesFor(tf, store, 'binance');

// Candle pembanding untuk korelasi & fitur anti-DXY: DXY asli (sign −1) atau EURUSDT (sign +1).
export function fxFor(tf, store, source) {
  if (source === 'tv') {
    const base = store?.dxy?.[tf.res] || [];
    if (base.length) return { candles: tf.factor > 1 ? aggregate(base, tf.ms) : base, sign: -1, label: 'DXY' };
  }
  const [, interval, factor] = tf.bn;
  const base = store?.eur?.[interval] || [];
  return { candles: factor > 1 ? aggregate(base, tf.ms) : base, sign: 1, label: 'EURUSD' };
}

export function pivotSourceFor(tf, store, nowMs, source = 'tv') {
  const pick = (res, bnInterval) => (source === 'tv' ? store?.gold?.[res] : store?.paxg?.[bnInterval]) || [];
  if (tf.ms < DAY) return lastClosed(pick('1D', '1d'), nowMs);
  if (tf.id === '1D') return lastClosed(pick('1W', '1w'), nowMs);
  if (tf.id === '1W') return lastClosed(pick('1M', '1M'), nowMs);
  return lastClosedYear(pick('1M', '1M'), nowMs);
}

// Basis = harga Binance − harga broker. Hanya dipakai di mode cadangan.
export function updateBasis(prev, feedPrice, ref, alpha = 0.3) {
  if (!fin(feedPrice) || !fin(ref)) return prev;
  const b = feedPrice - ref;
  return fin(prev) ? alpha * b + (1 - alpha) * prev : b;
}

export function avgRating(ratings, keys) {
  const v = (keys || []).map((k) => ratings?.[k]).filter(fin);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

export function riskFactorFor(tf, factor) {
  if (tf.ms <= 3_600_000) return factor;
  if (tf.ms <= DAY) return Math.sqrt(factor);
  return 1;
}

// Perubahan % harian: dari quote realtime TradingView, jatuh ke scanner bila belum ada.
export function changePct(market, symbol, scannerKey) {
  const q = market.quotes?.[symbol];
  if (fin(q?.chp)) return q.chp;
  return market.scanner?.[scannerKey]?.change;
}

export function globalContext(market, nowMs) {
  const sc = market.scanner || {};
  const events = (market.news?.events || []).map((e) => mergeLiveActual(e, e.ticker ? sc.econ?.[e.ticker] : null, nowMs));
  return {
    events,
    macro: M.macroVote(events, nowMs),
    risk: M.newsRisk(events, nowMs),
    headlines: M.headlinesVote(market.news?.headlines || [], nowMs),
    cot: market.cot?.length ? M.cotVote(market.cot) : null,
    rates: M.ratesVote({
      us10yChg: changePct(market, 'TVC:US10Y', 'us10y'),
      us02yChg: changePct(market, 'TVC:US02Y', 'us02y'),
      vixChg: changePct(market, 'TVC:VIX', 'vix'),
    }),
    dxyChange: changePct(market, 'TVC:DXY', 'dxy'),
    longShort: M.retailContrarianVote(market.sentiment?.longShort),
    funding: M.fundingVote(market.sentiment?.funding),
    syntheticDxy: sc.fx ? M.syntheticDxy(sc.fx) : NaN,
  };
}

// Latih ulang model AI hanya bila ada bar baru yang tutup (atau belum ada model).
export function ensureModel(aiCache, key, rows, s, budget, nowMs = Date.now()) {
  const n = s.c.length;
  const closedT = s.t[n - 2];
  const cached = aiCache?.get(key);
  if (cached && cached.closedT === closedT) return cached.model;
  if (budget.left <= 0) return cached ? cached.model : null;
  budget.left--;
  const model = AI.trainModel(rows, s.c);
  aiCache?.set(key, { closedT, model, trainedAt: nowMs });
  return model;
}

export function computeTimeframe(tf, store, market, g, nowMs, { source = 'tv', aiCache, budget = { left: Infinity }, keepInd = false } = {}) {
  const candles = candlesFor(tf, store, source);
  if (candles.length < 30) return { tf, error: `data ${tf.id} belum cukup (${candles.length} bar)` };
  const s = toSeries(candles);
  const anchor = vwapAnchorFor(tf);
  const ind = computeIndicatorSet(s, { anchor });
  const flowCandles = flowCandlesFor(tf, store);
  let flow = null;
  if (flowCandles.length >= 60 && flowCandles.some((b) => b.v > 0)) {
    const fs = toSeries(flowCandles);
    flow = { series: fs, set: computeVolumeSet(fs), label: source === 'tv' ? 'volume asli Binance' : 'volume Binance' };
  }
  const ev = evaluate(s, {
    intraday: tf.ms < DAY,
    pivotSource: pivotSourceFor(tf, store, nowMs, source),
    tvRatings: market.scanner?.gold?.ratings,
    tvKeys: tf.tv,
    anchorLabel: anchor.label,
    flow,
  }, ind);
  const tech = technicalScore(ev.signals);

  const fx = { ...fxFor(tf, store, source), tolMs: tf.ms * 3 };
  const ret = alignedReturns(candles, fx.candles, 100, fx.tolMs);
  const rawCorr = ret.a.length >= 20 ? M.goldCorrelation(ret.a, ret.b) : NaN;
  const antiCorr = fin(rawCorr) ? fx.sign * rawCorr : NaN; // positif = emas bergerak berlawanan dengan dolar
  const dxyRating = avgRating(market.scanner?.dxy?.ratings, tf.tv);

  const fm = AI.featureMatrix(s, ind, fx, tf.ms < DAY);
  const model = ensureModel(aiCache, `${source}:${market.broker || ''}:${tf.id}`, fm.rows, s, budget, nowMs);
  const ai = model && !model.error ? AI.predict(model, fm.rows[s.c.length - 1], s.t) : null;

  const ctx = {
    ai: ai ? ai.vote : null,
    aiReliability: ai ? ai.reliability : 0,
    dxy: M.dxyVote(dxyRating, g.dxyChange, antiCorr),
    rates: g.rates,
    macro: g.macro.vote,
    sentiment: M.sentimentVote({ longShort: g.longShort, funding: g.funding, headlines: g.headlines.vote, cot: g.cot, useCot: tf.ms >= DAY }),
  };
  const final = finalScore(tech, ctx, riskFactorFor(tf, g.risk.factor));
  const basis = source === 'tv' ? 0 : market.basis?.[binanceFeedFor(tf, store)];
  const toRef = (x) => (fin(x) && fin(basis) ? x - basis : x);
  const result = {
    tf,
    bars: candles.length,
    source,
    basis: fin(basis) ? basis : 0,
    tech,
    final,
    ai: ai ? { ...ai, oos: model.oos, samples: model.samples, H: model.H, testN: model.testN, baseRate: model.baseRate } : null,
    aiError: model?.error || (model ? null : 'antre pelatihan'),
    ctx: { ...ctx, corr: antiCorr, fxLabel: fx.label, dxyRating },
    signals: ev.signals,
    reasons: topReasons(ev.signals),
    meta: { ...ev.meta, anchor: anchor.label, flow: flow ? flow.label : 'tick volume broker' },
    levels: Object.fromEntries(Object.entries(ev.levels).map(([k, v]) => [k, k === 'atr' ? v : toRef(v)])),
  };
  if (keepInd) {
    result.ind = ind;
    result.series = s;
  }
  return result;
}

export function computeAll(store, market, nowMs, { source = 'tv', aiCache, maxTrain = 3, selected, timeframes = TIMEFRAMES } = {}) {
  const g = globalContext(market, nowMs);
  const results = {};
  const budget = { left: maxTrain };
  // Timeframe terpilih dilatih lebih dulu supaya panel AI-nya cepat terisi.
  const ordered = [...timeframes].sort((a, b) => (a.id === selected ? -1 : b.id === selected ? 1 : 0));
  for (const tf of ordered) {
    try {
      results[tf.id] = computeTimeframe(tf, store, market, g, nowMs, { source, aiCache, budget, keepInd: tf.id === selected });
    } catch (err) {
      results[tf.id] = { tf, error: `${tf.id}: ${err.message}` };
    }
  }
  return { results, summary: aggregateTfs(results, timeframes), global: g };
}

// Candle + garis overlay untuk chart timeframe terpilih (n bar terakhir), dalam harga broker.
export function chartPayload(result, n = 140) {
  if (!result?.ind || !result.series) return null;
  const s = result.series;
  const ind = result.ind;
  const basis = result.basis || 0;
  const from = Math.max(0, s.c.length - n);
  const cut = (arr) => arr.slice(from).map((v) => (fin(v) ? v - basis : null));
  return {
    bars: s.t.slice(from).map((t, k) => {
      const i = from + k;
      return { t, o: s.o[i] - basis, h: s.h[i] - basis, l: s.l[i] - basis, c: s.c[i] - basis, v: s.v[i] };
    }),
    lines: {
      hma9: cut(ind.hma9),
      hma21: cut(ind.hma21),
      sma20: cut(ind.sma20),
      sma50: cut(ind.sma50),
      sma200: cut(ind.sma200),
      vwap: cut(ind.vwap.vwap),
      vwapUp: cut(ind.vwap.upper1),
      vwapDn: cut(ind.vwap.lower1),
      supertrend: cut(ind.st.line),
    },
    profile: ind.profile ? { poc: ind.profile.poc - basis, vah: ind.profile.vah - basis, val: ind.profile.val - basis } : null,
  };
}
