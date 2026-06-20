import { spawn, exec as execCallback } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, readFile, rm, rename, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import net from "node:net";

const exec = promisify(execCallback);
const PORT = Number(process.env.PORT ?? 3000);
const processes = new Map();
const sessions = new Map();

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    if (request.method === "GET" && url.pathname === "/api/ping") {
      return json(response, { success: true, message: "pong", timestamp: timestamp() });
    }
    if (request.method === "GET" && url.pathname === "/api/version") {
      return json(response, { success: true, version: "incident-local", timestamp: timestamp() });
    }
    if (request.method === "GET" && url.pathname === "/api/commands") {
      const availableCommands = ["bash", "sh", "node", "npm", "test", "curl"];
      return json(response, { success: true, availableCommands, count: availableCommands.length, timestamp: timestamp() });
    }
    if (request.method === "POST" && url.pathname === "/api/session/create") {
      const body = await readJson(request);
      const id = String(body.id ?? "sandbox-default");
      sessions.set(id, { id, env: body.env ?? {}, cwd: body.cwd ?? "/workspace" });
      await mkdir(body.cwd ?? "/workspace", { recursive: true });
      return json(response, {
        success: true,
        id,
        message: "session ready",
        containerPlacementId: process.env.CLOUDFLARE_PLACEMENT_ID ?? null,
        timestamp: timestamp()
      });
    }
    if (request.method === "POST" && url.pathname === "/api/session/delete") {
      const body = await readJson(request);
      const sessionId = String(body.sessionId ?? "");
      sessions.delete(sessionId);
      return json(response, { success: true, sessionId, timestamp: timestamp() });
    }
    if (request.method === "POST" && url.pathname === "/api/write") {
      const body = await readJson(request);
      const path = safePath(body.path);
      await mkdir(dirname(path), { recursive: true });
      const content = body.encoding === "base64" ? Buffer.from(String(body.content ?? ""), "base64") : String(body.content ?? "");
      await writeFile(path, content);
      return json(response, { success: true, path: body.path, timestamp: timestamp(), exitCode: 0 });
    }
    if (request.method === "POST" && url.pathname === "/api/read") {
      const body = await readJson(request);
      const path = safePath(body.path);
      const data = await readFile(path, body.encoding === "base64" ? undefined : "utf8");
      return json(response, {
        success: true,
        path: body.path,
        content: body.encoding === "base64" ? Buffer.from(data).toString("base64") : data,
        timestamp: timestamp()
      });
    }
    if (request.method === "POST" && url.pathname === "/api/mkdir") {
      const body = await readJson(request);
      const path = safePath(body.path);
      await mkdir(path, { recursive: body.recursive ?? true });
      return json(response, { success: true, path: body.path, recursive: body.recursive ?? true, timestamp: timestamp(), exitCode: 0 });
    }
    if (request.method === "POST" && url.pathname === "/api/exists") {
      const body = await readJson(request);
      return json(response, { success: true, path: body.path, exists: existsSync(safePath(body.path)), timestamp: timestamp() });
    }
    if (request.method === "POST" && url.pathname === "/api/delete") {
      const body = await readJson(request);
      await rm(safePath(body.path), { recursive: true, force: true });
      return json(response, { success: true, path: body.path, timestamp: timestamp() });
    }
    if (request.method === "POST" && (url.pathname === "/api/rename" || url.pathname === "/api/move")) {
      const body = await readJson(request);
      const from = safePath(body.oldPath ?? body.sourcePath);
      const to = safePath(body.newPath ?? body.destinationPath);
      await mkdir(dirname(to), { recursive: true });
      await rename(from, to);
      return json(response, { success: true, path: body.newPath ?? body.destinationPath, timestamp: timestamp() });
    }
    if (request.method === "POST" && url.pathname === "/api/list-files") {
      return json(response, { success: true, files: [], timestamp: timestamp() });
    }
    if (request.method === "POST" && url.pathname === "/api/execute") {
      const body = await readJson(request);
      const result = await runCommand(body.command, body);
      return json(response, result);
    }
    if (request.method === "POST" && url.pathname === "/api/process/start") {
      const body = await readJson(request);
      const started = startProcess(body.command, body);
      return json(response, started);
    }
    if (request.method === "GET" && url.pathname === "/api/process/list") {
      return json(response, { success: true, processes: [...processes.values()].map(serializeProcess), timestamp: timestamp() });
    }
    const processMatch = url.pathname.match(/^\/api\/process\/([^/]+)(?:\/(logs|stream))?$/);
    if (processMatch) {
      const [, processId, action] = processMatch;
      const proc = processes.get(processId);
      if (!proc) return json(response, errorPayload("PROCESS_NOT_FOUND", `Process not found: ${processId}`, 404), 404);
      if (request.method === "DELETE") {
        proc.child.kill("SIGTERM");
        proc.status = "killed";
        proc.endTime = timestamp();
        return json(response, { success: true, processId, signal: "SIGTERM", timestamp: timestamp() });
      }
      if (request.method === "GET" && action === "logs") {
        return json(response, { success: true, processId, stdout: proc.stdout, stderr: proc.stderr, timestamp: timestamp() });
      }
      if (request.method === "GET" && action === "stream") {
        return sse(response, [{ type: "stdout", text: proc.stdout }, { type: "stderr", text: proc.stderr }, { type: "complete" }]);
      }
      if (request.method === "GET") return json(response, { success: true, process: serializeProcess(proc), timestamp: timestamp() });
    }
    if (request.method === "DELETE" && url.pathname === "/api/process/kill-all") {
      let killedCount = 0;
      for (const proc of processes.values()) {
        if (proc.status === "running" || proc.status === "starting") {
          proc.child.kill("SIGTERM");
          proc.status = "killed";
          proc.endTime = timestamp();
          killedCount += 1;
        }
      }
      return json(response, { success: true, killedCount, cleanedCount: 0, timestamp: timestamp() });
    }
    if (request.method === "POST" && url.pathname === "/api/port-watch") {
      const body = await readJson(request);
      return watchPort(response, body);
    }
    return json(response, errorPayload("NOT_FOUND", `No route for ${request.method} ${url.pathname}`, 404), 404);
  } catch (error) {
    return json(response, errorPayload("INTERNAL_ERROR", error instanceof Error ? error.message : String(error), 500), 500);
  }
});

