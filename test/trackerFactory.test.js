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
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { defaults, writeConfig } from "../src/vendored/internal/config.js";
import { createJudgingTracker, createTracker, createTrackerAt } from "../src/vendored/internal/ports/trackerFactory.js";
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

// **Linear の名前は読まない。** 実装が違う。
test("github-issues は、Linear の環境変数を読まない", () => {
  const { tracker, error } = createTracker(project(asGithub), { LINEAR_API_KEY: "k" }, slug);

  assert.equal(tracker, null);
  assert.match(error ?? "", /GH_TOKEN/);
});

// **同じ GitHub に対する書ける鍵を2つ求めない**（AUT-235）。どちらもエージェントが
// 自分の作業のために持つものであり、分けても守れるものが増えない。
test("GH_TOKEN があれば、作業単位の鍵は要らない", () => {
  const { tracker, error } = createTracker(project(asGithub), { GH_TOKEN: "g" }, slug);

  assert.equal(error, null, error ?? "");
  assert.notEqual(tracker, null);
});

// **分けたい人は分けられる。** 既に設定した先が壊れない。
test("作業単位の鍵があれば、そちらを使う", () => {
  const { tracker, error } = createTracker(
    project(asGithub),
    { AUTODRIVE_TRACKER_TOKEN: "t", GH_TOKEN: "g" },
    slug,
  );

  assert.equal(error, null);
  assert.notEqual(tracker, null);
});

// **判定用の鍵では動かない。** 読むだけの鍵であり、兼ねると分離が消える（定義§9）。
test("判定用の鍵は、作業単位の鍵として使わない", () => {
  const { tracker, error } = createTracker(project(asGithub), { AUTODRIVE_CI_TOKEN: "c" }, slug);

  assert.equal(tracker, null, "判定用の鍵で組み立てている");
  assert.match(error ?? "", /GH_TOKEN/);
});

