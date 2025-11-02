// server/src/services/insights-store.js
const cache = {
  lastUpdated: null,
  summaryDaily: null,
  summary5m: null,
  summary15m: null,
  summary30m: null,
  summary1h: null,
  patterns5m: null,
  patternsDaily: null,
  sentiment: null,
  flipZones: []
};

export function getInsights() {
  return cache;
}

export function setInsights(next) {
  Object.assign(cache, next, { lastUpdated: new Date().toISOString() });
}

export function patchInsights(partial) {
  Object.assign(cache, partial, { lastUpdated: new Date().toISOString() });
}

