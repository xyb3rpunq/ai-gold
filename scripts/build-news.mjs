// Dijalankan GitHub Actions (cron). Kalender ForexFactory dan headline TradingView tidak membuka CORS
// untuk browser, jadi diambil di sini (permintaan biasa, tanpa memalsukan header) lalu diterbitkan
// sebagai news.json di branch `data`.
import { writeFileSync, mkdirSync } from 'node:fs';
import { FF_URL, headlinesUrl, transformForexFactory, transformHeadlines } from '../js/news.js';

const outDir = process.argv[2] || 'out';
const headers = { 'User-Agent': 'ai-gold/1.0 (+https://github.com/xyb3rpunq/ai-gold)' };

async function getJson(url) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      console.error(`gagal (${attempt}/3) ${url}: ${err.message}`);
      if (attempt === 3) return null;
      await new Promise((r) => setTimeout(r, 3000 * attempt));
    }
  }
  return null;
}

const now = Date.now();
const [cal, goldNews, xauNews, dxyNews] = await Promise.all([
  getJson(FF_URL),
  getJson(headlinesUrl('TVC:GOLD')),
  getJson(headlinesUrl('OANDA:XAUUSD')),
  getJson(headlinesUrl('TVC:DXY')),
]);

const events = transformForexFactory(cal);
const headlines = transformHeadlines(goldNews, xauNews, dxyNews);
if (!events.length && !headlines.length) {
  console.error('Kalender dan headline kosong — tidak menimpa data lama.');
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });
writeFileSync(`${outDir}/news.json`, JSON.stringify({ generatedAt: new Date(now).toISOString(), events, headlines }));
console.log(`news.json: ${events.length} event (${events.filter((e) => e.importance >= 1).length} high), ${headlines.length} headline`);
