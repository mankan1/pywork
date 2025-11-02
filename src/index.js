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

const ALLOWED_ORIGINS = [
  "https://pyworkclient.vercel.app",
  "http://localhost:8081",      // Expo web dev
  "http://localhost:5173",      // Vite dev (if you ever use it)
  "https://www.marketsfin.lol",
  "https://marketsfin.lol",
];

/*
app.use(cors({
  origin: config.CORS_ORIGINS,
  credentials: true
}));
*/


app.use(
  cors({
    origin(origin, cb) {
      // allow no-origin (curl, mobile apps) and your whitelisted origins
      if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
      cb(new Error("Not allowed by CORS"));
    },
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: false, // set true only if you actually use cookies/Authorization headers that require it
  })
);


// Optional: handle preflight explicitly
app.options("*", cors());

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

