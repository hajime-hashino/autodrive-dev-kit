/**
 * 隔離の設定の判定。
 *
 * **この判定は、防止の代わりに置いたものである**（AUT-157）。`devcontainer.json` を
 * プロジェクトのものにしたため、ここが唯一の網になる。**通ることの確認だけでは、
 * 何も見ていない判定と区別できない。** 壊し方を1つずつ当てて、落ちることまで見る。
 */

import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { describe, isolationGaps, readDefinition } from "../src/vendored/internal/isolation.js";
import { setup } from "../src/vendored/internal/setup.js";
import { useRecommended } from "../src/vendored/internal/ports/interview.js";
import { tempDir } from "./helpers/tmp.js";

const KIT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** 置いたばかりのプロジェクト。**素の状態が通ることが前提になる。** */
function placed() {
  const root = tempDir("autodrive-isolation-");
  mkdirSync(join(root, ".git"), { recursive: true });
  setup("init", root, KIT, useRecommended);
  return root;
}

const definitionOf = (root) => join(root, ".devcontainer", "devcontainer.json");

/** 定義を書き換える。 */
function edit(root, change) {
  const path = definitionOf(root);
  writeFileSync(path, change(readFileSync(path, "utf8")), "utf8");
}

const gapsOf = (root) => isolationGaps(root).map((g) => g.gap);

/**
 * `postStartCommand` の行を落とす。
 *
 * **テンプレートの一行を書き写さない。** 書き方が変わった時点で置換が当たらなく
 * なり、**何も壊していない定義を「壊した」として通す。** 実際に当たらなくなった
 * （AUT-169 で確認の呼び出しを足したとき）。落とせなければ、その場で落とす。
 */
function dropPostStart(root) {
  edit(root, (s) => {
    const dropped = s.replace(/^[ \t]*"postStartCommand":.*\n/m, "");
    assert.notEqual(dropped, s, "postStartCommand の行を落とせていない。壊せていない");
    return dropped;
  });
}

// ------------------------------------------------------------ 素の状態

// **置いたままなら通ること。** ここが落ちると、直し方の分からない警告が初日に出る。
test("置いたままのサンドボックスには、穴が無い", () => {
  assert.deepEqual(isolationGaps(placed()), []);
});

// **使っていないものを見ない。** サンドボックスを持たないプロジェクトに、隔離の話をしない。
test("サンドボックスを使っていなければ、何も言わない", () => {
  const root = tempDir("autodrive-isolation-none-");
  mkdirSync(join(root, ".git"), { recursive: true });
  assert.deepEqual(isolationGaps(root), []);
});

// ------------------------------------------------------------ 壊し方を当てる

// **AUT-121 で実際に起きた形。** この10日間、ファイルはテンプレートと1バイトも違わなかった。
// 指紋では捕まらない。**ここで捕まえられなければ、置いた意味が無い。**
test("出口を閉じる処理が、作ったときにしか走らない形を捕まえる", () => {
  const root = placed();
  dropPostStart(root);
  edit(root, (s) =>
    s.replace(
      '"postCreateCommand": "bash .devcontainer/post-create.sh",',
      '"postCreateCommand": "sudo bash .devcontainer/init-firewall.sh",',
    ),
  );

  const gaps = isolationGaps(root);
  assert.equal(gaps.length, 1, JSON.stringify(gaps));
  assert.ok(gaps[0].gap.includes("postStartCommand"), gaps[0].gap);
  // **なぜ足りないのかまで言う。** 移せばよいと分かる形にする。
  assert.ok(gaps[0].why.includes("postCreateCommand"), gaps[0].why);
  assert.ok(gaps[0].why.includes("AUT-121"), gaps[0].why);
});

test("出口を閉じる処理を呼んでいない形を捕まえる", () => {
  const root = placed();
  dropPostStart(root);

  assert.deepEqual(gapsOf(root), ["postStartCommand が init-firewall.sh を呼んでいない"]);
});

test("規則を置く権限が無い形を捕まえる", () => {
  const root = placed();
  edit(root, (s) => s.replace('"runArgs": ["--cap-add=NET_ADMIN", "--cap-add=NET_RAW"],', ""));

  assert.deepEqual(gapsOf(root), ["runArgs に NET_ADMIN が無い", "runArgs に NET_RAW が無い"]);
});

