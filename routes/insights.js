// server/routes/insights.js
import express from "express";
import { getClock, getQuotes, getDailyHistory, getExpirations, getChain } from "../adapters/tradier.js";
import { UNIVERSE_BREADTH, IV_UNDERLYINGS, SENTIMENT_UNDERLYINGS, PATTERN_UNDERLYINGS } from "../lib/universe.js";

const router = express.Router();
const validTF = new Set(["1m","5m","15m","30m","hourly","daily","weekly"]);
const pickTF = (q, fallback="daily") => validTF.has(q) ? q : fallback;

const meta = (source="live") => ({
  data_source: source,
  session: "UNKNOWN",
  ts: new Date().toISOString()
});

// --- util ---
const clamp01 = x => Math.max(0, Math.min(1, x));
const avg = a => (a.length ? a.reduce((s,x)=>s+x,0)/a.length : 0);
const by = (arr, key) => arr.reduce((m,x)=>((m[x[key]]=(m[x[key]]||0)+1),m),{});

async function sessionMeta() {
  try {
    const c = await getClock();
    return { data_source: "live", session: (c?.state || "UNKNOWN").toUpperCase(), ts: c?.timestamp || new Date().toISOString() };
  } catch {
    return meta("error");
  }
}

// ---- SUMMARY ----
router.get("/summary", async (req, res) => {
  try {
    const tf = pickTF((req.query.tf || "").toString(), "daily");
    const [sess, quotes] = await Promise.all([sessionMeta(), getQuotes(UNIVERSE_BREADTH)]);

    const list = Object.values(quotes);
    // Basic breadth using last-trade change
    let adv=0, dec=0, un=0;
    let volUp=0, volDown=0, volTot=0;
    for (const q of list) {
      const ch = +q.change || (+q.last - +q.prevclose);
      const vol = +q.volume || 0;
      volTot += vol;
      if (ch > 0) { adv++; volUp += vol; }
      else if (ch < 0) { dec++; volDown += vol; }
      else un++;
    }

    // Trend (SPY 20/50 SMA on daily)
    const today = new Date();
    const end = today.toISOString().slice(0,10);
    const start = new Date(today.getTime() - 1000*60*60*24*120).toISOString().slice(0,10);
    const spyHist = await getDailyHistory("SPY", start, end);
    const closes = spyHist.map(d=>d.close);
    const sma = (n) => avg(closes.slice(-n));
    const sma20 = sma(20), sma50 = sma(50);
    const bias = Math.abs((sma20 - sma50)/ (closes.at(-1)||1)) < 0.01 ? "sideways" : (sma20 > sma50 ? "up" : "down");
    const strength = clamp01(Math.abs(sma20 - sma50) / (closes.at(-1) || 1) * 8); // scaled 0..1

    // IV "rank-ish": use nearest ~30D ATM IV (scaled to 0..100 for the UI)
    async function atmIvPct(sym) {
      const exps = await getExpirations(sym);
      const now = new Date();
      // pick the expiration closest to 30 calendar days out, but not past the last
      const target = now.getTime() + 30*86400e3;
      const pick = exps
        .map(d=>({d, t:new Date(d+"T16:00:00Z").getTime()}))
        .filter(x=>!Number.isNaN(x.t))
        .reduce((best,cur)=>best==null || Math.abs(cur.t-target)<Math.abs(best.t-target) ? cur : best, null);
      if (!pick) return null;

      const q = await getQuotes([sym]); const last = +q[sym]?.last || +q[sym]?.close || NaN;
      const chain = await getChain(sym, pick.d, true);
      const near = chain
        .filter(o => Math.abs(o.strike - last) === Math.min(...chain.map(c=>Math.abs(c.strike - last))).valueOf())
        .filter(o => o.greeks && Number.isFinite(o.greeks.iv));
      if (!near.length) return null;
      const iv = avg(near.map(o => o.greeks.iv)); // 0.2 => 20%
      return Math.round(iv * 100);
    }
    const iv_rank = {};
    for (const u of IV_UNDERLYINGS) {
      try { iv_rank[u] = await atmIvPct(u); } catch { iv_rank[u] = null; }
    }

    return res.json({
      timeframe: tf,
      updated_at: new Date().toISOString(),
      breadth: { advancers: adv, decliners: dec, unchanged: un },
      volume: { total: volTot, up: volUp, down: volDown },
      trend: { bias, strength },
      iv_rank,
      meta: sess
    });
  } catch (e) {
    return res.status(502).json({ error: String(e.message || e), meta: meta("error") });
  }
});

