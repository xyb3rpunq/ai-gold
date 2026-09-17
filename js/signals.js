// Mengubah indikator + pola menjadi "suara" terstandar: vote di [-1, +1] (negatif = bear),
// bobot, kategori, dan alasan yang bisa dibaca. vote `null` = sinyal tidak berlaku (dikeluarkan).
import * as I from './indicators.js';
import * as P from './patterns.js';

const fin = Number.isFinite;
const sgn = (x) => (x > 0 ? 1 : x < 0 ? -1 : 0);
const f2 = (x) => (fin(x) ? x.toFixed(2) : '–');

export const CATEGORIES = {
  trend: { label: 'Trend', weight: 0.27 },
  momentum: { label: 'Momentum', weight: 0.18 },
  volume: { label: 'Volume', weight: 0.17 },
  structure: { label: 'Struktur', weight: 0.13 },
  pattern: { label: 'Pola', weight: 0.1 },
  consensus: { label: 'Konsensus TV', weight: 0.15 },
};

function sig(id, name, cat, weight, vote, detail) {
  return { id, name, cat, weight, vote: vote === null || vote === undefined || !fin(vote) ? null : I.clamp(vote), detail };
}

// Suara zona osilator: netral di tengah, jenuh = ±1.
export function oscVote(value, mid, span) {
  return fin(value) ? I.clamp((value - mid) / span) : null;
}

// Kemiringan ternormalisasi (-1..1) dari seri kumulatif seperti OBV/ADL/CVD.
export function normSlope(arr, n = 20) {
  const slope = I.linregSlope(arr, n);
  const sd = I.stdev(arr, n);
  return slope.map((v, i) => (sd[i] > 0 ? Math.tanh((v * n) / (2 * sd[i])) : fin(v) ? 0 : NaN));
}

// Nilai terakhir dibagi simpangan bakunya (untuk osilator tak berskala seperti Force Index).
export function zLast(arr, n = 50) {
  const sd = I.last(I.stdev(arr.map((v) => (fin(v) ? v : 0)), n));
  const v = I.last(arr);
  return sd > 0 && fin(v) ? v / sd : null;
}

