import http from "http";
import express from "express";
import cors from "cors";
import compression from "compression";
import morgan from "morgan";
import config from "./config.js";
//import insightsRouter from "./routes/insights.router.js";
import healthRouter from "./routes/health.router.js";
import { setupWS } from "./ws.js";
import insightsRouter from "../routes/insights.js";
import insights from "../routes/insights.js";

const app = express();

app.use(cors({
  origin: config.CORS_ORIGINS,
  credentials: true
}));
app.use(express.json({ limit: "2mb" }));
app.use(compression());
app.use(morgan("tiny"));

// disable etag + force no-store to always get 200 with a body
app.set("etag", false);
app.use((req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

// 🔌 Mount here (ensure this is BEFORE any 404 handler)
//app.use("/api/insights", insightsRouter);
app.use("/healthz", healthRouter);
app.use("/api/insights", insights);

// create HTTP + WS
const server = http.createServer(app);
const { broadcast } = setupWS(server);

// make broadcast available to routes (for POST /ingest)
app.set("broadcastInsights", broadcast);

server.listen(config.PORT, () => {
  console.log(`Server listening on ${config.PORT}`);
});

