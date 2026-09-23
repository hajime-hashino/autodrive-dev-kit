/**
 * 構成に書かれた実装で Tracker を組み立てる口。
 *
 * **これが無かったため、`ports.tracker` はどこからも読まれていなかった**（AUT-234）。
 * 実装を選んだつもりでも選べておらず、Linear が4箇所で直に new されていた。
 *
 * **組み立てられない理由を見分けること**が、ここの仕事の半分である。資格情報が
 * 無いのか、構成が欠けているのか、対象が読めないのかで、人がやることが違う。
 */

import assert from "node:assert/strict";
import { mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { defaults, writeConfig } from "../src/vendored/internal/config.js";
import { createTracker } from "../src/vendored/internal/ports/trackerFactory.js";
import { tempDir } from "./helpers/tmp.js";

/** 構成を置いた起点。 */
function project(over = (c) => c) {
  const root = tempDir("autodrive-trackerfactory-");
  mkdirSync(join(root, ".git"), { recursive: true });
  writeConfig(root, over(defaults()));
  return root;
}

const slug = () => "o/r";

// ------------------------------------------------------------ linear

test("構成が linear なら、Linear で組み立てる", () => {
  const { tracker, error, implementation } = createTracker(project(), { LINEAR_API_KEY: "k" }, slug);

  assert.equal(implementation, "linear");
  assert.equal(error, null);
  assert.notEqual(tracker, null);
});

// **`init` を打っていない作業場がある。** 既定を変えると、そこが黙って止まる。
test("構成が無ければ、linear として組み立てる", () => {
  const root = tempDir("autodrive-trackerfactory-none-");
  const { implementation, error } = createTracker(root, { LINEAR_API_KEY: "k" }, slug);

  assert.equal(implementation, "linear");
  assert.equal(error, null);
});

test("linear の資格情報が無ければ、その名前を言う", () => {
  const { tracker, error } = createTracker(project(), {}, slug);

  assert.equal(tracker, null);
  assert.match(error ?? "", /LINEAR_API_KEY/);
});

// ------------------------------------------------------------ github-issues

const asGithub = (c) => ({ ...c, ports: { ...c.ports, tracker: "github-issues" }, tracker: { prefix: "AIEP" } });

test("構成が github-issues なら、GitHub Issues で組み立てる", () => {
  const { tracker, error, implementation } = createTracker(
    project(asGithub),
    { AUTODRIVE_TRACKER_TOKEN: "t" },
    slug,
  );

  assert.equal(implementation, "github-issues");
  assert.equal(error, null);
  assert.notEqual(tracker, null);
});

// **Linear の名前を使い回さない。** 片方を絞れなくなる。
test("github-issues は、別の環境変数を読む", () => {
  const { tracker, error } = createTracker(project(asGithub), { LINEAR_API_KEY: "k" }, slug);

  assert.equal(tracker, null);
  assert.match(error ?? "", /AUTODRIVE_TRACKER_TOKEN/);
});

// **接頭辞が無ければ、識別子を作れない。** 黙って番号だけで進めない。
test("接頭辞が無ければ、決めよと言う", () => {
  const root = project((c) => ({ ...c, ports: { ...c.ports, tracker: "github-issues" } }));
  const { tracker, error } = createTracker(root, { AUTODRIVE_TRACKER_TOKEN: "t" }, slug);

  assert.equal(tracker, null);
  assert.match(error ?? "", /tracker\.prefix/);
  // **直し方まで出す。**
  assert.match(error ?? "", /apply/);
});

test("対象を読めなければ、リモートを確かめよと言う", () => {
  const { tracker, error } = createTracker(
    project(asGithub),
    { AUTODRIVE_TRACKER_TOKEN: "t" },
    () => null,
  );

  assert.equal(tracker, null);
  assert.match(error ?? "", /origin/);
});

// ------------------------------------------------------------ 知らない実装

// **知らない名前で黙って linear に倒れない。** 選んだものと動くものが食い違う。
test("知らない実装は、そう言って止まる", () => {
  const root = project((c) => ({ ...c, ports: { ...c.ports, tracker: "jira" } }));
  const { tracker, error } = createTracker(root, { LINEAR_API_KEY: "k" }, slug);

  assert.equal(tracker, null);
  assert.match(error ?? "", /jira/);
});

// ------------------------------------------------------------ 呼び出し側

// **実装名が、アダプタの外に出ていないこと**（定義§16）。
test("実装名を知るのは、アダプタとこの口だけ", () => {
  const offenders = [];
  const root = new URL("../src/vendored/internal/", import.meta.url).pathname;
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(path);
        continue;
      }
      if (!entry.name.endsWith(".js")) continue;
      // アダプタ自身と、組み立てる口は実装名を知ってよい。
      if (path.includes("/adapters/") || entry.name === "trackerFactory.js") continue;
      // 構成の選択肢と、実装ごとの表は名前で引く。
      if (["config.js", "sandbox.js", "credentials.js", "messages.js"].includes(entry.name)) continue;
      if (/LinearTracker|GithubIssuesTracker/.test(readFileSync(path, "utf8"))) {
        offenders.push(path.slice(root.length));
      }
    }
  };
  walk(root);

  assert.deepEqual(offenders, [], "アダプタの外で実装を直に組み立てている");
});

