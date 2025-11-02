const PORT = process.env.PORT || 8080;

const CORS_ORIGINS = (process.env.CORS_ORIGINS || "http://localhost:8081")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

export default {
  PORT,
  CORS_ORIGINS,
  INGEST_KEY: process.env.INGEST_KEY || "change-me",
  TRADIER_TOKEN: process.env.TRADIER_TOKEN || "",
  ALPACA_KEY: process.env.ALPACA_KEY || "",
  ALPACA_SECRET: process.env.ALPACA_SECRET || "",
  IB_HOST: process.env.IB_HOST || "127.0.0.1",
  IB_PORT: Number(process.env.IB_PORT || 5000)
};

