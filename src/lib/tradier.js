const BASE = process.env.TRADIER_BASE?.trim() || "https://api.tradier.com";
const TOKEN = process.env.TRADIER_TOKEN?.trim();

if (!TOKEN) {
  console.warn("[tradier] Missing TRADIER_TOKEN");
}

async function tget(path, params = {}) {
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, v);
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Tradier GET ${path} ${res.status}: ${body.slice(0,200)}`);
  }
  return res.json();
}

// ---- Market Data
export const quotes = (symbols) =>
  tget("/v1/markets/quotes", {
    symbols: Array.isArray(symbols) ? symbols.join(",") : symbols,
  });

export const history = (symbol, { start, end, interval = "daily" } = {}) =>
  tget("/v1/markets/history", { symbol, start, end, interval });

export const timesales = (symbol, { interval = "5min", start, end, session_filter = "all" } = {}) =>
  tget("/v1/markets/timesales", { symbol, interval, start, end, session_filter });

// ---- Options
export const expirations = (symbol) =>
  tget("/v1/markets/options/expirations", { symbol, includeAllRoots: "true" });

export const chains = (symbol, expiration) =>
  tget("/v1/markets/options/chains", { symbol, expiration, greeks: "true" });

// ---- Market Clock
export const marketClock = () => tget("/v1/markets/clock");
