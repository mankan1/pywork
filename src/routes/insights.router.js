// server/src/routes/insights.router.js
import express from "express";
import { getInsights, setInsights } from "../services/insights-store.js";
import config from "../config.js";

const router = express.Router();

/** GET /api/insights/meta */
router.get("/meta", (req, res) => {
  const cache = getInsights();
  res.json({
    ok: true,
    lastUpdated: cache.lastUpdated,
    available: Object.keys(cache).filter(k => k !== "lastUpdated")
  });
});

/** GET /api/insights/summary?tf=daily|5m|15m|30m|1h */
router.get("/summary", (req, res) => {
  const tf = (req.query.tf || "daily").toLowerCase();
  const c = getInsights();
  const map = {
    "daily": c.summaryDaily,
    "5m": c.summary5m,
    "15m": c.summary15m,
    "30m": c.summary30m,
    "1h": c.summary1h
  };
  const payload = map[tf];
  if (!payload) return res.status(404).json({ ok:false, error:`no summary for ${tf}` });
  res.json({ ok:true, tf, ...payload });
});

/** GET /api/insights/patterns?tf=5m|daily */
router.get("/patterns", (req, res) => {
  const tf = (req.query.tf || "5m").toLowerCase();
  const c = getInsights();
  const payload = tf === "daily" ? c.patternsDaily : c.patterns5m;
  if (!payload) return res.status(404).json({ ok:false, error:`no patterns for ${tf}` });
  res.json({ ok:true, tf, ...payload });
});

/** GET /api/insights/sentiment */
router.get("/sentiment", (req, res) => {
  const c = getInsights();
  if (!c.sentiment) return res.status(404).json({ ok:false, error:"no sentiment yet" });
  res.json({ ok:true, ...c.sentiment, flipZones: c.flipZones || [] });
});

/** POST /api/insights/ingest  (ETL calls this) */
router.post("/ingest", (req, res) => {
  const auth = req.headers["x-ingest-key"];
  if (auth !== config.INGEST_KEY) {
    return res.status(401).json({ ok:false, error:"unauthorized" });
  }
  setInsights(req.body || {});
  // optionally broadcast via ws:
  if (req.app.get("broadcastInsights")) {
    req.app.get("broadcastInsights")({ type: "insights:update", payload: req.body });
  }
  res.json({ ok:true });
});

export default router;

