import express from "express";
import { snapshot } from "../src/services/state.js";

const router = express.Router();

const validTF = new Set(["1m","5m","15m","30m","hourly","daily","weekly"]);
const pickTF = (q, fallback="daily") => validTF.has(q) ? q : fallback;

function calcBreadth(ticksMap) {
  let adv = 0, dec = 0, unch = 0;
  for (const [, t] of ticksMap) {
    const chg = t.last - (t.prevClose ?? t.last);
    if (chg > 0) adv++; else if (chg < 0) dec++; else unch++;
  }
  return { advancers: adv, decliners: dec, unchanged: unch };
}

function calcUpDownVol(ticksMap) {
  let up = 0, down = 0, total = 0;
  for (const [, t] of ticksMap) {
    up   += (t.upVol   || 0);
    down += (t.downVol || 0);
    total += (t.volume || 0);
  }
  return { total, up, down };
}

function calcTrend(ticksMap) {
  // very light breadth-based bias  [-1..+1] -> map to 0..1 for "strength"
  let score = 0, n = 0;
  for (const [, t] of ticksMap) {
    const pc = t.prevClose ?? t.last;
    if (!pc) continue;
    const ret = (t.last - pc) / pc;
    score += Math.max(-0.02, Math.min(0.02, ret)); // clamp outliers
    n++;
  }
  const mean = n ? score / n : 0;
  const bias = mean > 0.0005 ? "up" : mean < -0.0005 ? "down" : "neutral";
  const strength = Math.min(1, Math.abs(mean) / 0.01); // ~1% day = strong
  return { bias, strength: Number(strength.toFixed(2)) };
}

function ivRankOf(hist, current) {
  if (!hist?.length || current == null) return null;
  const lo = Math.min(...hist);
  const hi = Math.max(...hist);
  if (hi <= lo) return 50;
  return Math.round(((current - lo) / (hi - lo)) * 100);
}

function calcIvRank(ivNow) {
  const want = ["SPY","QQQ","IWM"];
  const out = {};
  for (const s of want) {
    const rec = ivNow.get(s);
    if (!rec) continue;
    out[s] = ivRankOf(rec.hist, rec.iv);
  }
  return out;
}

function calcSentiment(uoa, news, dark) {
  let callVol = 0, putVol = 0, callOi = 0, putOi = 0;
  // If you do not ingest OI deltas, treat `size` as volume proxy.
  for (const p of uoa) {
    if (p.side === "CALL") { callVol += (p.size || 0); callOi += (p.oiDelta || 0); }
    else                   { putVol  += (p.size || 0); putOi  += (p.oiDelta || 0); }
  }
  const put_call_vol_ratio = callVol ? Number((putVol / callVol).toFixed(2)) : null;
  const put_call_oi_ratio  = callOi  ? Number((putOi  / callOi ).toFixed(2)) : null;

  // Dark-pool score: share of BUY notional (very naive)
  let buyNotional = 0, totalNotional = 0;
  for (const d of dark) {
    totalNotional += (d.notional || 0);
    if ((d.side || "BUY").toUpperCase() === "BUY") buyNotional += (d.notional || 0);
  }
  const dark_pool_score = totalNotional ? Number((buyNotional / totalNotional).toFixed(2)) : null;

  const newsScores = news.map(n => n.score).filter(x => Number.isFinite(x));
  const ns = newsScores.length ? (newsScores.reduce((a,b)=>a+b,0)/newsScores.length) : null;

  // UOA examples: top two by notional skew
  const buckets = new Map(); // symbol -> { call: notional, put: notional }
  for (const p of uoa) {
    const b = buckets.get(p.symbol) || { call: 0, put: 0 };
    if (p.side === "CALL") b.call += (p.notional || p.size || 0);
    else                   b.put  += (p.notional || p.size || 0);
    buckets.set(p.symbol, b);
  }
  const ranked = [...buckets.entries()].map(([symbol, b]) => {
    const ratio = b.call && b.put ? Number((b.call / b.put).toFixed(2)) : (b.call ? Infinity : 0);
    return { symbol, side: (ratio >= 1 ? "CALL" : "PUT"), ratio: ratio === Infinity ? b.call : ratio };
  }).sort((a,b) => (Math.abs((a.ratio===Infinity?1e9:a.ratio)-1) < Math.abs((b.ratio===Infinity?1e9:b.ratio)-1) ? 1 : -1));

  const options_uoa = ranked.slice(0, 2).map(r => ({
    symbol: r.symbol, side: r.side, ratio: (r.ratio===Infinity? Number.POSITIVE_INFINITY : Number(r.ratio.toFixed(2))),
    note: r.side === "CALL" ? "call skew intraday" : "put skew intraday"
  }));

  return {
    put_call_vol_ratio,
    put_call_oi_ratio,
    dark_pool_score,
    news_sentiment: ns == null ? null : { score: Number(ns.toFixed(2)), sample: newsScores.length },
    options_uoa,
  };
}

router.get("/summary", async (req, res) => {
  const tf = pickTF((req.query.tf || "").toString(), "daily");
  const s = snapshot();

  const breadth = calcBreadth(s.ticks);
  const volume  = calcUpDownVol(s.ticks);
  const trend   = calcTrend(s.ticks);
  const iv_rank = calcIvRank(s.ivNow);

  return res.json({
    timeframe: tf,
    updated_at: new Date(s.now).toISOString(),
    breadth, volume, trend, iv_rank
  });
});

router.get("/sentiment", async (_req, res) => {
  const s = snapshot();
  return res.json(calcSentiment(s.uoa, s.news, s.dark));
});

router.get("/patterns", async (req, res) => {
  const tf = pickTF((req.query.tf || "").toString(), "5m");
  // If you already have a scanner, expose its last results here.
  // For now we’ll surface an empty array when no signals are present.
  const patterns = []; // fill from your scanner bus: [{ symbol, type, confidence }]
  return res.json({ timeframe: tf, patterns });
});

export default router;

