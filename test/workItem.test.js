/**
 * 記録の置き場所の解決。
 *
 * ## なぜ判定するか
 *
 * `--root .` を渡すと、記録が `autodrive-dev-work/telemetry/` という**存在しない
 * 入れ子へ書かれた**（AUT-143）。`resolveRepo` が起点を絶対パスへ直さずに
 * `basename` と比べていたため、「起点そのものが対象リポジトリ」の判定が外れ、
 * 起点の下をもう一段掘っていた。
 *
 * **黙って別の場所へ書くのが悪い。** 追記は途中のディレクトリごと作るため
 * 「記録した」と表示され、成功に見える。`invariants` が見るのは
 * `<対象リポジトリ>/telemetry/` であり、そこに無い記録は無いのと同じである。
 * しかも作られた場所は追跡対象外なので、そのまま消える。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import {
  currentBranch,
  defaultRoot,
  findRoot,
  rememberBranch,
  resolveRepo,
  resolveWorkItem,
  telemetryPath,
} from "../src/vendored/internal/workItem.js";
import { tempDir } from "./helpers/tmp.js";

function withMarker(repo) {
  const root = tempDir("autodrive-workitem-");
  mkdirSync(join(root, ".autodrive"), { recursive: true });
  writeFileSync(
    join(root, ".autodrive", "current-work-item.json"),
    JSON.stringify({ work_item_id: "AUT-1", repo }),
    "utf8",
  );
  return root;
}

test("相対パスの起点でも、起点そのものが対象リポジトリだと分かる", () => {
  const root = tempDir("autodrive-rel-");
  const name = basename(root);

  // **これが壊れていた形。** basename(".") は "." であり、名前と一致しない。
  const before = process.cwd();
  try {
    process.chdir(root);
    assert.equal(resolveRepo(".", name), resolve(root), "**起点の下をもう一段掘っている**");
    assert.equal(resolveRepo("./", name), resolve(root));
  } finally {
    process.chdir(before);
  }

  // 絶対パスでも、末尾に区切りが付いていても同じ答えになること。
  assert.equal(resolveRepo(root, name), resolve(root));
  assert.equal(resolveRepo(`${root}/`, name), resolve(root));
});

test("起点の直下にあるリポジトリは、これまでどおり直下として解決する", () => {
  const root = tempDir("autodrive-child-");
  mkdirSync(join(root, "kit"), { recursive: true });
  assert.equal(resolveRepo(root, "kit"), join(resolve(root), "kit"));
  assert.equal(resolveRepo(".", "kit"), join(resolve("."), "kit"));
});

test("指す先が無ければ、そこへ書かずに理由を返す", () => {
  const root = withMarker("居ないリポジトリ");
  const { item, unattributedReason } = resolveWorkItem(root);

  assert.equal(item, null, "**無い場所を指したまま、書ける先として返している**");
  assert.match(unattributedReason ?? "", /リポジトリが無い/);
  // **何を確かめればよいかまで出す。** 「解決できない」だけでは直せない。
  assert.match(unattributedReason ?? "", /起点と repo/);

  // 記録は捨てない。**帰属しない置き場へ回す。**
  assert.equal(
    telemetryPath(root, item),
    join(resolve(root), "telemetry", "unattributed.jsonl"),
  );
  assert.equal(existsSync(join(root, "居ないリポジトリ")), false, "無い場所を作っている");
});

test("指す先が在れば、その中の作業単位のファイルへ向く", () => {
  const root = withMarker("kit");
  mkdirSync(join(root, "kit"), { recursive: true });
  const { item, unattributedReason } = resolveWorkItem(root);

  assert.equal(unattributedReason, null);
  assert.equal(
    telemetryPath(root, item),
    join(resolve(root), "kit", "telemetry", "AUT-1.jsonl"),
  );
});

test("置き場所は絶対パスで返す", () => {
  const root = withMarker("kit");
  mkdirSync(join(root, "kit"), { recursive: true });
  const before = process.cwd();
  try {
    process.chdir(root);
    const { item } = resolveWorkItem(".");
    // **相対で返すと、書けた先が意図した場所か、出力を見た人が確かめられない。**
    // 実際に `autodrive-dev-work/telemetry/...` と表示され、起点そのものだと
    // 読めてしまった（AUT-143）。
    const path = telemetryPath(".", item);
    assert.equal(path, join(resolve(root), "kit", "telemetry", "AUT-1.jsonl"));
  } finally {
    process.chdir(before);
  }
});

// --------------------------------------------- ブランチで引く（AUT-172）
//
// **マーカー1つで引いていた間、提出のあとに書いた記録が次の作業単位へ紐づいた。**
// 提出したあとに人の指摘が来るのは普通のことで、そのときマーカーは既に次を指す。
// 実際に3件が誤った先へ向かった。**帰属しないより悪い。誰も気づかない。**

/** 起点と、その下のリポジトリを作る。git は偽物を渡す。 */
function workspace(repos) {
  const root = tempDir("autodrive-branch-");
  mkdirSync(join(root, ".autodrive"), { recursive: true });
  for (const r of repos) mkdirSync(join(root, r), { recursive: true });
  return root;
}

