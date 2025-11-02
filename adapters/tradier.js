// server/adapters/tradier.js
// Thin wrapper over Tradier REST for quotes, options, history, clock.
// ENV needed: TRADIER_TOKEN
// Optional:   TRADIER_BASE (default https://api.tradier.com)

const BASE = (process.env.TRADIER_BASE || "https://api.tradier.com").replace(/\/$/, "");
const TOKEN = process.env.TRADIER_TOKEN;
if (!TOKEN) console.warn("[tradier] TRADIER_TOKEN not set — calls will fail.");

const H = {
  "Authorization": `Bearer ${TOKEN}`,
  "Accept": "application/json",
};

async function tget(path, params = {}) {
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }
  const r = await fetch(url, { headers: H });
  if (!r.ok) {
    const txt = await r.text().catch(()=>"");
    throw new Error(`Tradier ${url.pathname} ${r.status} ${txt.slice(0,200)}`);
  }
  return r.json();
}

// --- Market basics ---
export async function getClock() {
  const j = await tget("/v1/markets/clock");
  return j?.clock;
}

// --- Quotes: up to ~500 symbols per call; we chunk if needed.
export async function getQuotes(symbols) {
  const CHUNK = 400;
  const chunks = [];
  for (let i = 0; i < symbols.length; i += CHUNK) chunks.push(symbols.slice(i, i + CHUNK));

  const out = {};
  for (const ch of chunks) {
    const j = await tget("/v1/markets/quotes", { symbols: ch.join(",") });
    let qs = j?.quotes?.quote ?? [];
    if (!Array.isArray(qs)) qs = [qs];
    for (const q of qs) if (q && q.symbol) out[q.symbol] = q;
  }
  return out;
}

// --- Daily history (inclusive dates, YYYY-MM-DD)
export async function getDailyHistory(symbol, start, end) {
  const j = await tget("/v1/markets/history", { symbol, interval: "daily", start, end });
  let days = j?.history?.day ?? [];
  if (!Array.isArray(days)) days = [days];
  return days.map(d => ({
    date: d.date, open: +d.open, high: +d.high, low: +d.low, close: +d.close, volume: +d.volume
  }));
}

// --- Options expirations & chains ---
export async function getExpirations(symbol) {
  const j = await tget("/v1/markets/options/expirations", {
    symbol, includeAllRoots: "true", strikes: "false"
  });
  let arr = j?.expirations?.date ?? [];
  if (!Array.isArray(arr)) arr = [arr];
  return arr;
}

export async function getChain(symbol, expiration, greeks = true) {
  const j = await tget("/v1/markets/options/chains", {
    symbol, expiration, greeks: greeks ? "true" : "false"
  });
  let arr = j?.options?.option ?? [];
  if (!Array.isArray(arr)) arr = [arr];
  return arr.map(o => ({
    underlying: symbol,
    symbol: o.symbol,
    type: o.option_type,  // "call" | "put"
    strike: +o.strike,
    bid: +o.bid, ask: +o.ask, last: +o.last,
    volume: +o.volume, oi: +o.open_interest,
    greeks: o.greeks ? {
      delta: +o.greeks.delta, gamma: +o.greeks.gamma,
      theta: +o.greeks.theta, vega: +o.greeks.vega,
      rho: +o.greeks.rho,    iv: +o.greeks.mid_iv || +o.greeks.iv || NaN
    } : null
  }));
}

