// Central, vendor-agnostic live caches.
// Call the on* updaters from your existing ingestors.

const ticks = new Map();     // symbol -> { last, prevClose, volume, upVol, downVol, ts }
const ivNow = new Map();     // symbol -> { iv, hist: number[], ts }
const uoa  = [];             // rolling options prints: { symbol, side: "CALL"|"PUT", size, notional, ts }
const news = [];             // rolling news scores:   { symbol?, score: -1..1, ts }
const dark = [];             // rolling dark pool prints: { symbol, notional, side, ts }

const MAX_ROLL = 2000;

export function onQuote({ symbol, last, prevClose, volume, deltaVolUp = 0, deltaVolDn = 0, ts = Date.now() }) {
  const cur = ticks.get(symbol) || { last: 0, prevClose: prevClose ?? last, volume: 0, upVol: 0, downVol: 0, ts };
  const upVol   = cur.upVol   + (deltaVolUp || 0);
  const downVol = cur.downVol + (deltaVolDn || 0);
  ticks.set(symbol, { last, prevClose: prevClose ?? cur.prevClose, volume: volume ?? cur.volume, upVol, downVol, ts });
}

export function onIv({ symbol, iv, ts = Date.now(), histLen = 252 }) {
  const cur = ivNow.get(symbol) || { iv: 0, hist: [], ts };
  const hist = (cur.hist.concat(iv)).slice(-histLen);
  ivNow.set(symbol, { iv, hist, ts });
}

export function onUOA({ symbol, side, size = 1, notional = 0, ts = Date.now() }) {
  uoa.push({ symbol, side, size, notional, ts });
  if (uoa.length > MAX_ROLL) uoa.splice(0, uoa.length - MAX_ROLL);
}

export function onNewsSentiment({ score, symbol = null, ts = Date.now() }) {
  news.push({ symbol, score, ts });
  if (news.length > MAX_ROLL) news.splice(0, news.length - MAX_ROLL);
}

export function onDarkPool({ symbol, notional = 0, side = "BUY", ts = Date.now() }) {
  dark.push({ symbol, notional, side, ts });
  if (dark.length > MAX_ROLL) dark.splice(0, dark.length - MAX_ROLL);
}

export function snapshot() {
  return {
    ticks, ivNow,
    uoa: uoa.slice(-MAX_ROLL),
    news: news.slice(-MAX_ROLL),
    dark: dark.slice(-MAX_ROLL),
    now: Date.now(),
  };
}

