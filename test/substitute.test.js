import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { run } from "../src/main.js";
import { tempDir } from "./helpers/tmp.js";

/** 作業単位に紐づき、記録の仕掛けが登録されたリポジトリを1つ作る。 */
function workspace() {
  const root = tempDir("autodrive-sub-");
  mkdirSync(join(root, ".git"), { recursive: true });
  mkdirSync(join(root, ".autodrive"), { recursive: true });
  mkdirSync(join(root, ".claude"), { recursive: true });
  writeFileSync(
    join(root, ".claude", "settings.json"),
    JSON.stringify({ hooks: { Stop: [{ hooks: [{ command: "k/hooks/record-tokens" }] }] } }),
    "utf8",
  );
  writeFileSync(
    join(root, ".autodrive", "current-work-item.json"),
    JSON.stringify({ work_item_id: "AUT-25", repo: join(root).split("/").at(-1) }),
    "utf8",
  );
  writeFileSync(
    join(root, ".autodrive", "session.json"),
    JSON.stringify({ session_id: "s", last_model: "claude-opus-5", updated: "2026-08-22T00:00:00Z" }),
    "utf8",
  );
  return root;
}

function events(root) {
  const path = join(root, "telemetry", "AUT-25.jsonl");
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l) );
}

test("代替を記録すると、アダプタ経由で書かれる", async () => {
  const root = workspace();
  const res = await run([
    "--substitute", "boundary_change_logged",
    "--by", "human", "--detail", "境界表は段階3で置く", "--root", root,
  ]);
  assert.equal(res.code, 0);
  const [event] = events(root);
  assert.equal(event.type, "substitution");
  assert.equal(event.invariant, "boundary_change_logged");
  assert.equal(event.substituted_by, "human");
  assert.equal(event.emitter, "adapter");
  assert.equal(event.work_item_id, "AUT-25");
});

test("知らない不変条件は受け付けない", async () => {
  const root = workspace();
  const res = await run(["--substitute", "なにか", "--by", "x", "--detail", "y", "--root", root]);
  assert.equal(res.code, 2);
  assert.equal(events(root).length, 0);
});

test("何が代替しているかを省略できない", async () => {
  const root = workspace();
  const res = await run([
    "--substitute", "boundary_change_logged", "--detail", "y", "--root", root,
  ]);
  assert.equal(res.code, 2);
  assert.equal(events(root).length, 0);
});

test("内容を省略できない", async () => {
  const root = workspace();
  const res = await run([
    "--substitute", "boundary_change_logged", "--by", "human", "--root", root,
  ]);
  assert.equal(res.code, 2);
});

test("作業単位に紐づかなければ記録しない", async () => {
  const root = workspace();
  writeFileSync(join(root, ".autodrive", "current-work-item.json"), "{}", "utf8");
  const res = await run([
    "--substitute", "boundary_change_logged", "--by", "human", "--detail", "d", "--root", root,
  ]);
  assert.equal(res.code, 1);
});
