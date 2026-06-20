/**
 * PTY SIGINT 調査: API セッション作成 → WS 接続 → sleep → 0x03 送信 → 応答確認
 * Usage: node scripts/investigate-pty-sigint.mjs
 */
const BASE = process.env.BASE_URL ?? "http://127.0.0.1:5173";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function decodeOutput(chunks) {
  const bytes = chunks.flatMap((chunk) => [...chunk]);
  const text = new TextDecoder().decode(new Uint8Array(bytes));
  return { bytes, text };
}

async function api(path, init) {
  const response = await fetch(`${BASE}${path}`, init);
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`${path} ${response.status}: ${JSON.stringify(body)}`);
  }
  return body;
}

async function connectTerminal(sessionId) {
  const wsUrl = BASE.replace(/^http/, "ws") + `/api/sessions/${sessionId}/ws/terminal`;
  const ws = new WebSocket(wsUrl);
  ws.binaryType = "arraybuffer";

  const inbound = [];
  const events = [];

  ws.addEventListener("message", (event) => {
    if (typeof event.data === "string") {
      events.push(JSON.parse(event.data));
      return;
    }
    inbound.push(new Uint8Array(event.data));
  });

  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
    setTimeout(() => reject(new Error("WebSocket open timeout")), 15_000);
  });

  await waitForReady(events, inbound, 15_000);
  return { ws, inbound, events };
}

async function waitForReady(events, inbound, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (events.some((event) => event.type === "ready")) return;
    if (inbound.length > 0) return;
    await sleep(100);
  }
  throw new Error("PTY ready timeout");
}

function send(ws, data) {
  if (typeof data === "string") ws.send(new TextEncoder().encode(data));
  else ws.send(data);
}

async function main() {
  console.log("[investigate] base:", BASE);

  const created = await api("/api/sessions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ difficulty: "beginner" })
  });
  const sessionId = created.data.sessionId;
  console.log("[investigate] session:", sessionId);

  await api(`/api/sessions/${sessionId}/start`, { method: "POST" });
  await sleep(2000);

  const { ws, inbound, events } = await connectTerminal(sessionId);
  inbound.length = 0;
  events.length = 0;

  send(ws, "sleep 30\r");
  await sleep(800);

  const before = decodeOutput(inbound);
  console.log("[investigate] before ctrl+c bytes:", before.bytes.length);
  console.log("[investigate] before ctrl+c text:", JSON.stringify(before.text.slice(-120)));

  send(ws, new Uint8Array([0x03]));
  await sleep(300);
  await api(`/api/sessions/${sessionId}/terminal/interrupt`, { method: "POST" });
  await sleep(1500);

  const after = decodeOutput(inbound);
  console.log("[investigate] after ctrl+c bytes:", after.bytes.length);
  console.log("[investigate] after ctrl+c text:", JSON.stringify(after.text.slice(-200)));
  console.log("[investigate] contains ^C:", after.text.includes("^C"));
  console.log("[investigate] prompt returned:", /#\s*$|#\s/.test(after.text) || after.text.includes("# "));

  ws.close();

  const summary = {
    sessionId,
    sentSigint: true,
    outputAfterSigint: after.text.slice(-200),
    hasCaretC: after.text.includes("^C"),
    likelyInterrupted: after.text.includes("^C") && !after.text.includes("sleep 30")
  };
  console.log("[investigate] summary:", JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error("[investigate] failed:", error);
  process.exit(1);
});