// ---- SENTIMENT ----
// Put/Call ratios from current chains (volume & OI). Also surface UOA-style picks.
router.get("/sentiment", async (_req, res) => {
  try {
    const sess = await sessionMeta();
    // pick the nearest weekly/monthly expiration for each underlyer (>= today)
    const today = new Date();
    let callVol=0, putVol=0, callOI=0, putOI=0;
    const uoa = [];

    for (const sym of SENTIMENT_UNDERLYINGS) {
      const exps = await getExpirations(sym);
      const pick = exps.find(d => new Date(d+"T16:00:00Z") >= today) || exps.at(-1);
      if (!pick) continue;
      const chain = await getChain(sym, pick, true);

      // aggregate ratios
      for (const o of chain) {
        const vol = +o.volume || 0, oi = +o.oi || 0;
        if (o.type === "call") { callVol += vol; callOI += oi; }
        else { putVol += vol; putOI += oi; }
      }

      // naive UOA: top by vol/oi ratio near-the-money
      const quotes = await getQuotes([sym]);
      const px = +quotes[sym]?.last || +quotes[sym]?.close || NaN;
      const near = chain.filter(o => Math.abs(o.strike - px) <= px * 0.05); // within ~5%
      const ranked = near.filter(o => o.oi > 0).map(o => ({
        symbol: sym,
        side: (o.type || "").toUpperCase(),
        ratio: +(o.volume || 0) / Math.max(1, +o.oi || 1),
        note: `@${o.strike} ${pick}`
      })).sort((a,b) => b.ratio - a.ratio).slice(0, 2);
      uoa.push(...ranked);
    }

    const put_call_vol_ratio = +(putVol / Math.max(1, callVol)).toFixed(2);
    const put_call_oi_ratio  = +(putOI  / Math.max(1, callOI)).toFixed(2);

    return res.json({
      put_call_vol_ratio,
      put_call_oi_ratio,
      dark_pool_score: null,              // Tradier doesn't provide dark pool feed
      news_sentiment: { score: 0, sample: 0 }, // not from Tradier; left neutral
      options_uoa: uoa.slice(0, 6),
      meta: sess
    });
  } catch (e) {
    return res.status(502).json({ error: String(e.message || e), meta: meta("error") });
  }
});

// ---- PATTERNS ----
// Simple daily patterns: Breakout(20D high), InsideDay, Pullback(>SMA20 then -1%).
router.get("/patterns", async (req, res) => {
  try {
    const tf = pickTF((req.query.tf || "").toString(), "5m"); // accepted but we compute on daily here
    const sess = await sessionMeta();
    const today = new Date();
    const end = today.toISOString().slice(0,10);
    const start = new Date(today.getTime() - 1000*60*60*24*60).toISOString().slice(0,10);

    const out = [];
    for (const sym of PATTERN_UNDERLYINGS) {
      const hist = await getDailyHistory(sym, start, end);
      if (hist.length < 22) continue;
      const last = hist.at(-1);
      const prev = hist.at(-2);
      const hi20 = Math.max(...hist.slice(-21, -1).map(d=>d.high));
      const lo20 = Math.min(...hist.slice(-21, -1).map(d=>d.low));
      const sma20 = avg(hist.slice(-20).map(d=>d.close));

      if (last.close > hi20) out.push({ symbol: sym, type: "Breakout20D", confidence: 0.7 });
      if (last.high < prev.high && last.low > prev.low) out.push({ symbol: sym, type: "InsideDay", confidence: 0.55 });
      if (last.close > sma20 && (last.close/prev.close - 1) < -0.01) out.push({ symbol: sym, type: "Pullback>MA20", confidence: 0.6 });
    }

    return res.json({ timeframe: tf, patterns: out.slice(0, 12), meta: sess });
  } catch (e) {
    return res.status(502).json({ error: String(e.message || e), meta: meta("error") });
  }
});

