/**
 * 管理下のファイルへの編集を、黙って上書きしないこと。
 *
 * **設計意図は前からあった。** `init.js` は「ローカルの編集は参照実装への起票の
 * 契機である」と書いていた。**検出する仕掛けが無かったので、一度も働いていない**
 * （AUT-116）。
 */

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { init } from "../src/init.js";
import { defaults } from "../src/config.js";
import {
  describeEdits,
  describeUnchecked,
  findEdits,
  fingerprint,
  linesLost,
  readManifest,
  writeManifest,
} from "../src/manifest.js";

const KIT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function project() {
  const root = mkdtempSync(join(tmpdir(), "autodrive-manifest-"));
  mkdirSync(join(root, ".git"), { recursive: true });
  return root;
}

const manifestOf = (root) => readManifest(join(root, "autodrive", "manifest.json"));

/**
 * 土台を置く。**構成を渡す。** 渡さないとサンドボックスが置かれず、
 * `.devcontainer/` が確かめる対象に入らない。
 */
const place = (root) => init(root, KIT, defaults(), true);

// ------------------------------------------------------------ 消える行

test("消える行だけを出す。入ってくる行は出さない", () => {
  // **知りたいのは「自分が足したものがどうなるか」である。**
  const lost = linesLost("a\nb\n自分で足した\n", "a\nb\n参照実装が足した\n");
  assert.deepEqual(lost, ["自分で足した"]);
});

test("行が動いただけのものを、消えると言わない", () => {
  assert.deepEqual(linesLost("a\nb\nc\n", "c\nb\na\n"), []);
});

test("空行は数えない", () => {
  assert.deepEqual(linesLost("a\n\n\nb\n", "a\nb\n"), []);
});

test("同じ行が何度も出ても、一度だけ出す", () => {
  assert.deepEqual(linesLost("x\nx\nx\n", "a\n"), ["x"]);
});

// ------------------------------------------------------------ 検出

const plan = (path, body) => [{ path, body }];

test("手で変えられていれば、見つける", () => {
  const root = project();
  writeFileSync(join(root, "f.txt"), "手で変えた\n", "utf8");
  const manifest = { "f.txt": fingerprint("元の中身\n") };

  const { edited, unchecked } = findEdits(root, plan("f.txt", "新しい中身\n"), manifest);

  assert.deepEqual(edited.map((e) => e.path), ["f.txt"]);
  assert.deepEqual(unchecked, []);
});

// **参照実装が変えた分まで止めない。** 止めると、入れ替えそのものができなくなる。
test("指紋どおりなら、変わったのは参照実装の側。止めない", () => {
  const root = project();
  writeFileSync(join(root, "f.txt"), "元の中身\n", "utf8");
  const manifest = { "f.txt": fingerprint("元の中身\n") };

  const { edited } = findEdits(root, plan("f.txt", "新しい中身\n"), manifest);

  assert.deepEqual(edited, []);
});

test("中身が同じなら、何も言わない", () => {
  const root = project();
  writeFileSync(join(root, "f.txt"), "同じ\n", "utf8");
  const { edited, unchecked } = findEdits(root, plan("f.txt", "同じ\n"), null);
  assert.deepEqual(edited, []);
  assert.deepEqual(unchecked, []);
});

test("まだ無いファイルは、置くだけ。消えるものが無い", () => {
  const root = project();
  const { edited, unchecked } = findEdits(root, plan("f.txt", "新しい\n"), null);
  assert.deepEqual(edited, []);
  assert.deepEqual(unchecked, []);
});

// **指紋が無いものを、変えられたことにしない。** そこで止めると、この仕掛けより
// 前に置かれたプロジェクトが入れ替えられなくなる。
test("指紋が無ければ止めない。ただし確かめていないことを残す", () => {
  const root = project();
  writeFileSync(join(root, "f.txt"), "手で変えた\n", "utf8");

  const { edited, unchecked } = findEdits(root, plan("f.txt", "新しい\n"), null);

  assert.deepEqual(edited, []);
  assert.deepEqual(unchecked, ["f.txt"]);
});

// ------------------------------------------------------------ 出す内容

test("何が消えるのかと、どうすればよいかを出す", () => {
  const text = describeEdits([{ path: "a.json", lost: ["足した行"] }]);
  assert.ok(text.includes("a.json"), "どのファイルかが無い");
  assert.ok(text.includes("足した行"), "何が消えるのかが無い");
  assert.ok(text.includes("何も書いていない"), "書いていないことを言っていない");
  assert.ok(text.includes("起票"), "どうすればよいかが無い");
});

// **黙って切ると、出ている分が全部だと読まれる。**
test("長い場合は打ち切り、打ち切ったことを言う", () => {
  const lost = Array.from({ length: 20 }, (_, i) => `行${i}`);
  const text = describeEdits([{ path: "a", lost }], 3);
  assert.ok(text.includes("他 17 行"), text);
});

