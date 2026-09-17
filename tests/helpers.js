// Data sintetis deterministik untuk tes.
export function rng(seed = 42) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function gauss(rand) {
  const u = Math.max(rand(), 1e-12);
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * Candle acak. drift = kecenderungan per bar, phi = autokorelasi return (0 = random walk).
 */
export function makeCandles(n, { seed = 1, start = 4000, drift = 0, vol = 2, phi = 0, stepMs = 60_000, t0 = Date.UTC(2026, 0, 5, 0, 0), withTaker = true } = {}) {
  const rand = rng(seed);
  const out = [];
  let price = start;
  let prevRet = 0;
  for (let i = 0; i < n; i++) {
    const ret = drift + phi * prevRet + vol * gauss(rand);
    prevRet = ret;
    const o = price;
    const c = Math.max(1, price + ret);
    const h = Math.max(o, c) + Math.abs(gauss(rand)) * vol * 0.5;
    const l = Math.min(o, c) - Math.abs(gauss(rand)) * vol * 0.5;
    const v = 100 + Math.floor(rand() * 900);
    const tb = withTaker ? v * (c > o ? 0.6 : 0.4) : NaN;
    out.push({ t: t0 + i * stepMs, o, h, l, c, v, tb, closeT: t0 + (i + 1) * stepMs - 1 });
    price = c;
  }
  return out;
}

export function series(candles) {
  return {
    t: candles.map((c) => c.t),
    o: candles.map((c) => c.o),
    h: candles.map((c) => c.h),
    l: candles.map((c) => c.l),
    c: candles.map((c) => c.c),
    v: candles.map((c) => c.v),
    tb: candles.map((c) => c.tb),
  };
}

export const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