// ---- EXTRAS ----

// Net gamma (very rough): sum(oi * gamma) across near expiration ±10% strikes
router.get("/gamma", async (req, res) => {
  try {
    const base = (req.query.symbol || "SPY").toString().toUpperCase();
    const sess = await sessionMeta();
    const exps = await getExpirations(base);
    const pick = exps.find(d => new Date(d+"T16:00:00Z") >= new Date()) || exps.at(-1);
    const chain = await getChain(base, pick, true);
    const quotes = await getQuotes([base]);
    const px = +quotes[base]?.last || +quotes[base]?.close || NaN;

    const near = chain.filter(o => Math.abs(o.strike - px) <= px * 0.1 && o.greeks && Number.isFinite(o.greeks.gamma));
    const net = near.reduce((s,o)=> s + (o.oi||0)*(o.greeks.gamma||0), 0);
    return res.json({ underlying: base, expiration: pick, net_gamma_sum: +net.toFixed(3), count: near.length, meta: sess });
  } catch (e) {
    return res.status(502).json({ error: String(e.message || e), meta: meta("error") });
  }
});

// % of universe above MA (daily)
router.get("/breadth_ma", async (req, res) => {
  try {
    const ma = Math.max(5, Math.min(200, Number(req.query.ma)||50));
    const sess = await sessionMeta();
    const today = new Date();
    const end = today.toISOString().slice(0,10);
    const start = new Date(today.getTime() - 1000*60*60*24*(ma+10)).toISOString().slice(0,10);

    let above=0, below=0, errors=0;
    for (const sym of UNIVERSE_BREADTH) {
      try {
        const h = await getDailyHistory(sym, start, end);
        if (h.length < ma) { errors++; continue; }
        const sma = avg(h.slice(-ma).map(d=>d.close));
        const last = h.at(-1).close;
        if (last >= sma) above++; else below++;
      } catch { errors++; }
    }
    const pct_above = +(above / Math.max(1, above+below) * 100).toFixed(1);
    return res.json({ universe: UNIVERSE_BREADTH.length, ma, pct_above, counts:{above, below}, errors, meta: sess });
  } catch (e) {
    return res.status(502).json({ error: String(e.message || e), meta: meta("error") });
  }
});

// TRIN (Arms Index): (Adv/Dec) / (UpVol/DownVol)
router.get("/trin", async (_req, res) => {
  try {
    const sess = await sessionMeta();
    const quotes = await getQuotes(UNIVERSE_BREADTH);
    let adv=0, dec=0, un=0, upV=0, dnV=0;
    for (const q of Object.values(quotes)) {
      const ch = +q.change || (+q.last - +q.prevclose);
      const v = +q.volume || 0;
      if (ch > 0) { adv++; upV += v; }
      else if (ch < 0) { dec++; dnV += v; }
      else un++;
    }
    const trin = (adv/Math.max(1,dec)) / ((upV/Math.max(1,dnV)) || 1);
    return res.json({ value: +trin.toFixed(2), advancers: adv, decliners: dec, up_volume: upV, down_volume: dnV, unchanged: un, meta: sess });
  } catch (e) {
    return res.status(502).json({ error: String(e.message || e), meta: meta("error") });
  }
});

// Levels (prev day H/L/C and today's H/L if available)
router.get("/levels", async (req, res) => {
  try {
    const sym = (req.query.symbol || "SPY").toString().toUpperCase();
    const sess = await sessionMeta();
    const today = new Date();
    const end = today.toISOString().slice(0,10);
    const start = new Date(today.getTime() - 1000*60*60*24*6).toISOString().slice(0,10);
    const hist = await getDailyHistory(sym, start, end);
    const prev = hist.at(-2);
    const q = await getQuotes([sym]);
    const live = q[sym] || {};
    return res.json({
      symbol: sym,
      prev_day: prev ? { high: +prev.high, low: +prev.low, close: +prev.close } : null,
      today: live ? { high: +live.high || null, low: +live.low || null, last: +live.last || null } : null,
      vwap: null, // needs intraday timesales; omitted here
      meta: sess
    });
  } catch (e) {
    return res.status(502).json({ error: String(e.message || e), meta: meta("error") });
  }
});

export default router;

