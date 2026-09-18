/**
 * 置いたものの指紋。
 *
 * ## なぜ要るか
 *
 * 管理下のファイルは入れ替えのたびに上書きされる。コードにはこう書いてあった。
 *
 * > 管理下。上書きする。**ローカルの編集は、参照実装へ起票する理由になる。**
 *
 * **設計意図はあったが、編集を検出する仕掛けが無かった。** 黙って上書きしていた
 * ため、「起票する理由になる」は一度も働いていない（AUT-116）。
 *
 * 置き場所を構成に足す形（`app.credentials` / `app.destinations`）は、**形が
 * 決まっているものにしか効かない。** `devcontainer.json` の features のように、
 * 参照実装が予想していないカスタマイズには届かない。
 *
 * ## なぜ「毎回マージする」ではないか
 *
 * 管理下には `init-firewall.sh` が含まれる。**マージを間違えると出口が開き、
 * 開いたことは判定でも気づけない。** いまは「中身がテンプレートと一致する」が機械的に
 * 確かめられる。マージすると、その保証が消える。
 *
 * **正しさを誰も確かめられない仕掛けは置かない。** 検出したあとに取り込むかを
 * 判断するのは、検出されたときだけ動くので、危険を毎回は負わない。
 *
 * ## なぜ `autodrive/` に置くか
 *
 * **追跡されるため。** `.autodrive/` は追跡しないので、クローンした先には無い。
 * 手で変えて commit した人と、それをクローンした人とで、判定が変わってしまう。
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** 置き場所。**autodrive-dev-kit の中に置く。** 入れ替えのたびに書き直される。 */
export const MANIFEST_FILE = "manifest.json";

/** 中身の指紋。 */
export function fingerprint(body) {
  return createHash("sha256").update(body, "utf8").digest("hex");
}

/**
 * 読む。
 *
 * **壊れていても落とさない。** 指紋が読めないことは、編集されたことではない。
 * 読めなければ「確かめられない」として扱い、後段が黙らない形で報告する。
 */
export function readManifest(path) {
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8"));
    if (raw === null || typeof raw !== "object") return null;
    const files = raw.files;
    if (files === null || typeof files !== "object") return null;
    return files;
  } catch {
    return null;
  }
}

export function writeManifest(path, writes) {
  const files = {};
  for (const w of writes) files[w.path] = fingerprint(w.body);
  writeFileSync(path, `${JSON.stringify({ version: 1, files }, null, 2)}\n`, "utf8");
}

/**
 * 手で変えられたものを見つける。
 *
 * **指紋が無いものは、変えられたことにしない。** この仕掛けより前に置かれた
 * プロジェクトでは指紋そのものが無い。そこで止めると、**入れ替えられなくなる。**
 * 代わりに「確かめていない」として返し、呼び出し側が黙らないようにする。
 *
 * **中身が同じなら、何も言わない。** 上書きしても失われるものが無いため。
 *
 * @param {string} root
 * @param {Array<{ path: string, body: string }>} writes これから置くもの
 * @param {Record<string, string> | null} manifest 前に置いたときの指紋
 * @returns {{ edited: Array<{ path: string, lost: string[] }>, unchecked: string[] }}
 */
export function findEdits(root, writes, manifest) {
  const edited = [];
  const unchecked = [];

  for (const w of writes) {
    const full = join(root, w.path);
    // 無いものは、置くだけである。消えるものが無い。
    if (!existsSync(full)) continue;

    let current;
    try {
      current = readFileSync(full, "utf8");
    } catch {
      unchecked.push(w.path);
      continue;
    }

    // 中身が変わらないなら、上書きしても何も失われない。
    if (current === w.body) continue;

    const known = manifest?.[w.path];
    if (known === undefined) {
      // **指紋が無い。** 手で変えたのか、前のバージョンの中身なのかを区別できない。
      unchecked.push(w.path);
      continue;
    }
    // 指紋どおりなら、変わったのは参照実装の側である。上書きしてよい。
    if (fingerprint(current) === known) continue;

    edited.push({ path: w.path, lost: linesLost(current, w.body) });
  }
  return { edited, unchecked };
}

/**
 * 上書きすると消える行。
 *
 * **差分ではなく、消えるものだけを出す。** 知りたいのは「自分が足したものが
 * どうなるか」であり、参照実装が何を変えたかではない。
 *
 * 並び順は見ない。行が動いただけのものを「消える」と言わないため。
 */
export function linesLost(current, next) {
  const incoming = new Set(next.split("\n").map((l) => l.trim()));
  const seen = new Set();
  const lost = [];
  for (const line of current.split("\n")) {
    const key = line.trim();
    if (key === "" || incoming.has(key) || seen.has(key)) continue;
    seen.add(key);
    lost.push(line.trim());
  }
  return lost;
}

/**
 * 人が読む形にする。
 *
 * **何が消えるのかを出す。** 「変えられている」だけでは、何をすればよいか
 * 分からない。**そして、どうすればよいかまで出す**（配布物の停止の作法）。
 *
 * 長い場合は打ち切る。**打ち切ったことは言う。** 黙って切ると、出ている分が
 * 全部だと読まれる。
 */
export function describeEdits(edited, limit = 8) {
  const lines = [
    "管理下のファイルが手で変えられている。**このまま入れ替えると消える。**",
    "",
  ];

  for (const e of edited) {
    lines.push(`  ${e.path}`);
    for (const l of e.lost.slice(0, limit)) lines.push(`      ${l}`);
    if (e.lost.length > limit) lines.push(`      … 他 ${e.lost.length - limit} 行`);
    lines.push("");
  }

  lines.push(
    "**何も書いていない。** 一部だけ新しい状態を作らないため。",
    "",
    "次のどちらかを行うこと。",
    "  - このプロジェクトだけの事情なら: 構成（autodrive.json）で表せないかを見る。",
    "    表せないなら、autodrive-dev-kit へ起票する。**予想していない拡張は、そこで受け取る。**",
    "  - 変更が要らないなら: その行を戻してから、もう一度実行する。",
  );
  return lines.join("\n");
}

/** 確かめられなかったものを報告する。**黙ると、確かめた顔になる。** */
export function describeUnchecked(unchecked) {
  return [
    `手で変えられていないかを確かめられなかった（${unchecked.length}件）。**上書きした。**`,
    ...unchecked.map((p) => `  ${p}`),
    "",
    "置いたときの指紋が無い。この仕掛けより前に置かれたためである。",
    "**次からは確かめられる。**",
  ].join("\n");
}

export function manifestPath(root, vendorDir) {
  return join(root, vendorDir, MANIFEST_FILE);
}
