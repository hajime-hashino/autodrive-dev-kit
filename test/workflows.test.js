/**
 * CI 定義が、鍵の名前で嘘をつかないこと。
 *
 * ## なぜ判定するか
 *
 * 横断判定の clone に要るのは読取だけであり、渡しているのは読取専用の
 * `AUTODRIVE_CI_TOKEN` である。**それを** `GH_TOKEN` **という名前で受けていた。**
 *
 * ```yaml
 * env:
 *   GH_TOKEN: ${{ secrets.AUTODRIVE_CI_TOKEN }}   # 動作は正しい。名前が嘘
 * ```
 *
 * 動作は正しいのに、読んだ人は「CI に書き込み用の鍵がある」と受け取る。**実際に、
 * それを前提にした誤った案内が出た**（AUT-139）。CI に `GH_TOKEN` は登録されて
 * いないのに、「CI の GH_TOKEN を更新してください」と言った。
 *
 * 2つの鍵を分けているのは、**判定する側に、判定対象を書き換える力を持たせない**
 * ためである。定義§9の「AIがこれらを無効化できないこと」を見るのが`invariants` であり、
 * その分離が名前で崩れていた。
 *
 * ## 名前を直すだけでは戻る
 *
 * `GH_TOKEN` は gh CLI が既定で拾う名前であり、**CI で書くのが自然に見える。**
 * 直しても、次に CI を触った者が同じ名前を書く。判定を置いて、書けなくする。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const KIT = new URL("..", import.meta.url).pathname;

/** CI 定義の一覧。**配るテンプレートも含める。** いま配っている形が次のプロジェクトへ伝わる。 */
function workflowFiles() {
  const files = [];
  const dir = join(KIT, ".github", "workflows");
  if (existsSync(dir)) {
    for (const name of readdirSync(dir).sort()) {
      if (name.endsWith(".yml") || name.endsWith(".yaml")) files.push(join(dir, name));
    }
  }
  const template = join(KIT, "src", "templates", "invariants.yml");
  if (existsSync(template)) files.push(template);
  return files;
}

/**
 * `GH_TOKEN` という名前へ何かを束ねている箇所。
 *
 * **コメントは除く。** なぜその名前を使わないかは、まさにコメントに書いてある。
 * それを見つけて落とすと、理由を書けなくなる。
 */
function bindsGhToken(text) {
  return text
    .split("\n")
    .map((line, i) => ({ line: line.trim(), no: i + 1 }))
    .filter(({ line }) => !line.startsWith("#"))
    .filter(({ line }) => /(^|[^A-Z_])GH_TOKEN\s*:/.test(line));
}

test("CI 定義が、読取専用の鍵を GH_TOKEN という名前で渡さない", () => {
  assert.ok(workflowFiles().length > 0, "CI 定義が1つも見つかっていない。判定が空回りしている");

  for (const path of workflowFiles()) {
    const found = bindsGhToken(readFileSync(path, "utf8"));
    assert.deepEqual(
      found,
      [],
      [
        `${path} が GH_TOKEN という名前を使っている:`,
        ...found.map((f) => `  ${f.no}: ${f.line}`),
        "",
        "**CI に渡すのは読取専用の鍵である。** 書き込み用の名前で受けると、",
        "読んだ人が「CI に書き込み用の鍵がある」と受け取る（AUT-139）。",
        "clone に使うなら CLONE_TOKEN のように、何に使うかで名付けること。",
      ].join("\n"),
    );
  }
});

test("判定の対象そのものが読めていること", () => {
  // **見つけられることを、先に確かめる。** 上の判定は「無い」を主張するため、
  // 探し方が壊れていても通ってしまう。
  const found = bindsGhToken("      env:\n        GH_TOKEN: ${{ secrets.AUTODRIVE_CI_TOKEN }}\n");
  assert.equal(found.length, 1, "**束ねている箇所を見つけられていない**");
  assert.equal(found[0].no, 2);

  // 使う側（`${GH_TOKEN}`）ではなく、名前を与えている側だけを見る。
  assert.deepEqual(bindsGhToken('  run: git clone "https://x:${GH_TOKEN}@github.com/a/b"'), []);
  // 理由を書いたコメントを、違反と読まない。
  assert.deepEqual(bindsGhToken("        # GH_TOKEN: この名前は CI で使わない"), []);
  // 別の名前に含まれる GH_TOKEN を、違反と読まない。
  assert.deepEqual(bindsGhToken("          APP_GH_TOKEN: ${{ secrets.X }}"), []);
});

