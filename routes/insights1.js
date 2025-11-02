// server/routes/insights.js
import express from "express";

const router = express.Router();

// Helpers
const validTF = new Set(["1m","5m","15m","30m","hourly","daily","weekly"]);
const pickTF = (q, fallback="daily") => validTF.has(q) ? q : fallback;

// GET /api/insights/summary?tf=daily
router.get("/summary", async (req, res) => {
  const tf = pickTF((req.query.tf || "").toString(), "daily");

  // TODO: replace with real computation
  const now = new Date().toISOString();
  return res.json({
    timeframe: tf,
    updated_at: now,
    breadth: { advancers: 312, decliners: 190, unchanged: 8 },
    volume: { total: 4.2e9, up: 2.6e9, down: 1.5e9 },
    trend: { bias: "up", strength: 0.62 }, // 0..1
    iv_rank: { SPY: 34, QQQ: 41, IWM: 29 },
    note: "stub data — wire this to your real aggregations"
  });
});

// GET /api/insights/sentiment
router.get("/sentiment", async (_req, res) => {
  // TODO: replace with real flow/news sentiment
  return res.json({
    put_call_vol_ratio: 0.84,
    put_call_oi_ratio: 0.97,
    dark_pool_score: 0.55,     // 0..1
    news_sentiment: { score: 0.12, sample: 143 }, // -1..+1
    options_uoa: [
      { symbol: "SPY", side: "CALL", ratio: 1.3, note: "call skew intraday" },
      { symbol: "NVDA", side: "PUT", ratio: 0.8, note: "profit-taking puts" }
    ]
  });
});

// GET /api/insights/patterns?tf=5m
router.get("/patterns", async (req, res) => {
  const tf = pickTF((req.query.tf || "").toString(), "5m");

  // TODO: replace with real pattern scanner output
  return res.json({
    timeframe: tf,
    patterns: [
      { symbol: "AAPL", type: "BullFlag", confidence: 0.74 },
      { symbol: "TSLA", type: "Breakout", confidence: 0.68 },
      { symbol: "AMD",  type: "BearDivRSI", confidence: 0.57 }
    ]
  });
});

export default router;