/** いま居る作業ツリーを装う git。 */
function fakeGit(top, branch) {
  return (_cwd, args) => {
    if (args[0] === "rev-parse") return `${top}\n`;
    if (args[0] === "branch") return `${branch}\n`;
    throw new Error(`想定外: ${args.join(" ")}`);
  };
}

test("ブランチの対応が、マーカーより優先される", () => {
  const root = workspace(["kit"]);
  // マーカーは次の作業単位を指している。**これが実際に起きた形である。**
  writeFileSync(
    join(root, ".autodrive", "current-work-item.json"),
    JSON.stringify({ work_item_id: "AUT-174", repo: "kit" }),
    "utf8",
  );
  rememberBranch(root, "kit", "aut-162", "AUT-162");

  const { item } = resolveWorkItem(root, join(root, "kit"), fakeGit(join(root, "kit"), "aut-162"));
  assert.equal(item?.workItemId, "AUT-162", "マーカーの側を拾っている");
});

test("対応表に無いブランチなら、マーカーへ落ちる", () => {
  const root = workspace(["kit"]);
  writeFileSync(
    join(root, ".autodrive", "current-work-item.json"),
    JSON.stringify({ work_item_id: "AUT-174", repo: "kit" }),
    "utf8",
  );

  const { item } = resolveWorkItem(root, join(root, "kit"), fakeGit(join(root, "kit"), "main"));
  assert.equal(item?.workItemId, "AUT-174");
});

// **名前の形から逆算しない。** `--branch` で別名を渡された場合に外れ、作業単位で
// ないブランチ名から存在しないIDを作ってしまう。
test("作業単位のように見えるブランチ名でも、対応が無ければ引かない", () => {
  const root = workspace(["kit"]);
  const { item, unattributedReason } = resolveWorkItem(
    root,
    join(root, "kit"),
    fakeGit(join(root, "kit"), "aut-999"),
  );
  assert.equal(item, null, "名前から作業単位IDを作っている");
  assert.match(String(unattributedReason), /マーカーが無い/);
});

test("起点の外のリポジトリでは引かない", () => {
  const root = workspace(["kit"]);
  rememberBranch(root, "kit", "aut-162", "AUT-162");
  // 起点の下ではない作業ツリー
  const outside = resolve(root, "..", "よその作業ツリー");
  assert.equal(currentBranch(root, outside, fakeGit(outside, "aut-162")), null);
});

test("切り離された HEAD では引かない", () => {
  const root = workspace(["kit"]);
  assert.equal(currentBranch(root, join(root, "kit"), fakeGit(join(root, "kit"), "")), null);
});

// **打つ場所で結果が変わらないこと。** 子リポジトリの中から打つと起点が見つからず、
// 「作業単位に紐づかないやり取りである可能性がある」と誤った理由が残っていた。
test("子リポジトリの中から打っても、起点を探し上げる", () => {
  const root = workspace(["kit"]);
  mkdirSync(join(root, "kit", "src", "深い場所"), { recursive: true });
  assert.equal(findRoot(join(root, "kit", "src", "深い場所")), root);
});

test("起点が無ければ、探し上げは null を返す", () => {
  const nowhere = tempDir("autodrive-noroot-");
  assert.equal(findRoot(nowhere), null);
});

test("環境変数の起点は、探し上げより優先される", () => {
  const root = workspace(["kit"]);
  assert.equal(defaultRoot({ CLAUDE_PROJECT_DIR: "/指定された場所" }, join(root, "kit")), "/指定された場所");
  assert.equal(defaultRoot({}, join(root, "kit")), root);
});
