// src/routes/insights.js
import express from "express";
import { quotes, history, timesales, expirations, chains, marketClock } from "../lib/tradier.js";
import { sma, atr, hv } from "../metrics/ta.js";

const router = express.Router();
const validTF = new Set(["1m","5m","15m","30m","hourly","daily","weekly"]);
const pickTF = (q, fb="daily") => validTF.has(q) ? q : fb;

// Small S&P-100-ish slice to keep requests light; expand if needed
const UNIVERSE = [
  "AAPL","MSFT","NVDA","GOOGL","AMZN","META","TSLA","AVGO","AMD","NFLX",
  "COST","JPM","XOM","UNH","V","MA","PEP","LIN","ABBV","WMT",
  "BAC","ADBE","CRM","KO","MRK","CSCO","PFE","TMO","ORCL","INTC",
  "GE","QCOM","TXN","AMAT","HON","LLY","NKE","LOW","MCD","HD",
  "CAT","BA","GS","MS","IBM","CVX","CMCSA","BMY","BKNG","PYPL"
];

// ---- helpers
const todayISO = () => new Date().toISOString().slice(0,10);
const daysAgoISO = (n) => {
  const d = new Date(); d.setDate(d.getDate() - n);
  return d.toISOString().slice(0,10);
};

async function getBreadthAndThrust() {
  const q = await quotes(UNIVERSE);
  const arr = (q?.quotes?.quote ? [].concat(q.quotes.quote) : []).filter(Boolean);
  let adv = 0, dec = 0, unch = 0, upVol = 0, downVol = 0, totVol = 0;
  for (const x of arr) {
    const change = Number(x.change ?? x.net ?? 0);
    const vol = Number(x.volume ?? 0);
    totVol += vol;
    if (change > 0) { adv++; upVol += vol; }
    else if (change < 0) { dec++; downVol += vol; }
    else { unch++; }
  }
  const thrust = (upVol / Math.max(1, upVol + downVol));
  return { breadth: { advancers: adv, decliners: dec, unchanged: unch }, volume: { total: totVol, up: upVol, down: downVol }, thrust };
}

async function getCoreSymbolStats(symbol) {
  // 60 trading days for ATR/HV and SMAs
  const start = daysAgoISO(100), end = todayISO();
  const h = await history(symbol, { start, end, interval: "daily" });
  const bars = (h?.history?.day ? [].concat(h.history.day) : []).map(d => ({
    date: d.date, open: +d.open, high: +d.high, low: +d.low, close: +d.close, volume: +d.volume
  }));
  if (bars.length < 20) return null;

  const closes = bars.map(b => b.close);
  const a = atr(bars, 14);
  const hv20 = hv(closes, 20);
  const sma20 = sma(closes, 20);
  const sma50 = sma(closes, 50);
  const last = bars[bars.length - 1];

  return {
    last: last.close,
    change: (last.close - bars[bars.length - 2].close),
    atr14: a,
    atrPct: a != null ? a / last.close : null,
    hv20,
    sma20, sma50,
    aboveSma20: last.close > sma20,
    aboveSma50: last.close > sma50,
    breakout20D: last.close >= Math.max(...closes.slice(-21, -1)),
  };
}

async function nearestExpiration(symbol) {
  const exps = await expirations(symbol);
  const list = (exps?.expirations?.date ? [].concat(exps.expirations.date) : []).filter(Boolean);
  const today = new Date();
  list.sort((a,b) => new Date(a) - new Date(b));
  return list.find(d => new Date(d) > today) || list[0]; // next future, else nearest
}

function pickAtmOption(options, underlyingLast) {
  // options: array with fields strike, option_type, greeks{mid_iv}, volume, open_interest
  if (!options?.length) return null;
  let best = null, bestDiff = Infinity;
  for (const o of options) {
    const diff = Math.abs(Number(o.strike) - underlyingLast);
    if (diff < bestDiff) { best = o; bestDiff = diff; }
  }
  return best;
}

