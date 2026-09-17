// Kalender sesi emas: hari trading berganti 17:00 New York (termasuk DST AS), sama seperti
// sesi XAUUSD di TradingView dan candle D1 broker MT5 bertime-zone GMT+2/+3.

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const cache = new Map();

// Minggu ke-n pada bulan tertentu (UTC), jam 02:00 waktu lokal NY → dipakai sebagai batas DST.
function nthSunday(year, month, n) {
  const first = new Date(Date.UTC(year, month, 1));
  const offset = (7 - first.getUTCDay()) % 7;
  return Date.UTC(year, month, 1 + offset + 7 * (n - 1));
}

// Selisih jam New York terhadap UTC (−4 saat DST, −5 di luar DST).
export function nyOffsetHours(tMs) {
  const year = new Date(tMs).getUTCFullYear();
  let r = cache.get(year);
  if (!r) {
    // DST mulai Minggu ke-2 Maret 02:00 EST (= 07:00 UTC), selesai Minggu ke-1 November 02:00 EDT (= 06:00 UTC).
    r = { start: nthSunday(year, 2, 2) + 7 * HOUR, end: nthSunday(year, 10, 1) + 6 * HOUR };
    cache.set(year, r);
  }
  return tMs >= r.start && tMs < r.end ? -4 : -5;
}

// Nomor hari sesi: berganti tepat pukul 17:00 NY.
export function sessionDay(tMs) {
  const shifted = tMs + (nyOffsetHours(tMs) + 7) * HOUR; // 17:00 NY → 00:00 hari berikutnya
  return Math.floor(shifted / DAY);
}

// Minggu sesi dimulai Minggu 17:00 NY (hari sesi Senin). Hari ke-4 epoch = Senin.
export const sessionWeek = (tMs) => Math.floor((sessionDay(tMs) - 4) / 7);

export function sessionMonth(tMs) {
  const d = new Date(sessionDay(tMs) * DAY);
  return d.getUTCFullYear() * 12 + d.getUTCMonth();
}

export const sessionQuarter = (tMs) => Math.floor(sessionMonth(tMs) / 3);
export const sessionYear = (tMs) => Math.floor(sessionMonth(tMs) / 12);

// Anchor VWAP per timeframe: intraday → sesi harian, 1H–4H → mingguan, 1D → bulanan, 1W → kuartal, 1M → tahunan.
export function vwapAnchorFor(tf) {
  if (tf.ms < HOUR) return { key: sessionDay, label: 'Sesi' };
  if (tf.ms < DAY) return { key: sessionWeek, label: 'Mingguan' };
  if (tf.id === '1D') return { key: sessionMonth, label: 'Bulanan' };
  if (tf.id === '1W') return { key: sessionQuarter, label: 'Kuartal' };
  return { key: sessionYear, label: 'Tahunan' };
}
