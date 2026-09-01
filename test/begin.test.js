import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { branchNameFor, defaultBranchOf, run } from "../src/beginCli.js";


/** 作業場と、その直下の対象リポジトリ。 */
function workspace(repos = ["agent-playground"]) {
  const root = mkdtempSync(join(tmpdir(), "autodrive-begin-"));
  for (const repo of repos) mkdirSync(join(root, repo, ".git"), { recursive: true });
  return root;
}

const item = {
  id: "AUT-99",
  title: "題",
  url: "https://example.invalid/AUT-99",
  body: "本文",
  state: "todo",
  repo: null,
};

/** 進めた先を記録する Tracker。 */
function fakeTracker(found = item) {
  const advanced = [];
  const marked = [];
  return {
    advanced,
    marked,
    async get() { return found; },
    async list() { return found === null ? [] : [found]; },
    async create() { return item; },
    async advance(id, to, repo) { advanced.push(`${id}:${to}:${repo ?? "-"}`); return { ...item, state: to }; },
    async mark(id, repo) { marked.push(`${id}:${repo}`); },
    async note() {},
  };
}

/** git の応答を差し替える。呼ばれた引数を残す。 */
function fakeGit(over = {}, fails = []) {
  const calls = [];
  const responses = {
    "branch --show-current": "main",
    "symbolic-ref --short refs/remotes/origin/HEAD": "origin/main",
    "status --short": "",
    "remote get-url origin": "git@github.com:me/agent-playground.git",
    ...over,
  };
  const git = ((_repoPath , args) => {
    calls.push(args);
    const key = args.join(" ");
    for (const f of fails) {
      if (key.startsWith(f)) throw new Error(`git ${key} が失敗`);
    }
    return responses[key] ?? "";
  });
  git.calls = calls;
  return git;
}

const marker = (root) =>
  JSON.parse(readFileSync(join(root, ".autodrive", "current-work-item.json"), "utf8"))


   ;

// ------------------------------------------------------------------ 枝の名前

test("枝の名前を省略すると、作業単位のIDから作る", () => {
  assert.equal(branchNameFor("AUT-99", undefined), "aut-99");
  assert.equal(branchNameFor("AUT-99", "  "), "aut-99");
  assert.equal(branchNameFor("AUT-99", "aut-99-begin"), "aut-99-begin");
});

// ------------------------------------------------------------ 既定ブランチ

// **手元の設定が無いことを異常としない。** git clone は origin/HEAD を置くが、
// git init から作った作業ツリーには無い。ここで落とすと着手できなくなる。
// AUT-53 で判定器に対して直したのと同じ型を、ここでも塞ぐ。
test("手元に設定が無ければ、引き直して補う", () => {
  let hasHead = false;
  const git = ((_p , args) => {
    if (args[0] === "symbolic-ref") {
      if (!hasHead) throw new Error("is not a symbolic ref");
      return "origin/main\n";
    }
    if (args[0] === "remote" && args[1] === "set-head") {
      hasHead = true;
      return "";
    }
    return "";
  });

  assert.equal(defaultBranchOf("/repo", git), "main");
  assert.equal(hasHead, true, "引き直していない");
});

test("引き直しても駄目なら null を返す。落とさない", () => {
  const git = (() => { throw new Error("引けない"); });
  assert.equal(defaultBranchOf("/repo", git), null);
});

test("手元に設定があれば、引き直さない", () => {
  const calls = [];
  const git = ((_p , args) => {
    calls.push(args);
    return "origin/main\n";
  });

  assert.equal(defaultBranchOf("/repo", git), "main");
  assert.equal(calls.some((a) => a[1] === "set-head"), false, "余計に引き直している");
});

// **落ちた理由が読み取れる形にする。** 何をすればよいかを出して止まる。
test("特定できなければ、直し方を出して止まる", async () => {
  const root = workspace();
  const git = fakeGit({}, ["symbolic-ref", "remote set-head"]);
  const { code, output } = await run(["AUT-99", "--repo", "agent-playground"], root, fakeTracker(), git);

  assert.equal(code, 1);
  assert.ok(output.includes("既定ブランチを特定できない"), output);
  assert.ok(output.includes("remote set-head"), `直し方を出していない: ${output}`);
});

