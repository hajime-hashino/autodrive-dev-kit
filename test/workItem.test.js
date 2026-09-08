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
import { resolveRepo, resolveWorkItem, telemetryPath } from "../src/workItem.js";
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
