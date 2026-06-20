import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { runUnlang } from "../../sandbox/bin/unlang.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const unlangCli = path.join(rootDir, "sandbox/bin/unlang.mjs");

test("unlang evaluates assignment, arithmetic, and return statements", () => {
  const result = runUnlang(`
うんちく nightly sales math
うん base = 6
うん divisor = 2
うん total = base うんわり divisor うんたす うんあり
うん！ total
`);

  assert.equal(result, 4);
});

test("unlang evaluator keeps internal error code while exposing vague message", () => {
  assert.throws(
    () =>
      runUnlang(`
うん x = 100
うん y = うんなし
うん！ x うんわり y
`),
    (error) => {
      assert.equal(error.message, "うんともすんとも");
      assert.equal(error.code, "DIVISION_BY_ZERO");
      assert.equal(error.line, 4);
      return true;
    }
  );
});

test("unlang CLI masks structured runtime errors from player-facing output", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "incident-unlang-"));
  const file = path.join(dir, "sales.un");

  try {
    await writeFile(
      file,
      "うん x = 100\nうん y = うんなし\nうん！ x うんわり y\n",
      "utf8"
    );
    const result = spawnSync(process.execPath, [unlangCli, "run", file], { encoding: "utf8" });

    assert.notEqual(result.status, 0);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "うんともすんとも\n");
    assert.doesNotMatch(result.stderr, /DIVISION_BY_ZERO|line|column|100|うんわり/u);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("unlang CLI check prints ok for valid source without the computed result", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "incident-unlang-"));
  const file = path.join(dir, "sales.un");

  try {
    await writeFile(file, "うん x = 3\nうん！ x うんたす 2\n", "utf8");
    const result = spawnSync(process.execPath, [unlangCli, "check", file], { encoding: "utf8" });

    assert.equal(result.status, 0);
    assert.equal(result.stdout, "ok\n");
    assert.equal(result.stderr, "");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
