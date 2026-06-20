import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runUnlang } from "../../sandbox/bin/unlang.mjs";
import { injectFault, normalizeWorkspacePath } from "../../sandbox/bin/fault-injector.mjs";
import { runUnctl } from "../../sandbox/bin/unctl.mjs";
import { createFakeDbServer, handleCommand } from "../../sandbox/services/fake-db/server.mjs";
import { createUnyohApiServer, prepareWorkspace } from "../../sandbox/services/unyoh-api/server.mjs";

test("unlang evaluates valid programs and reports structured runtime errors", () => {
  assert.equal(
    runUnlang("うんちく sample\nうん x = 8\nうん y = 3\nうん！ ( x うんたす y ) うんかけ 2\n"),
    22
  );

  assert.throws(
    () => runUnlang("うん x = 100\nうん y = うんなし\nうん z = x うんわり y\nうん！ z\n"),
    (error) => {
      assert.equal(error.message, "うんともすんとも");
      assert.equal(error.code, "DIVISION_BY_ZERO");
      assert.equal(error.line, 3);
      assert.equal(error.column, 1);
      return true;
    }
  );
});

test("fault injector keeps targets inside the workspace and writes exact byte counts", async (t) => {
  const workspace = await tempWorkspace();
  t.after(() => rm(workspace, { recursive: true, force: true }));

  await injectFault("disk_full", ["logs/debug.log", "1500"], { workspace });
  assert.equal((await stat(path.join(workspace, "logs", "debug.log"))).size, 1500);

  await injectFault("disk_full", ["logs/debug.log", "7"], { workspace });
  assert.equal((await stat(path.join(workspace, "logs", "debug.log"))).size, 1507);

  assert.equal(normalizeWorkspacePath("logs/debug.log", workspace), path.join(workspace, "logs", "debug.log"));
  assert.throws(() => normalizeWorkspacePath(`${workspace}-escape/debug.log`, workspace), /inside workspace/);
  await assert.rejects(() => injectFault("disk_full", ["../escape.log", "1"], { workspace }), /inside workspace/);
});

test("unctl creates run state and reports api status transitions", async (t) => {
  const workspace = await tempWorkspace();
  t.after(() => rm(workspace, { recursive: true, force: true }));

  assert.equal(await runUnctl("status", "api", { workspace }), "api running");
  assert.equal(await runUnctl("stop", "api", { workspace }), "api stopped");
  assert.match(await readFile(path.join(workspace, "run", "api.down"), "utf8"), /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(await runUnctl("status", "api", { workspace }), "api stopped");
  assert.equal(await runUnctl("restart", "api", { workspace }), "api restarted");
  assert.equal(await runUnctl("status", "api", { workspace }), "api running");

  await assert.rejects(() => runUnctl("status", "db", { workspace }), /usage: unctl/);
});

test("unyoh-api reflects marker health, metrics, and access log statuses", async (t) => {
  const workspace = await tempWorkspace();
  t.after(() => rm(workspace, { recursive: true, force: true }));
  await prepareWorkspace(workspace);

  const server = createUnyohApiServer({ workspace });
  const baseUrl = await listenHttp(server);
  t.after(() => closeServer(server));

  let response = await fetch(`${baseUrl}/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });

  response = await fetch(`${baseUrl}/missing`);
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "not_found" });

  await mkdir(path.join(workspace, "run"), { recursive: true });
  await writeFile(path.join(workspace, "run", "api.down"), "");

  response = await fetch(`${baseUrl}/orders`);
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: "process marker says api is down" });

  response = await fetch(`${baseUrl}/metrics`);
  assert.equal(response.status, 200);
  const metrics = await response.json();
  assert.equal(metrics.http5xxRate, 0.35);
  assert.equal(metrics.dbConnections, 0);

  const accessLog = await readFile(path.join(workspace, "logs", "access.log"), "utf8");
  assert.match(accessLog, /GET \/health 200/);
  assert.match(accessLog, /GET \/missing 404/);
  assert.match(accessLog, /GET \/orders 500/);
  assert.match(accessLog, /GET \/metrics 200/);
});

test("fake-db answers basic health and query commands", async (t) => {
  assert.equal(handleCommand("PING"), "pong\n");
  assert.equal(handleCommand("select 1;"), "row 1\n");

  const server = createFakeDbServer();
  const address = await listenTcp(server);
  t.after(() => closeServer(server));

  const socket = net.createConnection(address);
  socket.setEncoding("utf8");
  const chunks = [];
  socket.on("data", (chunk) => chunks.push(chunk));

  await once(socket, "connect");
  socket.write("ping\nselect 1;\nquit\n");
  await once(socket, "end");

  assert.equal(chunks.join(""), "fake-db ready\npong\nrow 1\nbye\n");
});

async function tempWorkspace() {
  return mkdtemp(path.join(os.tmpdir(), "incident-sandbox-"));
}

async function listenHttp(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  return `http://${address.address}:${address.port}`;
}

async function listenTcp(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  return { host: address.address, port: address.port };
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