test("確かめられなかったことは、上書きしたと併せて言う", () => {
  const text = describeUnchecked(["a", "b"]);
  assert.ok(text.includes("2件"));
  assert.ok(text.includes("上書きした"), "上書きしたことを言っていない");
});

// ------------------------------------------------------------ 通しで

test("手で変えたら、何も書かずに止まる", () => {
  const root = project();
  place(root);

  const target = join(root, ".devcontainer", "devcontainer.json");
  const before = readFileSync(target, "utf8");
  writeFileSync(target, `${before}\n// 手で足した\n`, "utf8");
  // 他の管理下のファイルが、この後で書き換わっていないことを見るために控える。
  const otherBefore = readFileSync(join(root, ".env.example"), "utf8");

  const r = place(root);

  assert.equal(r.code, 1);
  assert.ok(r.message.includes("手で足した"), r.message);
  // **一部だけ新しい状態を作らない。**
  assert.equal(readFileSync(target, "utf8"), `${before}\n// 手で足した\n`, "上書きしている");
  assert.equal(readFileSync(join(root, ".env.example"), "utf8"), otherBefore, "他を書き換えた");
  assert.deepEqual(r.placed, [], "置いたと報告している");
});

test("戻せば、通る", () => {
  const root = project();
  place(root);
  const target = join(root, ".devcontainer", "devcontainer.json");
  const before = readFileSync(target, "utf8");
  writeFileSync(target, `${before}\n// 手で足した\n`, "utf8");
  assert.equal(place(root).code, 1);

  writeFileSync(target, before, "utf8");

  assert.equal(place(root).code, 0);
});

test("置いたら、指紋を残す", () => {
  const root = project();
  place(root);

  const manifest = manifestOf(root);
  assert.ok(manifest !== null, "指紋が無い");
  for (const path of [".env.example", "docs/autodrive.md", ".devcontainer/devcontainer.json"]) {
    assert.ok(manifest[path] !== undefined, `${path} の指紋が無い`);
    assert.equal(
      manifest[path],
      fingerprint(readFileSync(join(root, path), "utf8")),
      `${path} の指紋が中身と合わない`,
    );
  }
});

// **播種したものは対象外。** 中身はプロジェクトのものであり、上書きしない。
test("播種したものを変えても、止まらない", () => {
  const root = project();
  place(root);
  writeFileSync(join(root, "boundaries.yaml"), "areas: [自分で書いた]", "utf8");

  const r = place(root);

  assert.equal(r.code, 0);
  assert.equal(readFileSync(join(root, "boundaries.yaml"), "utf8"), "areas: [自分で書いた]");
});

// **指紋が無い状態から、次は確かめられるようになること。**
test("指紋が無くても一度は通り、その次からは止まる", () => {
  const root = project();
  place(root);
  rmSync(join(root, "autodrive", "manifest.json"));

  const target = join(root, ".devcontainer", "allowed-domains.txt");
  writeFileSync(target, `${readFileSync(target, "utf8")}\nexample.com  # 手で足した\n`, "utf8");

  const first = place(root);
  assert.equal(first.code, 0, "止まってしまっている");
  assert.ok(first.notes.join("\n").includes("確かめられなかった"), "黙って上書きしている");

  writeFileSync(target, `${readFileSync(target, "utf8")}\nexample.com  # 二度目\n`, "utf8");
  assert.equal(place(root).code, 1, "次も確かめられていない");
});

test("壊れた指紋で落とさない。確かめられないものとして扱う", () => {
  const root = project();
  place(root);
  writeFileSync(join(root, "autodrive", "manifest.json"), "{ 壊れている", "utf8");

  const target = join(root, ".env.example");
  writeFileSync(target, `${readFileSync(target, "utf8")}\nX_KEY=\n`, "utf8");

  const r = place(root);
  assert.equal(r.code, 0);
  assert.ok(r.notes.join("\n").includes("確かめられなかった"));
});

test("書いた指紋を、読み直せる", () => {
  const root = project();
  const path = join(root, "m.json");
  writeManifest(path, [{ path: "a", body: "あ" }]);
  assert.deepEqual(readManifest(path), { a: fingerprint("あ") });
  assert.equal(readManifest(join(root, "無い.json")), null);
});

test("指紋は追跡される場所に置く", () => {
  // **`.autodrive/` は追跡しない。** そこに置くと、クローンした先で効かない。
  const root = project();
  place(root);
  assert.ok(existsSync(join(root, "autodrive", "manifest.json")), "道具一式の中に無い");
  assert.equal(existsSync(join(root, ".autodrive", "manifest.json")), false);
});