server.listen(PORT, "0.0.0.0");

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  return text.length ? JSON.parse(text) : {};
}

function json(response, value, status = 200) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
}

function sse(response, events) {
  response.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive"
  });
  for (const event of events) response.write(`data: ${JSON.stringify(event)}\n\n`);
  response.end();
}

async function runCommand(command, body) {
  const started = Date.now();
  try {
    const { stdout, stderr } = await exec(String(command), {
      cwd: safeCwd(body.cwd),
      env: { ...process.env, ...(body.env ?? {}) },
      timeout: body.timeoutMs
    });
    return {
      success: true,
      exitCode: 0,
      stdout,
      stderr,
      command: String(command),
      duration: Date.now() - started,
      timestamp: new Date(started).toISOString(),
      sessionId: body.sessionId
    };
  } catch (error) {
    return {
      success: false,
      exitCode: typeof error.code === "number" ? error.code : 1,
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? error.message ?? "",
      command: String(command),
      duration: Date.now() - started,
      timestamp: new Date(started).toISOString(),
      sessionId: body.sessionId
    };
  }
}

function startProcess(command, body) {
  const processId = String(body.processId ?? `proc-${Date.now()}`);
  const startTime = timestamp();
  const child = spawn(String(command), {
    cwd: safeCwd(body.cwd),
    env: { ...process.env, ...(body.env ?? {}) },
    shell: true,
    stdio: ["ignore", "pipe", "pipe"]
  });
  const proc = {
    id: processId,
    pid: child.pid,
    command: String(command),
    child,
    status: "running",
    startTime,
    stdout: "",
    stderr: "",
    sessionId: body.sessionId
  };
  child.stdout.on("data", (chunk) => {
    proc.stdout += chunk.toString("utf8");
  });
  child.stderr.on("data", (chunk) => {
    proc.stderr += chunk.toString("utf8");
  });
  child.on("exit", (code) => {
    proc.exitCode = code ?? undefined;
    proc.endTime = timestamp();
    if (proc.status !== "killed") proc.status = code === 0 ? "completed" : "failed";
  });
  processes.set(processId, proc);
  return { success: true, processId, pid: child.pid, command: String(command), timestamp: startTime };
}

function serializeProcess(proc) {
  return {
    id: proc.id,
    pid: proc.pid,
    command: proc.command,
    status: proc.status,
    startTime: proc.startTime,
    endTime: proc.endTime,
    exitCode: proc.exitCode,
    sessionId: proc.sessionId
  };
}

function watchPort(response, body) {
  response.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive"
  });
  const timeoutAt = Date.now() + Number(body.timeout ?? 30_000);
  const interval = setInterval(async () => {
    const ready = await canConnect(Number(body.port));
    if (ready) {
      response.write(`data: ${JSON.stringify({ type: "ready", port: Number(body.port), timestamp: timestamp() })}\n\n`);
      clearInterval(interval);
      response.end();
    } else if (Date.now() > timeoutAt) {
      response.write(`data: ${JSON.stringify({ type: "timeout", port: Number(body.port), timestamp: timestamp() })}\n\n`);
      clearInterval(interval);
      response.end();
    } else {
      response.write(`data: ${JSON.stringify({ type: "checking", port: Number(body.port), timestamp: timestamp() })}\n\n`);
    }
  }, Number(body.interval ?? 500));
}

function canConnect(port) {
  return new Promise((resolveConnect) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    socket.setTimeout(500);
    socket.on("connect", () => {
      socket.destroy();
      resolveConnect(true);
    });
    socket.on("timeout", () => {
      socket.destroy();
      resolveConnect(false);
    });
    socket.on("error", () => resolveConnect(false));
  });
}

function safeCwd(value) {
  return value ? safePath(value) : "/workspace";
}

function safePath(value) {
  const path = resolve(String(value ?? "/workspace"));
  const allowed = ["/workspace", "/tmp"];
  if (!allowed.some((base) => path === base || path.startsWith(`${base}/`))) {
    throw new Error(`path outside sandbox workspace: ${value}`);
  }
  return path;
}

function timestamp() {
  return new Date().toISOString();
}

function errorPayload(code, message, status) {
  return { code, message, context: {}, httpStatus: status, timestamp: timestamp() };
}