// **配る判定が、プロジェクトの都合で落ちないこと**（AUT-180）。
//
// `actions/setup-node` は既定で直下の lock ファイルを見て、その管理ツールで
// キャッシュしようとする。**その実行ファイルが無いと、判定そのものが落ちる。**
// 実際に agent-playground で `Unable to locate executable file: pnpm` が出た。
//
// **判定は依存を1つも使わない。** 参照実装は依存ゼロであり、node さえあれば走る。
test("配る判定のワークフローが、パッケージ管理のキャッシュを試みない", () => {
  const body = readFileSync(join(KIT, "src", "templates", "invariants.yml"), "utf8");
  // **すべてのジョブで止める。** ジョブが増えたとき、1つだけ止めていれば通る形にしない（ADK-143）。
  const setups = body.match(/uses: actions\/setup-node@/g) ?? [];
  const stopped = body.match(/package-manager-cache:\s*false/g) ?? [];
  assert.ok(setups.length > 0, "setup-node が無い");
  assert.equal(stopped.length, setups.length, "止めていないジョブがある。lock ファイルのある先で落ちる");
  // **止めた理由まで置く。** 消してよいものに見えると、次に消される。
  assert.match(body, /use no dependencies at all/, "なぜ止めているのかが無い");
});

// ------------------------------------------------------------ 横断の判定（ADK-143）

/** 配るテンプレートの、横断のジョブの部分。 */
function crossJob() {
  const body = readFileSync(join(KIT, "src", "templates", "invariants.yml"), "utf8");
  const start = body.indexOf("\n  cross:\n");
  assert.ok(start >= 0, "横断のジョブが無い");
  return body.slice(start);
}

// **信頼できる判定は、AI が触れない層で打つ**（定義§9）。
test("配る CI が、横断の判定を打つ", () => {
  assert.match(crossJob(), /invariants --root \. --scope cross/);
});

// **統合後の状態を見るものであり、PR で打つと AI の書いたコードが鍵付きで走る。**
test("横断の判定は、PR では打たない", () => {
  assert.match(crossJob(), /if: github\.event_name != 'pull_request'/);
});

// **CI の鍵は、そのジョブに要る分に絞る。**
test("GitHub App のトークンには、読む権限だけを求める", () => {
  const job = crossJob();
  assert.match(job, /actions\/create-github-app-token@v3/);
  assert.match(job, /client-id: \$\{\{ vars\.AUTODRIVE_APP_CLIENT_ID \}\}/);
  const permissions = job.split("\n").filter((l) => /^\s*permission-/.test(l));
  assert.ok(permissions.length > 0, "求める権限を絞っていない（書かなければ App の全権限になる）");
  for (const line of permissions) assert.match(line, /:\s*read\s*$/, `読む以外の権限を求めている: ${line.trim()}`);
});

/** 判定を打つ段のスクリプトを取り出す。 */
function crossScript() {
  const job = crossJob();
  const block = job.slice(job.indexOf("run: |") + "run: |".length).split("\n");
  const lines = [];
  for (const line of block.slice(1)) {
    if (line.trim() !== "" && !line.startsWith("          ")) break;
    lines.push(line.slice(10));
  }
  return lines.join("\n");
}

// **判定できないことを、通過にしない。** 鍵が無いまま緑になると、判定したと読まれる。
test("判定の鍵が無ければ、設定の仕方を出して落ちる", () => {
  const script = crossScript().replaceAll("{{KIT}}/invariants", "echo 判定した");
  const run = (token) => {
    try {
      return { code: 0, out: execFileSync("bash", ["-c", script], { encoding: "utf8", env: { ...process.env, AUTODRIVE_CI_TOKEN: token } }) };
    } catch (e) {
      return { code: e.status, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
    }
  };

  const without = run("");
  assert.equal(without.code, 1, without.out);
  assert.match(without.out, /AUTODRIVE_APP_CLIENT_ID/);
  assert.match(without.out, /AUTODRIVE_CI_TOKEN/);
  assert.doesNotMatch(without.out, /判定した/);

  const withKey = run("t");
  assert.equal(withKey.code, 0, withKey.out);
  assert.match(withKey.out, /判定した/);
});
