// Feed WebSocket TradingView (tanpa login): candle & tick broker yang sama dengan chart TradingView
// (PEPPERSTONE:XAUUSD / OANDA:XAUUSD), plus DXY dan yield. Fungsi protokol murni di atas, kelas di bawah.

export const TV_WS_URL = 'wss://data.tradingview.com/socket.io/websocket?type=chart';
export const BROKERS = {
  PEPPERSTONE: 'PEPPERSTONE:XAUUSD',
  OANDA: 'OANDA:XAUUSD',
};
export const QUOTE_FIELDS = ['lp', 'bid', 'ask', 'ch', 'chp', 'lp_time', 'high_price', 'low_price', 'open_price', 'prev_close_price'];

export function encodeFrame(m, p) {
  const s = JSON.stringify({ m, p });
  return `~m~${s.length}~m~${s}`;
}

// Satu pesan WebSocket bisa berisi beberapa frame "~m~<panjang>~m~<isi>".
export function decodeFrames(data) {
  const out = [];
  let i = 0;
  const text = String(data);
  while (i < text.length) {
    if (!text.startsWith('~m~', i)) break;
    const j = text.indexOf('~m~', i + 3);
    if (j < 0) break;
    const len = Number(text.slice(i + 3, j));
    if (!Number.isFinite(len)) break;
    out.push(text.substr(j + 3, len));
    i = j + 3 + len;
  }
  return out;
}

const DAY = 86_400_000;

// Akhir periode sebuah bar (ms), dipakai untuk menentukan bar mana yang sudah tutup.
export function barEnd(tMs, res) {
  if (res === '1M') {
    const d = new Date(tMs);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours()) - 1;
  }
  if (res === '1W') return tMs + 7 * DAY - 1;
  if (res === '1D') return tMs + DAY - 1;
  return tMs + Number(res) * 60_000 - 1;
}

// Bar series TradingView: { i, v: [detik, o, h, l, c, volume] }
export function parseBars(list, res) {
  const out = [];
  for (const b of list || []) {
    const v = b?.v;
    if (!Array.isArray(v) || v.length < 5) continue;
    const t = v[0] * 1000;
    const bar = { t, o: +v[1], h: +v[2], l: +v[3], c: +v[4], v: Number.isFinite(+v[5]) ? +v[5] : 0, tb: NaN, closeT: barEnd(t, res) };
    if ([bar.o, bar.h, bar.l, bar.c].every(Number.isFinite) && bar.h >= bar.l) out.push(bar);
  }
  return out.sort((a, b) => a.t - b.t);
}

// Gabungkan bar baru ke array yang ada (timpa timestamp sama, tambah yang lebih baru).
export function mergeBars(existing, incoming, maxLen = 2000) {
  if (!existing.length) return incoming.slice(-maxLen);
  const map = new Map(existing.map((b) => [b.t, b]));
  for (const b of incoming) map.set(b.t, b);
  return [...map.values()].sort((a, b) => a.t - b.t).slice(-maxLen);
}

/**
 * Menangani satu payload JSON dan mengembalikan event terstruktur (atau null).
 * { kind:'bars', session, bars, full } | { kind:'quote', symbol, values } | { kind:'error', session, message }
 */
export function interpret(payload, sessionRes) {
  let j;
  try {
    j = JSON.parse(payload);
  } catch {
    return null;
  }
  const m = j?.m;
  if (m === 'timescale_update' || m === 'du') {
    const session = j.p?.[0];
    const s = j.p?.[1]?.s1?.s;
    if (!session || !Array.isArray(s)) return null;
    return { kind: 'bars', session, bars: parseBars(s, sessionRes[session]), full: m === 'timescale_update' };
  }
  if (m === 'qsd') {
    const d = j.p?.[1];
    if (!d?.n || d.s !== 'ok') return null;
    return { kind: 'quote', symbol: d.n, values: d.v || {} };
  }
  if (/error/i.test(m || '')) return { kind: 'error', session: j.p?.[0], message: `${m}: ${JSON.stringify(j.p?.slice(1) || []).slice(0, 120)}` };
  return null;
}

