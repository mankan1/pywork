// server/src/ws.js
import { WebSocketServer } from "ws";

export function setupWS(server) {
  const wss = new WebSocketServer({
    server,
    perMessageDeflate: false,
    clientTracking: true
  });

  const broadcast = (msg) => {
    const data = JSON.stringify(msg);
    for (const c of wss.clients) {
      if (c.readyState === 1) c.send(data);
    }
  };

  wss.on("connection", (ws) => {
    ws.send(JSON.stringify({ type:"hello", ts: Date.now() }));
  });

  return { wss, broadcast };
}

