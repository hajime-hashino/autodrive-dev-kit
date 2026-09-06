/**
 * 追跡してはいけないものを見つける判定。
 *
 * **既製品で済まないかを先に測った**（AUT-137）。
 *
 *   GitHub Secret Protection  private + Free では使えない
 *   gitleaks                  バイナリを走査しない（39MBのテキストは全部走査する）
 *
 * **だからここでは鍵を探さない。** 名前と先頭の数バイトで決まるものだけを見る。
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { describe, forbidden, looksExecutable } from "../src/tracked.js";
import { Repo } from "../src/repos.js";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const KIT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** 追跡された状態のリポジトリを作る。 */
function repoWith(files) {
  const root = mkdtempSync(join(tmpdir(), "autodrive-tracked-"));
  execFileSync("git", ["-C", root, "init", "-q"]);
  for (const [name, body] of Object.entries(files)) {
    mkdirSync(join(root, name, ".."), { recursive: true });
    writeFileSync(join(root, name), body);
  }
  execFileSync("git", ["-C", root, "add", "-f", "."]);
  return root;
}

const elf = (size = 4096) => {
  const b = Buffer.alloc(size);
  b.write("\x7fELF", 0, "binary");
  return b;
};

test("コアダンプを見つける", () => {
  const root = repoWith({ core: elf(), "src.js": "// ふつう\n" });
  const found = forbidden(root, new Repo(root).trackedFiles());
  assert.deepEqual(found.map((f) => f.path), ["core"]);
});

// **名前を変えられても見つける。** 名前だけを見ていると、そこで抜ける。
test("名前を変えたコアダンプも見つける", () => {
  const root = repoWith({ "dump.bin": elf(), "src.js": "//\n" });
  const found = forbidden(root, new Repo(root).trackedFiles());
  assert.deepEqual(found.map((f) => f.path), ["dump.bin"]);
});

test("資格情報と鍵ファイルを見つける", () => {
  const root = repoWith({
    ".env": "GH_TOKEN=x\n",
    "deploy.pem": "-----BEGIN PRIVATE KEY-----\n",
    id_rsa: "x\n",
  });
  const found = forbidden(root, new Repo(root).trackedFiles()).map((f) => f.path).sort();
  assert.deepEqual(found, [".env", "deploy.pem", "id_rsa"]);
});

// **`.env.example` は追跡するのが正しい。** 値を持たない雛形である。
test("雛形は見つけない", () => {
  const root = repoWith({ ".env.example": "GH_TOKEN=\n", "README.md": "# x\n" });
  assert.deepEqual(forbidden(root, new Repo(root).trackedFiles()), []);
});

test("ふつうのファイルを誤って挙げない", () => {
  const root = repoWith({ "src.js": "//\n", "a.md": "x\n", "b.json": "{}\n" });
  assert.deepEqual(forbidden(root, new Repo(root).trackedFiles()), []);
});

test("先頭が ELF かどうかだけを見る", () => {
  const root = repoWith({ bin: elf(), txt: "not elf\n" });
  assert.equal(looksExecutable(join(root, "bin")), true);
  assert.equal(looksExecutable(join(root, "txt")), false);
  assert.equal(looksExecutable(join(root, "無い")), false, "無いファイルで落ちている");
});

// **中身を出さない。** 直すための仕掛けが漏洩の経路になっては本末転倒である。
test("見つけたものの中身を出さない", () => {
  const secret = "GH_TOKEN=THIS_MUST_NOT_APPEAR";
  const root = repoWith({ ".env": `${secret}\n` });
  const text = describe(forbidden(root, new Repo(root).trackedFiles())).join("\n");
  assert.ok(text.includes(".env"), "どのファイルかを出していない");
  assert.equal(text.includes("THIS_MUST_NOT_APPEAR"), false, "**中身を出している**");
});

// **何をすればよいかまで出す。** 「見つかった」だけでは動けない。
test("履歴に入っている場合の手当てまで出す", () => {
  const root = repoWith({ core: elf() });
  const text = describe(forbidden(root, new Repo(root).trackedFiles())).join("\n");
  assert.ok(text.includes("消すコミットを積むだけでは消えない"), "履歴のことを言っていない");
  assert.ok(text.includes("失効"), "失効が先だと言っていない");
});

test("何も無ければ、何も出さない", () => {
  const root = repoWith({ "src.js": "//\n" });
  assert.deepEqual(describe(forbidden(root, new Repo(root).trackedFiles())), []);
});

// **名前だけで決まるものも、名前だけで捕まえること。**
// ELF の判定に頼っていると、中身が壊れたコアダンプを見逃す。
test("ELF でなくても、core という名前なら捕まえる", () => {
  const root = repoWith({ core: "truncated\n" });
  const found = forbidden(root, new Repo(root).trackedFiles());
  assert.deepEqual(found.map((f) => f.path), ["core"], "名前の規則が効いていない");
});

// ------------------------------------------- 判定器に載っているか

/** 判定器を、その場のリポジトリに対して走らせる。 */
async function invariantsOn(root) {
  const { run } = await import("../src/main.js");
  return run(["--root", root, "--scope", "self"]);
}

// **仕掛けを作っても、判定器が呼ばなければ何も起きない。**
test("判定器が、追跡してはいけないものを出す", async () => {
  const root = repoWith({ core: elf(), "src.js": "//\n" });
  const { output } = await invariantsOn(root);
  assert.ok(output.includes("追跡してはいけないものが追跡されている"), output.slice(-400));
  assert.ok(output.includes("core"), "どのファイルかを出していない");
});

// **CI が落ちなければ、気づかない。**
//
// 判定器を通して見ると差が出ない（一時リポジトリでは記録が無く、どのみち落ちる）。
// **判断そのものを直接見る。**
test("不変条件が全部通っていても、見つかれば落ちる", async () => {
  const { exitCode } = await import("../src/main.js");
  const allPassing = [{ failing: false }, { failing: false }];
  assert.equal(exitCode(allPassing, 0), 0, "何も無いのに落ちている");
  assert.equal(exitCode(allPassing, 1), 1, "**見つかったのに落ちていない**");
  assert.equal(exitCode([{ failing: true }], 0), 1, "不変条件の失敗で落ちていない");
});

test("何も無ければ、判定器は何も言わない", async () => {
  const clean = repoWith({ "src.js": "//\n" });
  const { code, output } = await invariantsOn(clean);
  assert.equal(output.includes("追跡してはいけないもの"), false, "何も無いのに出している");
  assert.notEqual(code, 2, `引数の誤りで落ちている: ${output.slice(0, 200)}`);
});

// ------------------------------------------- 配るものに入っているか

// **見つける仕掛けだけでは、また入る。** 入らないようにするほうが先。
test("配る .gitignore が、コアダンプを外している", () => {
  const text = readFileSync(join(KIT, "templates", "gitignore"), "utf8");
  assert.ok(/^core$/m.test(text), "core が無い");
  assert.ok(/^core\.\*$/m.test(text), "core.* が無い");
});
