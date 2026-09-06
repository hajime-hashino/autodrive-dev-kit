/**
 * 配った先で動くか。
 *
 * **`node_modules` の中で動くことを確かめる。** Node は node_modules の下にある
 * ファイルの型注釈を意図的に剥がさない。実装が型注釈を含んでいると、npx で
 * 入れた瞬間に動かなくなる（AUT-97）。
 *
 * **手元のパスを指した確認は、この経路を通らない。** npm はローカルのパスに
 * シンボリックリンクを張るため、実体は node_modules の外に残る。そちらで確かめて
 * 「動いた」と報告した（AUT-96）。**動いたのは、たまたま制約に当たらない経路
 * だったからである。**
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { tempDir } from "./helpers/tmp.js";

const KIT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** 配るものを、node_modules の下へ実体で置く。**リンクにしない。** */
function installed() {
  const root = tempDir("autodrive-pkg-");
  const dest = join(root, "node_modules", "autodrive-dev-kit");
  mkdirSync(dest, { recursive: true });

  const pkg = JSON.parse(readFileSync(join(KIT, "package.json"), "utf8"));
  for (const entry of [...pkg.files, "package.json"]) {
    cpSync(join(KIT, entry), join(dest, entry), { recursive: true });
  }
  execFileSync("git", ["-C", root, "init", "-q"], { stdio: "ignore" });
  return { root, entry: join(dest, pkg.bin["autodrive-dev-kit"]) };
}

// **これが本番の経路である。** ここが通らなければ、npx では使えない。
test("node_modules の中からでも動く", () => {
  const { root, entry } = installed();
  const out = execFileSync(process.execPath, [entry, "init"], { cwd: root, encoding: "utf8" });

  assert.ok(out.includes("土台を置いた"), out.slice(0, 300));
  assert.ok(statSync(join(root, "autodrive")).isDirectory(), "道具が置かれていない");
});

test("node_modules の中からでも、判定が動く", () => {
  const { root, entry } = installed();
  execFileSync(process.execPath, [entry, "init"], { cwd: root, stdio: "ignore" });

  // **終了コードで判断しない。** 記録が1件も無い状態では「要対応」が出て 1 を
  // 返す。それは正しい挙動であり、ここで見たいのは動くかどうかである。
  let out;
  try {
    out = execFileSync(join(root, "autodrive", "invariants"), ["--root", ".", "--scope", "self"], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, AUTODRIVE_CI_TOKEN: "", LINEAR_API_KEY: "" },
    });
  } catch (error) {
    out = `${error.stdout ?? ""}${error.stderr ?? ""}`;
  }
  assert.ok(out.includes("不変条件"), out.slice(0, 300));
});

// **配るものに型注釈を残さない。** 1つでも残ると、その経路を通った瞬間に落ちる。
test("配るものに、剥がせない型注釈が残っていない", () => {
  const pkg = JSON.parse(readFileSync(join(KIT, "package.json"), "utf8"));

  const found = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (name.endsWith(".ts")) found.push(relative(KIT, path));
    }
  };
  for (const entry of pkg.files) {
    const path = join(KIT, entry);
    if (statSync(path).isDirectory()) walk(path);
    else if (entry.endsWith(".ts")) found.push(entry);
  }

  assert.deepEqual(found, [], `配るものに型注釈のファイルが残っている:\n${found.join("\n")}`);
});

// **型は文書として残っていること。** 剥がした跡に説明だけが残り、何も説明して
// いない状態を作らない。実際に、変換した直後がその状態だった（AUT-97）。
test("参照されている型が、すべて定義されている", async () => {
  const { readdirSync } = await import("node:fs");

  const defined = new Set();
  const used = new Set();
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) {
        walk(path);
        continue;
      }
      if (!name.endsWith(".js")) continue;
      const body = readFileSync(path, "utf8");
      // **コメントの塊をまたがないこと。** またぐと、1つ目の型の名前を読み飛ばし、
      // 間にある文章を型の中身として読む。**落ちるが、落ちる理由が嘘になる。**
      // 実際に、そう読んだ（AUT-112）。
      const TYPEDEF = /@typedef \{((?:(?!\*\/)[\s\S])*?)\} (\w+)/g;
      for (const m of body.matchAll(TYPEDEF)) {
        defined.add(m[2]);
        for (const t of m[1].matchAll(/\b([A-Z]\w+)\b/g)) used.add(t[1]);
      }
    }
  };
  walk(join(KIT, "src"));

  // 標準で入っているものは、定義を持たない。
  const builtin = new Set([
    "Record", "Partial", "Promise", "Array", "Map", "Set", "ReadonlyArray",
    "D1Database", "Response", "Request", "Date", "Error", "URL", "Buffer",
  ]);
  const missing = [...used].filter((t) => !defined.has(t) && !builtin.has(t));
  assert.deepEqual(missing, [], `定義の無い型が参照されている: ${missing.join(", ")}`);
  assert.ok(defined.size > 20, `型の説明が少なすぎる: ${defined.size} 個`);
});