// ------------------------------------------------------------------ 成功の道

test("3つをまとめて行う。枝を切り、状態を進め、マーカーを置く", async () => {
  const root = workspace();
  const tracker = fakeTracker();
  const git = fakeGit();

  const { code, output } = await run(["AUT-99", "--repo", "agent-playground"], root, tracker, git);

  assert.equal(code, 0);
  assert.ok(git.calls.some((a) => a.join(" ") === "checkout -b aut-99"), "枝を切っていない");
  assert.ok(git.calls.some((a) => a[0] === "pull"), "既定ブランチを最新にしていない");
  assert.deepEqual(tracker.advanced, ["AUT-99:started:agent-playground"]);
  assert.deepEqual(marker(root), { work_item_id: "AUT-99", repo: "agent-playground" });
  assert.ok(output.includes("aut-99"));
});

test("手元に残っている変更は、消さずに知らせる", async () => {
  const root = workspace();
  const git = fakeGit({ "status --short": " M telemetry/AUT-1.jsonl" });

  const { output } = await run(["AUT-99", "--repo", "agent-playground"], root, fakeTracker(), git);

  assert.ok(output.includes("手元の変更を枝へ持ってきた"), output);
  assert.ok(output.includes("telemetry/AUT-1.jsonl"), output);
});

// ------------------------------------------------------------------ 止まる道
//
// **止まることがこの入口の目的である。** どの前提が崩れたかと、何をすればよいかを
// 出さずに止まるなら、手で順に踏むのと変わらない。

test("起票されていなければ着手しない", async () => {
  const root = workspace();
  const tracker = fakeTracker(null);
  const git = fakeGit();

  const { code, output } = await run(["AUT-99", "--repo", "agent-playground"], root, tracker, git);

  assert.equal(code, 1);
  assert.ok(output.includes("起票してから着手する"), output);
  assert.equal(git.calls.length, 0, "止まるべきところで git を触っている");
  assert.equal(existsSync(join(root, ".autodrive", "current-work-item.json")), false);
});

// 実装によっては、存在しないIDで例外を投げる。**通信の失敗と同じ扱いにしない。**
// そのまま外へ出すと「Entity not found」だけが表示され、何をすればよいか伝わらない。
test("Tracker が例外で知らせてきても、案内は同じにする", async () => {
  const root = workspace();
  const tracker = fakeTracker();
  tracker.get = async () => { throw new Error("Entity not found: Issue"); };
  const git = fakeGit();

  const { code, output } = await run(["AUT-99", "--repo", "agent-playground"], root, tracker, git);

  assert.equal(code, 1);
  assert.ok(output.includes("起票してから着手する"), output);
  assert.equal(git.calls.length, 0);
});

test("Tracker を読めない場合は、見つからない場合と区別する", async () => {
  const root = workspace();
  const tracker = fakeTracker();
  tracker.get = async () => { throw new Error("fetch failed"); };

  const { code, output } = await run(["AUT-99", "--repo", "agent-playground"], root, tracker, fakeGit());

  assert.equal(code, 1);
  assert.ok(output.includes("Tracker を読めない"), output);
  assert.ok(!output.includes("起票してから"), `見つからない場合と同じ言葉になっている: ${output}`);
});

test("対象リポジトリが作業場に無ければ着手しない", async () => {
  const root = workspace();
  const git = fakeGit();

  const { code, output } = await run(["AUT-99", "--repo", "存在しない"], root, fakeTracker(), git);

  assert.equal(code, 1);
  assert.ok(output.includes("作業場に無い"), output);
  assert.equal(git.calls.length, 0);
});

// AUT-38 の再現。前の作業の枝の上から始めると、その提出が閉じている場合に変更が
// 既定ブランチへ届かない。
test("別の枝の上からは始めない", async () => {
  const root = workspace();
  const tracker = fakeTracker();
  const git = fakeGit({ "branch --show-current": "aut-98-前の作業" });

  const { code, output } = await run(["AUT-99", "--repo", "agent-playground"], root, tracker, git);

  assert.equal(code, 1);
  assert.ok(output.includes("aut-98-前の作業"), output);
  assert.ok(output.includes("checkout main"), `戻り方を案内していない: ${output}`);
  assert.ok(!git.calls.some((a) => a[0] === "checkout" && a[1] === "-b"), "枝を切ってしまっている");
  assert.deepEqual(tracker.advanced, [], "状態を進めてしまっている");
});