async function optionsSnapshot(symbol) {
  const q = await quotes(symbol);
  const under = Array.isArray(q?.quotes?.quote) ? q.quotes.quote[0] : q?.quotes?.quote;
  const last = Number(under?.last || under?.bid || under?.ask || 0);

  const exp = await nearestExpiration(symbol);
  const ch = await chains(symbol, exp);
  const arr = (ch?.options?.option ? [].concat(ch.options.option) : []).filter(Boolean);

  // Put/Call ratios (by volume & OI)
  let volP = 0, volC = 0, oiP = 0, oiC = 0;
  for (const o of arr) {
    const v = Number(o.volume || 0), oi = Number(o.open_interest || 0);
    if (o.option_type === "put") { volP += v; oiP += oi; }
    else { volC += v; oiC += oi; }
  }

  // ATM IV snapshot (use mid_iv if present)
  const atm = pickAtmOption(arr.filter(o => o.option_type === "call"), last);
  const ivMid = Number(atm?.greeks?.mid_iv ?? atm?.greeks?.iv ?? NaN);

  // UOA: top 5 by vol/oi ratio
  const ranked = arr
    .map(o => ({
      occ: o.symbol,
      side: o.option_type.toUpperCase(),
      strike: o.strike,
      exp: o.expiration_date || exp,
      vol: +o.volume || 0,
      oi: +o.open_interest || 0,
      last: +o.last || 0,
      ratio: (o.open_interest > 0 ? (o.volume / o.open_interest) : (o.volume > 0 ? Infinity : 0)),
    }))
    .sort((a,b) => (b.ratio - a.ratio || b.vol - a.vol))
    .slice(0, 5);

  return {
    symbol,
    expiration: exp,
    put_call_vol_ratio: volC > 0 ? volP / volC : null,
    put_call_oi_ratio: oiC > 0 ? oiP / oiC : null,
    atm_iv_mid: isFinite(ivMid) ? ivMid : null,
    uoa_top: ranked,
  };
}

/* ================== ROUTES ================== */