// **どちらも無ければ、両方の名前を言う。** 片方しか言わないと、もう片方で
// 足りることが分からない。
test("どちらも無ければ、両方の名前を言う", () => {
  const { error } = createTracker(project(asGithub), {}, slug);

  assert.match(error ?? "", /AUTODRIVE_TRACKER_TOKEN/);
  assert.match(error ?? "", /GH_TOKEN/);
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


// ------------------------------------------------------------ 判定のための照合先（AUT-277）

/** 判定対象のリポジトリ。構成を置き、起点のリモートを返す。 */
function judged(name, over, where = `o/${name}`) {
  const root = over === undefined ? tempDir(`autodrive-judging-${name}-`) : project(over);
  return { path: root, name, remoteSlug: () => where };
}

/**
 * 通信を差し替える。**Linear と GitHub で、それぞれ1件ずつ返す。**
 * GitHub はリポジトリごとに違う番号を返し、どこを読んだかを確かめられるようにする。
 */
async function withServices(run) {
  const original = globalThis.fetch;
  const asked = [];
  globalThis.fetch = async (url, init = {}) => {
    asked.push(String(url));
    const json = (body) => new Response(JSON.stringify(body), { status: 200 });
    if (String(url).includes("linear")) {
      const { query } = JSON.parse(String(init.body));
      if (query.includes("teams")) return json({ data: { teams: { nodes: [{ id: "t", key: "AUT" }] } } });
      return json({
        data: {
          team: {
            issues: {
              nodes: [{ identifier: "AUT-1", title: "", url: "", state: { type: "completed" }, labels: { nodes: [] } }],
              pageInfo: { hasNextPage: false },
            },
          },
        },
      });
    }
    const number = String(url).includes("/o/b/") ? 7 : 3;
    return json([{ number, title: "", html_url: "", state: "open", labels: [] }]);
  };
  try {
    return await run(asked);
  } finally {
    globalThis.fetch = original;
  }
}

const github = (prefix, previous) => (c) => ({
  ...c,
  ports: { ...c.ports, tracker: "github-issues" },
  tracker: { prefix, ...(previous === undefined ? {} : { previous }) },
});

const keys = { LINEAR_API_KEY: "k", AUTODRIVE_CI_TOKEN: "ci" };

test("判定の照合先は、リポジトリごとの構成で組み立て、束ねた一覧で照合する", async () => {
  const repos = [judged("a", github("ADK")), judged("b", github("AGP"))];

  const { tracker, error, sources } = createJudgingTracker(repos, keys);

  assert.equal(error, null);
  assert.deepEqual(sources, ["github-issues (o/a)", "github-issues (o/b)"]);
  const ids = await withServices(async () => (await tracker.list()).map((i) => i.id));
  assert.deepEqual(ids.sort(), ["ADK-3", "AGP-7"]);
});

// **差し替える前の記録は、以前の作業単位IDを指している。** 照合先から外すと、
// それらがすべて「実在しない」になる。
test("tracker.previous に書かれた実装も、照合先に加える", async () => {
  const repos = [judged("a", github("ADK", ["linear"]))];

  const { tracker, sources } = createJudgingTracker(repos, keys);

  assert.deepEqual(sources, ["github-issues (o/a)", "linear"]);
  const ids = await withServices(async () => (await tracker.list()).map((i) => i.id));
  assert.deepEqual(ids.sort(), ["ADK-3", "AUT-1"]);
});

test("同じ実装を指すリポジトリが複数あっても、linear は一度だけ読む", async () => {
  const repos = [judged("a"), judged("b"), judged("c", github("ADK", ["linear"]))];

  const { tracker, sources } = createJudgingTracker(repos, keys);

  assert.deepEqual(sources, ["linear", "github-issues (o/c)"]);
  await withServices(async (asked) => {
    const items = await tracker.list();
    assert.equal(items.filter((i) => i.id === "AUT-1").length, 1);
    assert.ok(asked.length > 0);
  });
});

/** GitHub Issues を読むときに、どの鍵を送ったか。 */
async function keyUsed(tracker) {
  const original = globalThis.fetch;
  let sent = null;
  globalThis.fetch = async (_url, init = {}) => {
    sent = init.headers?.Authorization ?? null;
    return new Response(JSON.stringify([]), { status: 200 });
  };
  try {
    await tracker.list();
    return sent;
  } finally {
    globalThis.fetch = original;
  }
}

// **CI では読むだけの鍵、手元ではエージェントの鍵で読む**（ADK-144）。手元で鍵を
// 分けても守れるものが無い。信頼できる判定は CI で打つ（ADK-143）。
test("GitHub Issues は、CI の鍵があればそれで、無ければエージェントの鍵で読む", async () => {
  const repos = [judged("a", github("ADK"))];

  const inCi = createJudgingTracker(repos, { AUTODRIVE_CI_TOKEN: "ci", GH_TOKEN: "w" });
  assert.equal(await keyUsed(inCi.tracker), "Bearer ci");

  const byHand = createJudgingTracker(repos, { GH_TOKEN: "w" });
  assert.equal(await keyUsed(byHand.tracker), "Bearer w");
});

test("GitHub Issues を読む鍵が1つも無ければ、組み立てずに名前を言う", () => {
  const repos = [judged("a", github("ADK"))];

  const { tracker, error } = createJudgingTracker(repos, {});

  assert.equal(tracker, null);
  assert.match(error ?? "", /AUTODRIVE_CI_TOKEN.*GH_TOKEN/);
});

// **欠けた照合先は、実在する作業単位を実在しないと言う。**
test("組み立てられない照合先が1つでもあれば、全体を組み立てない", () => {
  const repos = [judged("a", github("ADK", ["linear"]))];

  const { tracker, error } = createJudgingTracker(repos, { AUTODRIVE_CI_TOKEN: "ci" });

  assert.equal(tracker, null);
  assert.match(error ?? "", /LINEAR_API_KEY/);
});

test("tracker.previous に知らない実装が書かれていれば、構成の誤りとして止まる", () => {
  const repos = [judged("a", github("ADK", ["jira"]))];

  const { tracker, error } = createJudgingTracker(repos, keys);

  assert.equal(tracker, null);
  assert.match(error ?? "", /tracker\.previous/);
});

// ------------------------------------------------------------ 操作の対象から組み立てる（AUT-278）

/**
 * 複数のリポジトリを並べた作業場。**起点は作業場そのものであり、対象ではない。**
 * 各リポジトリは origin を持つ（GitHub Issues の置き場所を読むため）。
 */
function workspace({ root = (c) => c, children = {} } = {}) {
  const base = tempDir("autodrive-workspace-");
  const init = (path, name, over) => {
    mkdirSync(path, { recursive: true });
    execFileSync("git", ["init", "-q", path]);
    execFileSync("git", ["-C", path, "remote", "add", "origin", `git@github.com:o/${name}.git`]);
    if (over !== null) writeConfig(path, over(defaults()));
  };
  init(base, "work", root);
  for (const [name, over] of Object.entries(children)) init(join(base, name), name, over);
  return base;
}

/** どこへ問い合わせたかを返す。 */
async function askedBy(tracker, id) {
  const original = globalThis.fetch;
  const asked = [];
  globalThis.fetch = async (url, init = {}) => {
    asked.push(String(url).includes("linear") ? "linear" : String(url).replace("https://api.github.com/", ""));
    if (String(url).includes("linear")) {
      return new Response(JSON.stringify({ data: { issue: null } }), { status: 200 });
    }
    return new Response(JSON.stringify({ number: 3, title: "", html_url: "", state: "open", labels: [] }), {
      status: 200,
    });
  };
  try {
    await tracker.get(id);
    return asked;
  } finally {
    globalThis.fetch = original;
  }
}

const both = { LINEAR_API_KEY: "k", GH_TOKEN: "w" };

test("作業単位IDの接頭辞が一致するリポジトリの Tracker で組み立てる", async () => {
  const root = workspace({ root: null, children: { kit: github("ADK"), play: github("AGP") } });

  const { tracker, error } = createTrackerAt(root, { id: "AGP-3" }, both);

  assert.equal(error, null);
  assert.deepEqual(await askedBy(tracker, "AGP-3"), ["repos/o/play/issues/3"]);
});

// **起点の構成で組み立てると、起点の Issues を探して見つからない。** これが直したこと。
test("起点が GitHub Issues でも、別のリポジトリの作業単位はそのリポジトリで探す", async () => {
  const root = workspace({ root: github("ADW"), children: { kit: github("ADK") } });

  const { tracker } = createTrackerAt(root, { id: "ADK-3" }, both);

  assert.deepEqual(await askedBy(tracker, "ADK-3"), ["repos/o/kit/issues/3"]);
});

test("接頭辞に一致しない ID は、起点が linear ならそのまま linear で扱う", () => {
  const root = workspace({ root: null, children: { kit: github("ADK") } });

  const { implementation, error } = createTrackerAt(root, { id: "AUT-5" }, both);

  assert.equal(error, null);
  assert.equal(implementation, "linear");
});

// **差し替える前の作業単位を閉じる道を残す。**
test("起点が切り替わっていても、linear を使っていた構成があれば linear で扱う", () => {
  const root = workspace({ root: github("ADW", ["linear"]) });

  const { implementation, error } = createTrackerAt(root, { id: "AUT-5" }, both);

  assert.equal(error, null);
  assert.equal(implementation, "linear");
});

test("どのリポジトリの作業単位か決められなければ、起点に倒さず止まる", () => {
  const root = workspace({ root: github("ADW"), children: { kit: github("ADK") } });

  const { tracker, error } = createTrackerAt(root, { id: "AUT-5" }, both);

  assert.equal(tracker, null);
  assert.match(error ?? "", /AUT-5/);
  assert.match(error ?? "", /ADW, ADK|ADK, ADW/);
});

test("ID が無ければ、--repo のリポジトリへ起票する", async () => {
  const root = workspace({ root: github("ADW"), children: { kit: github("ADK") } });

  const { tracker } = createTrackerAt(root, { repo: "kit" }, both);

  assert.deepEqual(await askedBy(tracker, "ADK-3"), ["repos/o/kit/issues/3"]);
});

test("--repo が作業場に無ければ、そう言って止まる", () => {
  const root = workspace();

  const { tracker, error } = createTrackerAt(root, { repo: "nowhere" }, both);

  assert.equal(tracker, null);
  assert.match(error ?? "", /nowhere/);
});

test("ID も --repo も無ければ、起点の構成で組み立てる", async () => {
  const root = workspace({ root: github("ADW"), children: { kit: github("ADK") } });

  const { tracker } = createTrackerAt(root, {}, both);

  assert.deepEqual(await askedBy(tracker, "ADW-3"), ["repos/o/work/issues/3"]);
});

// ------------------------------------------------------------ プロジェクト（ADK-134）

// **書いたのに効かないと、書いた人からは効いているように見える。**
test("linear 以外で tracker.project が書かれていれば、組み立てずに止まる", () => {
  const root = project((c) => ({ ...asGithub(c), tracker: { prefix: "AIEP", project: "認証" } }));

  const { tracker, error } = createTracker(root, { GH_TOKEN: "w" }, slug);

  assert.equal(tracker, null);
  assert.match(error ?? "", /tracker\.project.*linear/);
});

test("tracker.project が名前でなければ、構成の誤りとして止まる", () => {
  const root = project((c) => ({ ...c, tracker: { prefix: null, project: "" } }));

  const { tracker } = createTracker(root, { LINEAR_API_KEY: "k" }, slug);

  assert.equal(tracker, null);
});

test("linear で tracker.project が書かれていれば、起票をそのプロジェクトへ紐づける", async () => {
  const root = project((c) => ({ ...c, tracker: { prefix: null, project: "認証" } }));
  const { tracker } = createTracker(root, { LINEAR_API_KEY: "k" }, slug);

  const original = globalThis.fetch;
  const sent = [];
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init.body));
    sent.push(body);
    const data = body.query.includes("teams {")
      ? { teams: { nodes: [{ id: "t", key: "AUT" }] } }
      : body.query.includes("projects(")
        ? { team: { projects: { nodes: [{ id: "p1", name: "認証", slugId: "auth" }] } } }
        : { issueCreate: { issue: { identifier: "AUT-1", title: "", url: "", state: { type: "backlog" }, labels: { nodes: [] } } } };
    return new Response(JSON.stringify({ data }), { status: 200 });
  };
  try {
    await tracker.create({ title: "題", body: "本文" });
  } finally {
    globalThis.fetch = original;
  }
  assert.equal(sent.find((b) => b.query.includes("issueCreate"))?.variables.p, "p1");
});