test("既定ブランチを最新にできなければ着手しない", async () => {
  const root = workspace();
  const tracker = fakeTracker();
  const git = fakeGit({}, ["pull"]);

  const { code, output } = await run(["AUT-99", "--repo", "agent-playground"], root, tracker, git);

  assert.equal(code, 1);
  assert.ok(output.includes("手元だけのコミット"), output);
  assert.deepEqual(tracker.advanced, []);
});

test("枝を作れなければ、状態もマーカーも動かさない", async () => {
  const root = workspace();
  const tracker = fakeTracker();
  const git = fakeGit({}, ["checkout -b"]);

  const { code, output } = await run(["AUT-99", "--repo", "agent-playground"], root, tracker, git);

  assert.equal(code, 1);
  assert.ok(output.includes("--branch"), `別名の渡し方を案内していない: ${output}`);
  assert.deepEqual(tracker.advanced, []);
  assert.equal(existsSync(join(root, ".autodrive", "current-work-item.json")), false);
});

test("対象リポジトリを渡さなければ着手しない", async () => {
  const root = workspace();
  const { code, output } = await run(["AUT-99"], root, fakeTracker(), fakeGit());

  assert.equal(code, 2);
  assert.ok(output.includes("--repo"), output);
});

// -------------------------------------------------------------- 対象リポジトリ

test("着手のとき、対象リポジトリを Tracker にも記す", async () => {
  // **手元のマーカーだけに書くと、一覧を見てもどのリポジトリの作業か分からない。**
  // 実際に、1つの対象へ4つのリポジトリの作業単位が混ざって読めなくなった（AUT-114）。
  const root = workspace();
  const tracker = fakeTracker();

  await run(["AUT-99", "--repo", "agent-playground"], root, tracker, fakeGit());

  assert.deepEqual(tracker.advanced, ["AUT-99:started:agent-playground"]);
  assert.equal(marker(root).repo, "agent-playground");
});

// ------------------------------------------------------------------ 片付け

/** 提出を返す Repo。 */
function fakeApi(submissions) {
  return {
    available: true,
    async submissionsIn() { return { status: 200, body: submissions }; },
  };
}

test("統合済みなのに着手中のままの作業単位を、着手のついでに閉じる", async () => {
  const root = workspace();
  const stale = { ...item, id: "AUT-1", state: "started" };
  const tracker = fakeTracker(item);
  tracker.list = async () => [item, stale];

  const { code, output } = await run(
    ["AUT-99", "--repo", "agent-playground"],
    root,
    tracker,
    fakeGit(),
    fakeApi([{ merged_at: "2026-08-30", head: { ref: "aut-1" }, title: "AUT-1" }]),
  );

  assert.equal(code, 0);
  assert.ok(tracker.advanced.includes("AUT-1:done:agent-playground"), tracker.advanced.join(","));
  assert.ok(output.includes("AUT-1"), `何を閉じたか出していない: ${output}`);
});

test("片付けに失敗しても、着手は成立する", async () => {
  // **片付けられないことを理由に着手できなくなるのは本末転倒である。**
  const root = workspace();
  const tracker = fakeTracker();
  const api = {
    available: true,
    async submissionsIn() { throw new Error("繋がらない"); },
  };

  const { code, output } = await run(
    ["AUT-99", "--repo", "agent-playground"], root, tracker, fakeGit(), api,
  );

  assert.equal(code, 0);
  assert.equal(marker(root).work_item_id, "AUT-99");
  // **ただし黙らない。**
  assert.ok(output.includes("繋がらない"), `失敗を黙っている: ${output}`);
});

test("Repo を読めなくても、着手は成立する", async () => {
  const root = workspace();
  const { code } = await run(["AUT-99", "--repo", "agent-playground"], root, fakeTracker(), fakeGit());
  assert.equal(code, 0);
});