// GET /api/insights/summary?tf=daily
router.get("/summary", async (req, res) => {
  try {
    const tf = pickTF(String(req.query.tf || ""), "daily");
    const clock = await marketClock().catch(() => null);
    const meta = {
      session: clock?.clock?.state?.toUpperCase() || "UNKNOWN", // OPEN, CLOSED, PRE, POST
      data_source: "live",
      tf,
      asof: new Date().toISOString(),
    };

    // Universe breadth & volume thrust
    const { breadth, volume, thrust } = await getBreadthAndThrust();

    // Core indices
    const [spy, qqq, iwm] = await Promise.all([
      getCoreSymbolStats("SPY"), getCoreSymbolStats("QQQ"), getCoreSymbolStats("IWM")
    ]);

    // Simple trend bias from SPY
    let bias = "sideways", strength = 0.5;
    if (spy) {
      const score = (spy.aboveSma20 ? 0.5 : -0.5) + (spy.aboveSma50 ? 0.5 : -0.5) + (spy.breakout20D ? 0.3 : 0);
      bias = score > 0.3 ? "up" : score < -0.3 ? "down" : "sideways";
      strength = Math.min(1, Math.max(0, 0.5 + score / 2));
    }

    return res.json({
      timeframe: tf,
      updated_at: meta.asof,
      breadth,
      volume,
      thrust, // 0..1 up-volume share
      trend: { bias, strength },
      vola: {
        SPY: { atr_pct: spy?.atrPct ?? null, hv20: spy?.hv20 ?? null },
        QQQ: { atr_pct: qqq?.atrPct ?? null, hv20: qqq?.hv20 ?? null },
        IWM: { atr_pct: iwm?.atrPct ?? null, hv20: iwm?.hv20 ?? null },
      },
      smas: {
        SPY: { sma20: spy?.sma20 ?? null, sma50: spy?.sma50 ?? null },
      },
      meta,
      note: "Live Tradier data; breadth computed over a 50-name universe (adjust as needed)."
    });
  } catch (e) {
    console.error("summary error", e);
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// GET /api/insights/sentiment
router.get("/sentiment", async (_req, res) => {
  try {
    const clock = await marketClock().catch(() => null);
    const meta = { session: clock?.clock?.state?.toUpperCase() || "UNKNOWN", data_source: "live", asof: new Date().toISOString() };

    // Build across a few liquid underlyings and also overall
    const underlyings = ["SPY","QQQ","IWM"];
    const snaps = await Promise.all(underlyings.map(optionsSnapshot));

    // Aggregate put/call
    let vP=0,vC=0,oP=0,oC=0;
    snaps.forEach(s => {
      if (s.put_call_vol_ratio != null) {
        // reconstruct with totals: ratio = P/C => choose totals via chains again
        // We didn't keep totals directly, so recompute from UOA? Keep it simple:
        // call again but it’s fine; or just average ratios. We'll avg ratios:
      }
    });
    // Better: re-run minimal totals per symbol:
    // (We already computed per symbol ratios; report them + overall as avg)
    const avgVolPCR = avg(snaps.map(s => s.put_call_vol_ratio).filter(x => x != null));
    const avgOiPCR = avg(snaps.map(s => s.put_call_oi_ratio).filter(x => x != null));

    res.json({
      put_call_vol_ratio: avgVolPCR,
      put_call_oi_ratio: avgOiPCR,
      atm_iv_mid: Object.fromEntries(snaps.map(s => [s.symbol, s.atm_iv_mid])),
      options_uoa: snaps.flatMap(s =>
        s.uoa_top.map(u => ({
          symbol: s.symbol,
          side: u.side,
          occ: u.occ,
          strike: u.strike,
          exp: u.exp,
          vol: u.vol,
          oi: u.oi,
          ratio: u.ratio,
        }))
      ).slice(0, 10),
      meta,
      note: "Put/Call ratios averaged across SPY/QQQ/IWM nearest expiration."
    });
  } catch (e) {
    console.error("sentiment error", e);
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// GET /api/insights/patterns?tf=5m
router.get("/patterns", async (req, res) => {
  try {
    const tf = pickTF(String(req.query.tf || ""), "5m");
    const clock = await marketClock().catch(() => null);
    const meta = { session: clock?.clock?.state?.toUpperCase() || "UNKNOWN", data_source: "live", tf, asof: new Date().toISOString() };

    // Simple pattern: 20D breakout on a few liquid names + intraday momentum check via last 5 bars uptrend
    const symbols = ["AAPL","TSLA","NVDA","AMD","MSFT","META","AMZN","GOOGL"];
    const start = daysAgoISO(40), end = todayISO();

    const results = [];
    for (const sym of symbols) {
      const h = await history(sym, { start, end, interval: "daily" });
      const days = (h?.history?.day ? [].concat(h.history.day) : []).map(d => +d.close);
      if (days.length < 21) continue;
      const last = days[days.length - 1];
      const breakout = last >= Math.max(...days.slice(-21, -1));

      // Intraday momentum (5m): last 5 closes rising
      const t = await timesales(sym, { interval: "5min", start: null, end: null, session_filter: "all" });
      const bars = (t?.series?.data ? [].concat(t.series.data) : []);
      let intradayUp = false;
      if (bars.length >= 6) {
        const closes = bars.slice(-6).map(b => +b.price);
        intradayUp = closes.every((c,i,arr) => i===0 || c >= arr[i-1]);
      }
      const type = breakout && intradayUp ? "Breakout+IntradayUp" : breakout ? "Breakout" : intradayUp ? "IntradayUp" : null;
      if (type) results.push({ symbol: sym, type, confidence: type === "Breakout+IntradayUp" ? 0.8 : 0.6 });
    }

    res.json({ timeframe: tf, patterns: results, meta });
  } catch (e) {
    console.error("patterns error", e);
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// util
function avg(a){ return a?.length ? a.reduce((x,y)=>x+y,0)/a.length : null; }

export default router;

