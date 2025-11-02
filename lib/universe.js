// server/lib/universe.js
// Minimal universes. You can swap in full S&P 500 later.
export const UNIVERSE_BREADTH = (process.env.BREADTH_LIST
  ? process.env.BREADTH_LIST.split(",").map(s => s.trim().toUpperCase()).filter(Boolean)
  : [
    "AAPL","MSFT","NVDA","AMZN","GOOGL","META","TSLA","AVGO","GOOG","JPM",
    "LLY","XOM","UNH","V","PG","MA","COST","HD","JNJ","BAC",
    "WMT","ORCL","NFLX","CVX","KO","MRK","PEP","ABBV","ADBE","CRM",
    "AMD","LIN","ACN","DIS","CSCO","MCD","TXN","WFC","TMO","INTU",
    "INTC","PM","GE","PFE","IBM","AMAT","CMCSA","CAT","NOW","BKNG"
  ] // ~50 symbols to stay under rate limits
);

export const IV_UNDERLYINGS = ["SPY","QQQ","IWM"]; // used for IV "rank-ish" display
export const SENTIMENT_UNDERLYINGS = (process.env.SENTIMENT_LIST
  ? process.env.SENTIMENT_LIST.split(",").map(s=>s.trim().toUpperCase()).filter(Boolean)
  : ["SPY","QQQ","AAPL","NVDA","AMD","TSLA"]
);

export const PATTERN_UNDERLYINGS = (process.env.PATTERN_LIST
  ? process.env.PATTERN_LIST.split(",").map(s=>s.trim().toUpperCase()).filter(Boolean)
  : ["AAPL","MSFT","NVDA","AMD","TSLA","META"]
);