// ---------------- browser ----------------

export class TvFeed {
  /**
   * @param {object} o
   * @param {{key:string, symbol:string, res:string, count:number}[]} o.series
   * @param {string[]} o.quotes
   */
  constructor({ series, quotes, onBars, onQuote, onStatus, silenceMs = 30_000, socket = (url) => new WebSocket(url), maxFailures = Infinity }) {
    Object.assign(this, { series, quotes, onBars, onQuote, onStatus, silenceMs, socket, maxFailures });
    this.failures = 0;
    this.sessionRes = Object.fromEntries(series.map((s) => [`cs_${s.key}`, s.res]));
    this.sessionKey = Object.fromEntries(series.map((s) => [`cs_${s.key}`, s.key]));
    this.attempt = 0;
    this.lastMsg = 0;
    this.closed = false;
    this.connect();
    this.watchdog = setInterval(() => {
      if (this.ws?.readyState === 1 && Date.now() - this.lastMsg > this.silenceMs) this.ws.close();
    }, 5_000);
  }

  send(m, p) {
    if (this.ws?.readyState === 1) this.ws.send(encodeFrame(m, p));
  }

  connect() {
    this.onStatus?.({ state: 'connecting' });
    const ws = this.socket(TV_WS_URL);
    let gotData = false;
    this.ws = ws;
    ws.onopen = () => {
      this.attempt = 0;
      this.lastMsg = Date.now();
      this.onStatus?.({ state: 'open' });
      this.send('set_auth_token', ['unauthorized_user_token']);
      this.send('quote_create_session', ['qs_main']);
      this.send('quote_set_fields', ['qs_main', ...QUOTE_FIELDS]);
      this.send('quote_add_symbols', ['qs_main', ...this.quotes]);
      for (const s of this.series) {
        const cs = `cs_${s.key}`;
        this.send('chart_create_session', [cs, '']);
        this.send('resolve_symbol', [cs, 'sym1', `=${JSON.stringify({ symbol: s.symbol, adjustment: 'splits', session: 'extended' })}`]);
        this.send('create_series', [cs, 's1', 's1', 'sym1', s.res, s.count, '']);
      }
    };
    ws.onmessage = (e) => {
      this.lastMsg = Date.now();
      if (!gotData) { gotData = true; this.failures = 0; }
      for (const payload of decodeFrames(e.data)) {
        if (payload.startsWith('~h~')) {
          ws.send(`~m~${payload.length}~m~${payload}`);
          continue;
        }
        const ev = interpret(payload, this.sessionRes);
        if (!ev) continue;
        if (ev.kind === 'bars') this.onBars?.(this.sessionKey[ev.session], ev.bars, ev.full);
        else if (ev.kind === 'quote') this.onQuote?.(ev.symbol, ev.values);
        else if (ev.kind === 'error') this.onStatus?.({ state: 'error', error: ev.message, key: this.sessionKey[ev.session] });
      }
    };
    ws.onclose = () => {
      if (this.closed || this.ws !== ws) return;
      if (!gotData) this.failures++;
      if (this.failures >= this.maxFailures) {
        this.stop();
        this.onStatus?.({ state: 'rejected', error: 'Koneksi ditolak TradingView (origin tidak diizinkan)' });
        return;
      }
      this.onStatus?.({ state: 'closed' });
      const delay = Math.min(30_000, 1000 * 2 ** this.attempt++);
      setTimeout(() => this.connect(), delay);
    };
    ws.onerror = () => ws.close();
  }

  stop() {
    this.closed = true;
    clearInterval(this.watchdog);
    try { this.ws?.close(); } catch { /* sudah tertutup */ }
  }
}