// **片方だけ消しても捕まえる。** 両方要る。
test("権限が片方だけでも捕まえる", () => {
  const root = placed();
  edit(root, (s) => s.replace('"--cap-add=NET_RAW"', '"--cap-add=SYS_PTRACE"'));

  assert.deepEqual(gapsOf(root), ["runArgs に NET_RAW が無い"]);
});

test("root で動かす形を捕まえる", () => {
  const root = placed();
  edit(root, (s) => s.replace('"remoteUser": "vscode",', '"remoteUser": "root",'));

  assert.deepEqual(gapsOf(root), ["remoteUser が root（または指定が無い）"]);
});

// **指定が無いのも同じ。** 既定は root である。
test("remoteUser の指定が無い形を捕まえる", () => {
  const root = placed();
  edit(root, (s) => s.replace('"remoteUser": "vscode",', ""));

  assert.deepEqual(gapsOf(root), ["remoteUser が root（または指定が無い）"]);
});

// **指しているだけの状態を作らない。** 起動のたびに失敗するが、見られるとは限らない。
test("呼んでいるスクリプトが無い形を捕まえる", () => {
  const root = placed();
  rmSync(join(root, ".devcontainer", "init-firewall.sh"));

  assert.deepEqual(gapsOf(root), ["init-firewall.sh を呼んでいるが、置かれていない"]);
});

// ------------------------------------------------------------ 読めないもの

// **確かめられないものを、確かめた顔で通さない。**
test("読めない定義は、通さずにそう言う", () => {
  const root = placed();
  writeFileSync(definitionOf(root), "{ これは JSON ではない", "utf8");

  const gaps = isolationGaps(root);
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].gap, "読めない");
});

// **行の途中の // を、コメントとして落とさない。** URL が壊れる。
test("URL の // を、コメントと間違えない", () => {
  const { json, error } = readDefinition('{\n  // 説明\n  "image": "https://example.com/x"\n}\n');
  assert.equal(error, null);
  assert.equal(json.image, "https://example.com/x");
});

// ------------------------------------------------------------ 伝え方

// **直し方まで出す。** 何が足りないかだけでは、何をすればよいか分からない。
test("見つけたら、誰のものかと、元の形がどこにあるかを言う", () => {
  const text = describe([{ path: "x/.devcontainer/devcontainer.json", gap: "穴", why: "理由" }]).join("\n");

  assert.ok(text.includes("プロジェクトのもの"), text);
  assert.ok(text.includes("templates/devcontainer/devcontainer.json"), text);
  assert.ok(text.includes("理由"), text);
});

test("穴が無ければ、何も言わない", () => {
  assert.deepEqual(describe([]), []);
});

// ------------------------------------------------------------ CI で落ちること

// **見つけても落ちなければ、誰も気づかない。**
//
// `invariants` を通して見ると差が出ない（一時リポジトリでは記録が無く、どのみち落ちる）。
// **判断そのものを直接見る**（`tracked.test.js` と同じ理由）。
test("不変条件が全部通っていても、設定が欠けていれば落ちる", async () => {
  const { exitCode } = await import("../src/vendored/internal/main.js");
  const allPassing = [{ failing: false }, { failing: false }];

  assert.equal(exitCode(allPassing, 0, 0), 0, "何も無いのに落ちている");
  assert.equal(exitCode(allPassing, 0, 1), 1, "**設定が欠けているのに落ちていない**");
  // 追跡してはいけないものと、両方あっても落ちること。
  assert.equal(exitCode(allPassing, 1, 1), 1);
});

// **`invariants` の出力に出ること。** 終了コードだけでは、何が起きたのか分からない。
test("`invariants` を通しても、設定の欠けが出力に出る", async () => {
  const root = placed();
  edit(root, (s) => s.replace('"remoteUser": "vscode",', '"remoteUser": "root",'));

  const { run } = await import("../src/vendored/internal/main.js");
  const { output } = await run(["--root", root, "--scope", "self"]);

  assert.ok(output.includes("隔離の設定が欠けている"), output.slice(-500));
  assert.ok(output.includes("remoteUser"), "どこが欠けているかを出していない");
});
