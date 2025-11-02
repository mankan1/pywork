// server/src/ingest/hooks.js
import { onQuote, onIv, onUOA, onNewsSentiment, onDarkPool } from "../services/state.js";

// QUOTES / TRADES
export function handleQuote(m) {
  // Map vendor fields to ours:
  onQuote({
    symbol: m.symbol,
    last: m.last,
    prevClose: m.prevClose,          // keep sending this occasionally
    volume: m.volume,
    // if you compute up/down volume deltas:
    deltaVolUp: m.deltaVolUp || 0,
    deltaVolDn: m.deltaVolDn || 0,
    ts: m.ts,
  });
}

// IV
export function handleIv(m) {
  onIv({ symbol: m.symbol, iv: m.iv, ts: m.ts });
}

// OPTIONS FLOW (UOA)
export function handleUoa(m) {
  onUOA({ symbol: m.symbol, side: m.side, size: m.size, notional: m.notional, ts: m.ts });
}

// NEWS sentiment (your NLP, vendor score, or a quick valence)
export function handleNews(m) {
  onNewsSentiment({ symbol: m.symbol, score: m.score, ts: m.ts });
}

// DARK POOL prints
export function handleDark(m) {
  onDarkPool({ symbol: m.symbol, notional: m.notional, side: m.side, ts: m.ts });
}