// Rating TradingView (-1..1) rata-rata atas timeframe scanner yang dipetakan.
export function tvConsensus(tvRatings, tvKeys) {
  if (!tvRatings) return null;
  const vals = (tvKeys || []).map((k) => tvRatings[k]).filter(fin);
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

export function tvLabel(r) {
  if (!fin(r)) return 'n/a';
  if (r >= 0.5) return 'Strong Buy';
  if (r >= 0.1) return 'Buy';
  if (r > -0.1) return 'Neutral';
  if (r > -0.5) return 'Sell';
  return 'Strong Sell';
}

// Indikator volume untuk satu seri (broker tick volume atau Binance volume asli).
export function computeVolumeSet(s) {
  const obvArr = I.obv(s.c, s.v);
  const adlArr = I.adl(s.h, s.l, s.c, s.v);
  const cvdArr = I.cvd(s.o, s.h, s.l, s.c, s.v, s.tb);
  const vi = I.volumeIndexes(s.c, s.v);
  return {
    obv: obvArr,
    obvNorm: normSlope(obvArr),
    adl: adlArr,
    adlNorm: normSlope(adlArr),
    chaikin: I.chaikinOsc(s.h, s.l, s.c, s.v),
    cmf: I.cmf(s.h, s.l, s.c, s.v, 20),
    twiggs: I.twiggsMoneyFlow(s.h, s.l, s.c, s.v, 21),
    mfi: I.mfi(s.h, s.l, s.c, s.v, 14),
    pvtNorm: normSlope(I.pvt(s.c, s.v)),
    force: I.forceIndex(s.c, s.v, 13),
    eom: I.easeOfMovement(s.h, s.l, s.v, 14),
    klinger: I.klinger(s.h, s.l, s.c, s.v),
    nvi: vi.nvi,
    pvi: vi.pvi,
    nviEma: I.ema(vi.nvi, 100),
    pviEma: I.ema(vi.pvi, 100),
    volOsc: I.volumeOsc(s.v),
    rvol: I.relativeVolume(s.v, 20),
    cvd: cvdArr,
    cvdExact: cvdArr.exact,
    cvdNorm: normSlope(cvdArr),
    taker: I.sma(s.tb.map((x, i) => (fin(x) && s.v[i] ? x / s.v[i] : NaN)), 10),
  };
}

// Semua indikator dihitung sekali per timeframe, dipakai bersama oleh sinyal aturan dan fitur AI.
export function computeIndicatorSet(s, { anchor } = {}) {
  return {
    atr: I.atr(s.h, s.l, s.c, 14),
    ema9: I.ema(s.c, 9),
    ema21: I.ema(s.c, 21),
    ema50: I.ema(s.c, 50),
    ema200: I.ema(s.c, 200),
    sma20: I.sma(s.c, 20),
    sma50: I.sma(s.c, 50),
    sma200: I.sma(s.c, 200),
    hma9: I.hma(s.c, 9),
    hma21: I.hma(s.c, 21),
    vwma: I.vwma(s.c, s.v, 20),
    vwap: I.vwap(s.t, s.h, s.l, s.c, s.v, anchor?.key),
    profile: I.volumeProfile(s.h, s.l, s.c, s.v, 120, 40),
    ich: I.ichimoku(s.h, s.l),
    st: I.supertrend(s.h, s.l, s.c, 10, 3),
    ps: I.psar(s.h, s.l),
    dmi: I.dmi(s.h, s.l, s.c, 14, 14),
    aroon: I.aroon(s.h, s.l, 25),
    slope: I.linregSlope(s.c, 20),
    dc: I.donchian(s.h, s.l, 20),
    ha: I.heikinAshi(s.o, s.h, s.l, s.c),
    rsi: I.rsi(s.c, 14),
    macd: I.macd(s.c),
    stoch: I.stoch(s.h, s.l, s.c, 14, 3, 3),
    stochRsi: I.stochRsi(s.c),
    cci: I.cci(s.h, s.l, s.c, 20),
    willr: I.williamsR(s.h, s.l, s.c, 14),
    mom: I.momentum(s.c, 10),
    roc: I.roc(s.c, 10),
    ao: I.awesome(s.h, s.l),
    uo: I.ultimate(s.h, s.l, s.c),
    bb: I.bollinger(s.c, 20, 2),
    kc: I.keltner(s.h, s.l, s.c, 20, 2),
    vol: computeVolumeSet(s),
  };
}

function volumeSignals(out, vs, label, s, atr) {
  const L = I.last;
  const tag = ` · ${label}`;
  out.push(sig('obv', 'OBV', 'volume', 0.8, L(vs.obvNorm), `slope ${f2(L(vs.obvNorm))}${tag}`));
  out.push(sig('adl', 'Accumulation/Distribution', 'volume', 0.7, L(vs.adlNorm), `slope ${f2(L(vs.adlNorm))}${tag}`));
  const ch = vs.chaikin;
  out.push(sig('chaikin', 'Chaikin Oscillator', 'volume', 0.6,
    fin(L(ch)) && fin(L(ch, 1)) ? 0.6 * sgn(L(ch)) + 0.4 * sgn(L(ch) - L(ch, 1)) : null, `${f2(zLast(ch))}σ${tag}`));
  out.push(sig('cmf', 'Chaikin Money Flow(20)', 'volume', 0.7, fin(L(vs.cmf)) ? L(vs.cmf) / 0.2 : null, `${f2(L(vs.cmf))}${tag}`));
  out.push(sig('twiggs', 'Twiggs Money Flow(21)', 'volume', 0.6, fin(L(vs.twiggs)) ? L(vs.twiggs) / 0.2 : null, `${f2(L(vs.twiggs))}${tag}`));
  out.push(sig('mfi', 'Money Flow Index(14)', 'volume', 0.7, oscVote(L(vs.mfi), 50, 30), `${f2(L(vs.mfi))}${tag}`));
  out.push(sig('pvt', 'Volume Price Trend', 'volume', 0.5, L(vs.pvtNorm), `slope ${f2(L(vs.pvtNorm))}${tag}`));
  const fz = zLast(vs.force);
  out.push(sig('force', 'Elder Force Index(13)', 'volume', 0.6, fin(fz) ? Math.tanh(fz / 1.5) : null, `${f2(fz)}σ${tag}`));
  const ez = zLast(vs.eom);
  out.push(sig('eom', 'Ease of Movement(14)', 'volume', 0.5, fin(ez) ? Math.tanh(ez / 1.5) : null, `${f2(ez)}σ${tag}`));
  const kv = L(vs.klinger.kvo);
  const ks = L(vs.klinger.signal);
  out.push(sig('klinger', 'Klinger Oscillator', 'volume', 0.6, fin(kv) && fin(ks) ? 0.5 * sgn(kv - ks) + 0.5 * sgn(kv) : null,
    `KVO ${kv > ks ? '>' : '<'} sinyal${tag}`));
  const nv = L(vs.nviEma);
  const pv = L(vs.pviEma);
  out.push(sig('nvi_pvi', 'NVI / PVI (smart vs crowd)', 'volume', 0.5,
    fin(nv) && fin(pv) ? 0.6 * sgn(L(vs.nvi) - nv) + 0.4 * sgn(L(vs.pvi) - pv) : null,
    `NVI ${L(vs.nvi) > nv ? 'di atas' : 'di bawah'} EMA100 · PVI ${L(vs.pvi) > pv ? 'di atas' : 'di bawah'}${tag}`));
  const vo = L(vs.volOsc);
  const n = s.c.length;
  const dir5 = n > 6 ? sgn(s.c[n - 1] - s.c[n - 6]) : 0;
  out.push(sig('volosc', 'Volume Oscillator(5,10)', 'volume', 0.5, fin(vo) ? (vo > 0 ? dir5 * Math.min(1, vo / 25) : 0) : null,
    `${f2(vo)}% · volume ${vo > 0 ? 'naik' : 'turun'} saat harga ${dir5 > 0 ? 'naik' : dir5 < 0 ? 'turun' : 'datar'}${tag}`));
  const rv = s.v.length > 2 ? vs.rvol[s.v.length - 2] : NaN;
  const lastDir = n > 2 ? sgn(s.c[n - 2] - s.o[n - 2]) : 0;
  out.push(sig('rvol', 'Relative Volume (bar tutup)', 'volume', 0.6, fin(rv) && rv >= 1.2 ? lastDir * Math.min(1, (rv - 1) / 1.5) : null,
    `RVOL ${f2(rv)}×${tag}`));
  out.push(sig('cvd', vs.cvdExact ? 'CVD (taker delta asli)' : 'CVD (estimasi)', 'volume', vs.cvdExact ? 1 : 0.6, L(vs.cvdNorm),
    `slope ${f2(L(vs.cvdNorm))}${tag}`));
  const tbr = L(vs.taker);
  if (fin(tbr)) out.push(sig('taker', 'Taker buy ratio(10)', 'volume', 0.8, (tbr - 0.5) / 0.08, `${f2(tbr * 100)}% agresor beli${tag}`));
  return atr;
}

/**
 * @param {object} s  seri broker dari toSeries(): t,o,h,l,c,v,tb (bar terakhir = bar live)
 * @param {object} opt { intraday, pivotSource, tvRatings, tvKeys, anchorLabel, flow:{series, label}|null }
 * @param {object} [ind] hasil computeIndicatorSet(s)
 */
export function evaluate(s, opt = {}, ind = computeIndicatorSet(s)) {
  const n = s.c.length;
  const out = [];
  if (n < 30) return { signals: out, levels: {}, meta: { bars: n } };
  const L = I.last;
  const c = L(s.c);
  const atr = L(ind.atr);

  // ---------- TREND ----------
  const e9 = L(ind.ema9);
  const e21 = L(ind.ema21);
  const e50 = L(ind.ema50);
  const e200 = L(ind.ema200);
  const pairs = [[c, e21], [e9, e21], [e21, e50], [e50, e200]].filter(([a, b]) => fin(a) && fin(b));
  out.push(sig('ema_stack', 'EMA stack 9/21/50/200', 'trend', 1.3,
    pairs.length ? pairs.reduce((a, [x, y]) => a + sgn(x - y), 0) / pairs.length : null,
    `EMA9 ${f2(e9)} · EMA21 ${f2(e21)} · EMA50 ${f2(e50)} · EMA200 ${f2(e200)}`));
  out.push(sig('ema200', 'Harga vs EMA200', 'trend', 0.8, fin(e200) ? (c - e200) / (2 * atr) : null,
    fin(e200) ? `jarak ${f2(c - e200)} (${f2((c - e200) / atr)} ATR)` : 'bar < 200'));

  const s20 = L(ind.sma20);
  const s50 = L(ind.sma50);
  const s200 = L(ind.sma200);
  const smaPairs = [[c, s20], [s20, s50], [s50, s200]].filter(([a, b]) => fin(a) && fin(b));
  out.push(sig('sma_stack', 'SMA 20/50/200', 'trend', 1.2,
    smaPairs.length ? smaPairs.reduce((a, [x, y]) => a + sgn(x - y), 0) / smaPairs.length : null,
    `SMA20 ${f2(s20)} · SMA50 ${f2(s50)} · SMA200 ${f2(s200)}`));
  let cross = null;
  let crossAgo = null;
  for (let k = 1; k <= 30 && n - 1 - k >= 0; k++) {
    const i = n - k;
    const a0 = ind.sma50[i - 1] - ind.sma200[i - 1];
    const a1 = ind.sma50[i] - ind.sma200[i];
    if (fin(a0) && fin(a1) && sgn(a0) !== sgn(a1) && a1 !== 0) { cross = sgn(a1); crossAgo = k - 1; break; }
  }
  out.push(sig('sma_cross', 'Golden / Death cross SMA50×200', 'trend', 1, cross,
    cross ? `${cross > 0 ? 'Golden cross' : 'Death cross'} ${crossAgo} bar lalu` : 'tidak ada cross 30 bar terakhir'));

  const h9 = ind.hma9;
  const h21 = ind.hma21;
  const hullParts = [
    fin(L(h9, 1)) ? sgn(L(h9) - L(h9, 1)) : null,
    fin(L(h21, 1)) ? sgn(L(h21) - L(h21, 1)) : null,
    fin(L(h21)) ? sgn(c - L(h21)) : null,
  ].filter((x) => x !== null);
  out.push(sig('hull', 'Hull MA 9 & 21', 'trend', 1.3, hullParts.length ? hullParts.reduce((a, b) => a + b, 0) / hullParts.length : null,
    `HMA9 ${f2(L(h9))} ${L(h9) > L(h9, 1) ? '▲' : '▼'} · HMA21 ${f2(L(h21))} ${L(h21) > L(h21, 1) ? '▲' : '▼'}`));
  let turn = null;
  if (n > 5 && [1, 2, 3, 4].every((k) => fin(h9[n - 1 - k]))) {
    const now = sgn(h9[n - 2] - h9[n - 3]);
    const before = sgn(h9[n - 4] - h9[n - 5]);
    if (now && before && now !== before) turn = now;
  }
  out.push(sig('hull_turn', 'Hull MA 9 berbalik arah', 'trend', 0.7, turn,
    turn ? `baru berbalik ${turn > 0 ? 'naik (hijau)' : 'turun (merah)'}` : 'tidak ada pembalikan baru'));

  const ich = ind.ich;
  const ca = L(ich.cloudA);
  const cb = L(ich.cloudB);
  if (fin(ca) && fin(cb)) {
    const top = Math.max(ca, cb);
    const bot = Math.min(ca, cb);
    const cloudPos = c > top ? 1 : c < bot ? -1 : 0;
    const tk = sgn(L(ich.tenkan) - L(ich.kijun));
    const chikou = n > ich.lag ? sgn(c - s.c[n - 1 - ich.lag]) : 0;
    const future = sgn(L(ich.leadA) - L(ich.leadB));
    out.push(sig('ichimoku', 'Ichimoku Kinko Hyo', 'trend', 1.1, (cloudPos * 2 + tk + chikou + future) / 5,
      `${cloudPos > 0 ? 'di atas' : cloudPos < 0 ? 'di bawah' : 'di dalam'} awan · tenkan${tk > 0 ? '>' : '<'}kijun`));
  } else out.push(sig('ichimoku', 'Ichimoku Kinko Hyo', 'trend', 1.1, null, 'bar kurang'));

  out.push(sig('supertrend', 'SuperTrend(10,3)', 'trend', 1.1, fin(L(ind.st.dir)) ? L(ind.st.dir) : null, `garis ${f2(L(ind.st.line))}`));
  out.push(sig('psar', 'Parabolic SAR', 'trend', 0.5, fin(L(ind.ps.dir)) ? L(ind.ps.dir) : null, `SAR ${f2(L(ind.ps.sar))}`));
  const adx = L(ind.dmi.adx);
  out.push(sig('adx', 'ADX / DMI(14)', 'trend', 0.9,
    fin(adx) ? (adx < 20 ? 0 : sgn(L(ind.dmi.plus) - L(ind.dmi.minus)) * Math.min(1, adx / 40)) : null,
    `ADX ${f2(adx)} · +DI ${f2(L(ind.dmi.plus))} · −DI ${f2(L(ind.dmi.minus))}${fin(adx) && adx < 20 ? ' (tanpa trend)' : ''}`));
  out.push(sig('aroon', 'Aroon(25)', 'trend', 0.5, fin(L(ind.aroon.up)) ? (L(ind.aroon.up) - L(ind.aroon.down)) / 100 : null,
    `up ${f2(L(ind.aroon.up))} · down ${f2(L(ind.aroon.down))}`));
  const slope = L(ind.slope);
  out.push(sig('linreg', 'Regresi linear(20)', 'trend', 0.7, fin(slope) ? Math.tanh((slope * 20) / (2 * atr)) : null,
    `slope ${f2(slope)}/bar`));
  const half = (L(ind.dc.upper) - L(ind.dc.lower)) / 2;
  out.push(sig('donchian', 'Posisi Donchian(20)', 'trend', 0.4, half > 0 ? (c - L(ind.dc.mid)) / half : null,
    `${f2(L(ind.dc.lower))} – ${f2(L(ind.dc.upper))}`));
  const haVotes = [1, 2, 3].map((k) => sgn(ind.ha.close[n - k] - ind.ha.open[n - k]));
  out.push(sig('heikin', 'Heikin Ashi 3 bar', 'trend', 0.5, haVotes.reduce((a, b) => a + b, 0) / 3,
    haVotes.map((v) => (v > 0 ? '▲' : v < 0 ? '▼' : '•')).reverse().join('')));

  // ---------- MOMENTUM ----------
  const r = L(ind.rsi);
  out.push(sig('rsi', 'RSI(14)', 'momentum', 1.2, oscVote(r, 50, 20),
    `${f2(r)}${r >= 70 ? ' jenuh beli' : r <= 30 ? ' jenuh jual' : ''}`));
  const mh = L(ind.macd.hist);
  out.push(sig('macd', 'MACD(12,26,9)', 'momentum', 1.2,
    fin(mh) && fin(L(ind.macd.hist, 1)) ? 0.5 * sgn(mh) + 0.25 * sgn(L(ind.macd.line)) + 0.25 * sgn(mh - L(ind.macd.hist, 1)) : null,
    `line ${f2(L(ind.macd.line))} · signal ${f2(L(ind.macd.signal))} · hist ${f2(mh)}`));
  const k = L(ind.stoch.k);
  const d = L(ind.stoch.d);
  let stochVote = null;
  if (fin(k) && fin(d)) {
    if (k > 80 && k < d) stochVote = -1;
    else if (k < 20 && k > d) stochVote = 1;
    else stochVote = 0.5 * sgn(k - d) + 0.5 * I.clamp((k - 50) / 50);
  }
  out.push(sig('stoch', 'Stochastic(14,3,3)', 'momentum', 0.8, stochVote, `%K ${f2(k)} · %D ${f2(d)}`));
  const sk = L(ind.stochRsi.k);
  const sd = L(ind.stochRsi.d);
  out.push(sig('stochrsi', 'Stoch RSI', 'momentum', 0.6,
    fin(sk) && fin(sd) ? 0.5 * sgn(sk - sd) + 0.5 * I.clamp((sk - 50) / 50) : null, `K ${f2(sk)} · D ${f2(sd)}`));
  const cc = L(ind.cci);
  out.push(sig('cci', 'CCI(20)', 'momentum', 0.8, fin(cc) ? cc / 150 : null, f2(cc)));
  const wr = L(ind.willr);
  out.push(sig('willr', 'Williams %R(14)', 'momentum', 0.6, oscVote(wr, -50, 30), f2(wr)));
  const mom = L(ind.mom);
  out.push(sig('mom', 'Momentum/ROC(10)', 'momentum', 0.6, fin(mom) ? Math.tanh(mom / (2 * atr)) : null,
    `${f2(mom)} poin · ROC ${f2(L(ind.roc))}%`));
  out.push(sig('ao', 'Awesome Oscillator', 'momentum', 0.6,
    fin(L(ind.ao)) && fin(L(ind.ao, 1)) ? 0.5 * sgn(L(ind.ao)) + 0.5 * sgn(L(ind.ao) - L(ind.ao, 1)) : null, f2(L(ind.ao))));
  const uo = L(ind.uo);
  out.push(sig('uo', 'Ultimate Oscillator', 'momentum', 0.6, oscVote(uo, 50, 20), f2(uo)));

  // ---------- VOLUME ----------
  const vw = ind.vwap;
  const vwNow = L(vw.vwap);
  const vsd = L(vw.sd);
  if (fin(vwNow)) {
    const z = vsd > 0 ? (c - vwNow) / vsd : Math.sign(c - vwNow);
    out.push(sig('vwap', `VWAP ${opt.anchorLabel || 'sesi'} + band`, 'volume', 1.3, z / 1.5,
      `VWAP ${f2(vwNow)} · ${f2(z)}σ · band ±1σ ${f2(L(vw.lower1))}–${f2(L(vw.upper1))}`));
    const back = Math.min(5, n - 1);
    out.push(sig('vwap_slope', 'Arah VWAP', 'volume', 0.6, fin(vw.vwap[n - 1 - back]) ? Math.tanh((vwNow - vw.vwap[n - 1 - back]) / (0.5 * atr)) : null,
      `${f2(vwNow - vw.vwap[n - 1 - back])} dalam ${back} bar`));
  }
  const vwm = L(ind.vwma);
  out.push(sig('vwma', 'Harga vs VWMA(20)', 'volume', 0.5, fin(vwm) ? (c - vwm) / atr : null, `VWMA ${f2(vwm)}`));
  const pf = ind.profile;
  if (pf) {
    const v = c > pf.vah ? 1 : c > pf.poc ? 0.5 : c < pf.val ? -1 : c < pf.poc ? -0.5 : 0;
    out.push(sig('vprofile', 'Volume Profile 120 bar', 'volume', 0.9, v, `POC ${f2(pf.poc)} · VAH ${f2(pf.vah)} · VAL ${f2(pf.val)}`));
  }
  const hasVol = s.v.slice(-20).some((x) => x > 0);
  if (opt.flow?.set) volumeSignals(out, opt.flow.set, opt.flow.label, opt.flow.series, atr);
  else if (hasVol) volumeSignals(out, ind.vol, 'tick volume broker', s, atr);

  // ---------- STRUKTUR (bar tertutup saja) ----------
  const closedIdx = n - 2;
  const sw = P.swings(s.h, s.l, 3, 3, closedIdx);
  const ms = P.marketStructure(sw);
  out.push(sig('structure', 'Struktur pasar (Dow)', 'structure', 1.5, sw.highs.length >= 2 && sw.lows.length >= 2 ? ms.trend : null, ms.label));
  const bos = P.breakOfStructure(c, sw);
  out.push(sig('bos', 'Break of structure', 'structure', 1, sw.highs.length && sw.lows.length ? bos.dir : null,
    bos.dir ? `tembus ${f2(bos.level)}` : 'di dalam range swing'));
  if (opt.pivotSource) {
    const pv = P.pivotPoints(opt.pivotSource.h, opt.pivotSource.l, opt.pivotSource.c).classic;
    const v = c > pv.r1 ? 1 : c > pv.p ? 0.5 : c < pv.s1 ? -1 : c < pv.p ? -0.5 : 0;
    out.push(sig('pivot', 'Pivot point klasik', 'structure', 0.8, v, `P ${f2(pv.p)} · R1 ${f2(pv.r1)} · S1 ${f2(pv.s1)}`));
  }
  const pb = L(ind.bb.percentB);
  out.push(sig('bollinger', 'Bollinger %B(20,2)', 'structure', 0.5, fin(pb) ? (pb - 0.5) * 2 : null,
    `%B ${f2(pb)} · lebar ${f2(L(ind.bb.width) * 100)}%`));
  const squeeze = L(ind.bb.upper) < L(ind.kc.upper) && L(ind.bb.lower) > L(ind.kc.lower);
  const fib = P.fibPosition(sw, c);
  let fibVote = null;
  if (fib) {
    if (fib.legUp) fibVote = fib.retr < 0.382 ? 0.5 : fib.retr <= 0.618 ? 0 : -0.7;
    else fibVote = fib.retr < 0.382 ? -0.5 : fib.retr <= 0.618 ? 0 : 0.7;
  }
  out.push(sig('fib', 'Retracement Fibonacci', 'structure', 0.6, fibVote,
    fib ? `${fib.legUp ? 'koreksi dari kaki naik' : 'pantulan dari kaki turun'} ${f2(fib.retr * 100)}%` : 'swing kurang'));

  // ---------- POLA ----------
  const trendCtx = n > 11 ? sgn(ind.ema21[n - 4] - ind.ema21[n - 11]) : 0;
  const found = P.candlePatterns(s.o, s.h, s.l, s.c, closedIdx, ind.atr[closedIdx], trendCtx)
    .concat(P.candlePatterns(s.o, s.h, s.l, s.c, closedIdx - 1, ind.atr[closedIdx - 1], trendCtx)
      .map((p) => ({ ...p, strength: p.strength * 0.5, name: `${p.name} (bar-2)` })));
  const directional = found.filter((p) => p.dir !== 0);
  out.push(sig('candles', 'Pola candlestick', 'pattern', 1,
    directional.length ? directional.reduce((a, p) => a + p.dir * p.strength, 0) : null,
    found.length ? found.map((p) => p.name).join(', ') : 'tidak ada pola'));
  const div = P.divergence(sw, ind.rsi).filter((x) => closedIdx - x.at <= 12);
  out.push(sig('divergence', 'Divergensi RSI', 'pattern', 1, div.length ? div.reduce((a, x) => a + x.dir, 0) : null,
    div.length ? div.map((x) => x.name).join(', ') : 'tidak ada'));
  const dbl = P.doublePattern(sw, s.l, s.h, c, atr);
  out.push(sig('double', 'Double top/bottom', 'pattern', 1, dbl ? dbl.dir : null,
    dbl ? `${dbl.name} @ ${f2(dbl.neckline)}` : 'tidak ada'));

  // ---------- KONSENSUS ----------
  const tv = tvConsensus(opt.tvRatings, opt.tvKeys);
  out.push(sig('tradingview', 'Rating teknikal TradingView', 'consensus', 2, tv, `${tvLabel(tv)} (${f2(tv)})`));

  const lv = P.nearestLevels(sw, c);
  return {
    signals: out,
    levels: {
      price: c, atr, support: lv.support, resistance: lv.resistance, supertrend: L(ind.st.line), ema200: e200,
      vwap: vwNow, poc: pf?.poc ?? NaN,
    },
    meta: { bars: n, rsi: r, adx, squeeze, patterns: found.map((p) => p.name) },
  };
}
