import assert from "node:assert/strict";
import { mkdirSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { branchNameFor, defaultBranchOf, placeState, run } from "../src/vendored/internal/beginCli.js";
import { STATE_DIR, defaultRoot, rememberBranch, resolveWorkItem } from "../src/vendored/internal/workItem.js";
import { tempDir } from "./helpers/tmp.js";


/** ワークディレクトリと、その直下の対象リポジトリ。 */
function workspace(repos = ["agent-playground"]) {
  const root = tempDir("autodrive-begin-");
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

// ------------------------------------------------------------------ ブランチ名

test("ブランチ名を省略すると、作業単位のIDから作る", () => {
  assert.equal(branchNameFor("AUT-99", undefined), "aut-99");
  assert.equal(branchNameFor("AUT-99", "  "), "aut-99");
  assert.equal(branchNameFor("AUT-99", "aut-99-begin"), "aut-99-begin");
});

// ------------------------------------------------------------ 既定ブランチ

// **手元の設定が無いことを異常としない。** git clone は origin/HEAD を置くが、
// git init から作った作業ツリーには無い。ここで落とすと着手できなくなる。
// AUT-53 で`invariants` に対して直したのと同じ型を、ここでも塞ぐ。
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

test("3つをまとめて行う。ブランチを作り、状態を進め、マーカーを置く", async () => {
  const root = workspace();
  const tracker = fakeTracker();
  const git = fakeGit();

  const { code, output } = await run(["AUT-99", "--repo", "agent-playground"], root, tracker, git);

  assert.equal(code, 0);
  assert.ok(git.calls.some((a) => a.join(" ") === "checkout -b aut-99"), "ブランチを作っていない");
  assert.ok(git.calls.some((a) => a[0] === "pull"), "既定ブランチを最新にしていない");
  assert.deepEqual(tracker.advanced, ["AUT-99:started:agent-playground"]);
  assert.deepEqual(marker(root), { work_item_id: "AUT-99", repo: "agent-playground" });
  assert.ok(output.includes("aut-99"));
});

test("手元に残っている変更は、消さずに知らせる", async () => {
  const root = workspace();
  const git = fakeGit({ "status --short": " M telemetry/AUT-1.jsonl" });

  const { output } = await run(["AUT-99", "--repo", "agent-playground"], root, fakeTracker(), git);

  assert.ok(output.includes("手元の変更をブランチへ持ってきた"), output);
  assert.ok(output.includes("telemetry/AUT-1.jsonl"), output);
});

// ------------------------------------------------- 取り残された記録（AUT-162）
//
// **以前はここで拾ってコミットしていた。** それは別の作業単位の記録を、いま着手した
// 作業単位の提出に載せる形だった。いまは言うだけにする。

test("取り残された記録があっても、コミットしない", async () => {
  const root = workspace();
  const git = fakeGit({ "status --porcelain -uall": " M telemetry/AUT-98.jsonl" });

  const { output } = await run(["AUT-99", "--repo", "agent-playground"], root, fakeTracker(), git);

  assert.equal(git.calls.some((a) => a[0] === "commit"), false, `拾ってコミットしている: ${output}`);
  assert.ok(output.includes("取り残された記録がある"), output);
  assert.ok(output.includes("telemetry/AUT-98.jsonl"), output);
});

test("取り残しが無ければ、何も言わない", async () => {
  const root = workspace();
  const git = fakeGit();

  const { output } = await run(["AUT-99", "--repo", "agent-playground"], root, fakeTracker(), git);

  assert.equal(git.calls.some((a) => a[0] === "commit"), false, "拾うものが無いのにコミットした");
  assert.equal(output.includes("取り残された記録"), false, output);
});

// **他のリポジトリの取り残しは拾えないが、黙らない。** 測った時点で4つとも残って
// いた。そのリポジトリで次の作業が起きるまで、誰も知らないままになる。
test("他のリポジトリの取り残しを、知らせる", async () => {
  const root = workspace(["agent-playground", "autodrive-dev-work"]);
  const git = fakeGit({ "status --porcelain -uall": " M telemetry/AUT-98.jsonl" });

  const { output } = await run(["AUT-99", "--repo", "agent-playground"], root, fakeTracker(), git);

  assert.ok(output.includes("他のリポジトリに、取り残された記録がある"), output);
  assert.ok(output.includes("autodrive-dev-work"), output);
  // **対象リポジトリを、他のリポジトリとして二重に出さない。**
  assert.equal(
    output.split("他のリポジトリに")[1].includes("agent-playground"),
    false,
    `対象リポジトリを他のリポジトリとして並べている: ${output}`,
  );
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

test("対象リポジトリがワークディレクトリに無ければ着手しない", async () => {
  const root = workspace();
  const git = fakeGit();

  const { code, output } = await run(["AUT-99", "--repo", "存在しない"], root, fakeTracker(), git);

  assert.equal(code, 1);
  assert.ok(output.includes("ワークディレクトリに無い"), output);
  assert.equal(git.calls.length, 0);
});

// AUT-38 の再現。前の作業のブランチの上から始めると、その提出が閉じている場合に変更が
// 既定ブランチへ届かない。
test("別のブランチの上からは始めない", async () => {
  const root = workspace();
  const tracker = fakeTracker();
  const git = fakeGit({ "branch --show-current": "aut-98-前の作業" });

  const { code, output } = await run(["AUT-99", "--repo", "agent-playground"], root, tracker, git);

  assert.equal(code, 1);
  assert.ok(output.includes("aut-98-前の作業"), output);
  assert.ok(output.includes("checkout main"), `戻り方を案内していない: ${output}`);
  // **先に既定ブランチを進める案内であること。** 進めずに切り替えると、統合済みの
  // 記録と手元の記録が食い違い、未コミットの追記があると切り替えられない。
  // トークン消費の記録は提出のあとにも届くため、これは毎回起きる（AUT-118）。
  assert.ok(
    output.includes("fetch origin main:main"),
    `古い既定ブランチへの切り替えを勧めている: ${output}`,
  );
  assert.ok(
    output.indexOf("fetch origin main:main") < output.indexOf("checkout main"),
    `進めるより先に切り替えさせている: ${output}`,
  );
  assert.ok(!git.calls.some((a) => a[0] === "checkout" && a[1] === "-b"), "ブランチを作ってしまっている");
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

test("ブランチを作れなければ、状態もマーカーも動かさない", async () => {
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

test("着手は、他の作業単位を完了させない", async () => {
  // **完了は Tracker と Repo の連携が動かす**（ADR 0007）。着手のついでに閉じる形は、
  // 着手するリポジトリ1つ分しか見ず、4リポジトリを渡り歩くと取り残した（AUT-165）。
  //
  // 戻すなら、まず「なぜ連携では届かないか」を先に示すこと。
  const root = workspace();
  const stale = { ...item, id: "AUT-1", state: "started" };
  const tracker = fakeTracker(item);
  tracker.list = async () => [item, stale];

  const { code } = await run(["AUT-99", "--repo", "agent-playground"], root, tracker, fakeGit());

  assert.equal(code, 0);
  assert.equal(marker(root).work_item_id, "AUT-99");
  const closed = tracker.advanced.filter((a) => a.includes(":done"));
  assert.deepEqual(closed, [], `着手が完了へ動かしている: ${closed.join(",")}`);
});

// **ブランチと作業単位の対応を残すこと**（AUT-172）。マーカーは次の着手で
// 入れ替わるが、ブランチは残る。戻って書いた記録が正しい先へ向かうために要る。
test("着手のときに、ブランチと作業単位の対応を書き残す", async () => {
  const root = workspace();
  await run(["AUT-99", "--repo", "agent-playground"], root, fakeTracker(), fakeGit());

  const map = JSON.parse(
    readFileSync(join(root, ".autodrive", "work-items.json"), "utf8"),
  );
  assert.equal(map["agent-playground/aut-99"]?.work_item_id, "AUT-99");
});

test("前の作業単位の対応を、消さずに足す", async () => {
  const root = workspace();
  // 先に前の作業単位の対応があるところへ、次の着手を重ねる
  rememberBranch(root, "agent-playground", "aut-98", "AUT-98");
  await run(["AUT-99", "--repo", "agent-playground"], root, fakeTracker(), fakeGit());

  const map = JSON.parse(
    readFileSync(join(root, ".autodrive", "work-items.json"), "utf8"),
  );
  // **消すと、前のブランチへ戻って書いた記録が迷子になる。** それがこの表の目的。
  assert.equal(map["agent-playground/aut-98"]?.work_item_id, "AUT-98", "前の対応が消えている");
  assert.equal(map["agent-playground/aut-99"]?.work_item_id, "AUT-99");
});

// ------------------------------- 作業状態は、記録を読む側と同じ場所へ置く（AUT-221）
//
// **起点は `.autodrive` を探し上げて決まる。** したがって対象リポジトリが自分の
// `.autodrive` を持っていると、そこで止まる。
//
// 作業場のルートから `begin <ID> --repo <子>` を打つと、以前は作業場側にしか
// 置かれなかった。そのあと子の中から記録を打つと、**子の古いマーカーへ落ちた。**
// **実際に、完了済みの作業単位へ記録が入り、そのまま提出に載った。**

test("着手すると、子の中から打っても正しい作業単位に解決する", () => {
  const root = tempDir("autodrive-state-");
  const repoPath = join(root, "child");
  mkdirSync(join(root, STATE_DIR), { recursive: true });
  mkdirSync(repoPath, { recursive: true });
  // **コミットを作らない。** 作ると git の身元設定が要り、CI で落ちる。
  // ここが見るのはブランチ名だけで、履歴は要らない。
  execFileSync("git", ["-C", repoPath, "init", "-q", "-b", "aut-999"], { stdio: "ignore" });

  // **子が自分の状態を持っていて、しかも古い。** これが再現の条件である。
  mkdirSync(join(repoPath, STATE_DIR), { recursive: true });
  writeFileSync(
    join(repoPath, STATE_DIR, "current-work-item.json"),
    JSON.stringify({ work_item_id: "AUT-111", repo: "child" }),
    "utf8",
  );

  placeState(root, repoPath, "child", "aut-999", "AUT-999");

  // **どちらから打っても同じ答えになること。**
  for (const cwd of [repoPath, root]) {
    const at = defaultRoot({}, cwd);
    const { item } = resolveWorkItem(at, cwd);
    assert.notEqual(item, null, `${cwd} から解決できていない`);
    assert.equal(item.workItemId, "AUT-999", `${cwd} で古いマーカーへ落ちている`);
  }
});

// **子が状態を持たない場合も壊さない。** 探し上げが作業場まで届く形である。
test("子が状態を持たなければ、作業場の状態で解決する", () => {
  const root = tempDir("autodrive-state2-");
  const repoPath = join(root, "child");
  mkdirSync(join(root, STATE_DIR), { recursive: true });
  mkdirSync(repoPath, { recursive: true });
  execFileSync("git", ["-C", repoPath, "init", "-q", "-b", "aut-998"], { stdio: "ignore" });

  placeState(root, repoPath, "child", "aut-998", "AUT-998");
  const { item } = resolveWorkItem(defaultRoot({}, repoPath), repoPath);
  assert.equal(item?.workItemId, "AUT-998");
});
