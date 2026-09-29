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

/**
 * 書く。**置いたときのポートも残す。**
 *
 * 次の入れ替えが、ポートが変わったかを知るため。`autodrive.json` だけでは、
 * 書き換えられたあとの値しか読めない（AUT-248）。
 *
 * @param {string} path
 * @param {Array<{ path: string, body: string }>} writes
 * @param {Record<string, string> | null} [ports]
 */
export function writeManifest(path, writes, ports = null) {
  const files = {};
  // **行の指紋も残す。** 手で変えられて止まったとき、どの行を人が足したのかを
  // 言うため。ファイルの指紋だけでは「変わった」までしか分からず、新しい版と
  // 比べると kit が変えた行まで人の変更に見える（#115）。
  const lines = {};
  for (const w of writes) {
    files[w.path] = fingerprint(w.body);
    lines[w.path] = lineFingerprints(w.body);
  }
  const body = ports === null ? { version: 1, files, lines } : { version: 1, ports, files, lines };
  writeFileSync(path, `${JSON.stringify(body, null, 2)}\n`, "utf8");
}

/**
 * 行ごとの短い指紋。**中身は残さない。** 並び順も数も見ない（`linesLost` と同じ）。
 *
 * @param {string} body
 * @returns {string[]}
 */
export function lineFingerprints(body) {
  const set = new Set();
  for (const line of body.split("\n")) {
    const key = line.trim();
    if (key !== "") set.add(fingerprint(key).slice(0, 12));
  }
  return [...set].sort();
}

/**
 * 前に置いたときの、行の指紋を読む。**無ければ null。** この記録より前に置かれた
 * ものには無い。
 *
 * @param {string} path
 * @returns {Record<string, string[]> | null}
 */
export function readPlacedLines(path) {
  if (!existsSync(path)) return null;
  try {
    const lines = JSON.parse(readFileSync(path, "utf8"))?.lines;
    return lines !== null && typeof lines === "object" && !Array.isArray(lines) ? lines : null;
  } catch {
    return null;
  }
}

/**
 * 前に置いたときのポートを読む。
 *
 * **無ければ null。** この記録より前に置かれたものには無い。変わっていないことと
 * 区別できないため、呼び出し側は「確かめていない」として扱う。
 *
 * @param {string} path
 * @returns {Record<string, string> | null}
 */
export function readPlacedPorts(path) {
  if (!existsSync(path)) return null;
  try {
    const ports = JSON.parse(readFileSync(path, "utf8"))?.ports;
    return ports !== null && typeof ports === "object" && !Array.isArray(ports) ? ports : null;
  } catch {
    return null;
  }
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
 * @param {Record<string, string[]> | null} [placedLines] 前に置いたときの、行の指紋
 * @returns {{ edited: Array<{ path: string, lost: string[], exact: boolean }>, unchecked: string[] }}
 */
export function findEdits(root, writes, manifest, placedLines = null) {
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

    // **前に置いた中身と比べられるなら、人が足した行だけを出す。** 新しい版と比べると、
    // kit が文言を変えた行まで「消える」に入り、人は全部を自分の変更だと読む（#115）。
    const placed = placedLines?.[w.path];
    if (Array.isArray(placed)) {
      const known = new Set(placed);
      const lost = linesLost(current, w.body).filter((l) => !known.has(fingerprint(l).slice(0, 12)));
      edited.push({ path: w.path, lost, exact: true });
    } else {
      edited.push({ path: w.path, lost: linesLost(current, w.body), exact: false });
    }
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
    "Managed files were changed by hand. **Replacing them as-is would erase those changes.**",
    "",
  ];

  for (const e of edited) {
    lines.push(`  ${e.path}`);
    // **比べた相手を言う。** 前に置いた中身が分からなければ、kit が変えた行も混ざる。
    if (e.exact === false) {
      lines.push("      (the previously placed contents are unknown, so this includes lines whose wording autodrive-dev-kit changed)");
    } else if (e.lost.length === 0) {
      lines.push("      (no lines were added. Only deleted or reordered)");
    }
    for (const l of e.lost.slice(0, limit)) lines.push(`      ${l}`);
    if (e.lost.length > limit) lines.push(`      … ${e.lost.length - limit} more lines`);
    lines.push("");
  }

  lines.push(
    "**Nothing was written.** So as not to leave a partially updated state.",
    "",
    "Do one of the following.",
    "  - If it is specific to this project: see whether the configuration (autodrive.json) can express it.",
    "    If it cannot, file it with autodrive-dev-kit. **Extensions nobody anticipated are taken in there.**",
    "  - If the change is not needed: revert those lines, then run again.",
  );
  return lines.join("\n");
}

/** 確かめられなかったものを報告する。**黙ると、確かめた顔になる。** */
export function describeUnchecked(unchecked) {
  return [
    `Could not confirm whether these were changed by hand (${unchecked.length}). **Overwrote them.**`,
    ...unchecked.map((p) => `  ${p}`),
    "",
    "There is no fingerprint from when they were placed, because they were placed before this mechanism existed.",
    "**From next time, it can be confirmed.**",
  ].join("\n");
}

export function manifestPath(root, vendorDir) {
  return join(root, vendorDir, MANIFEST_FILE);
}
