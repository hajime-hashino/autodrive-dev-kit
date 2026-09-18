/**
 * 追跡してはいけない種類のファイルを見つける。
 *
 * ## なぜ作ったか
 *
 * 39MB のコアダンプが commit され、**資格情報の値が平文で含まれていた**（AUT-137）。
 * 配布物は「本番の資格情報を手元に置かない」を守ることに挙げているのに、**検出手段が
 * どこにも無かった。** 規約はあるが働いていない、という型である。
 *
 * ## なぜ「鍵を探す」形にしないか
 *
 * **既製品のほうが上手い。** 追いつけないし、追いつく必要も無い。
 *
 * ただし測ったところ、**既製品が構造的に見ない場所がある。**
 *
 * ```
 * gitleaks に 39MB のテキスト → scanned ~40894464 bytes（全部走査する）
 * gitleaks にバイナリ         → scanned ~0 bytes    （走査すらしない）
 * ```
 *
 * **大きさではなく、バイナリだから飛ばしている。** コアダンプはバイナリなので、
 * gitleaks では捕まらない。GitHub の Secret Protection は private + Free では
 * そもそも使えない。
 *
 * **だからここでは、パターンを探さない。** 名前と先頭の数バイトで決まるものだけを
 * 見る。推測が要らず、依存も要らず、既製品が見ない場所をちょうど埋める。
 *
 * ## 中身を出さないこと
 *
 * **見つけたものの中身を、出力にも記録にも載せない。** 直すための仕掛けが漏洩の
 * 経路になっては本末転倒である。出すのは、どのファイルが何に当たるかだけ。
 */

import { existsSync, openSync, readSync, closeSync, statSync } from "node:fs";
import { basename, join } from "node:path";

/** ELF の先頭。コアダンプはこれで始まる。 */
const ELF = Buffer.from([0x7f, 0x45, 0x4c, 0x46]);

/**
 * 名前だけで判断できるもの。
 *
 * **`.env.example` は除く。** あれは値を持たないテンプレートであり、追跡するのが正しい。
 */
const BY_NAME = [
  { test: (n) => /^core(\.\d+)?$/.test(n), why: "コアダンプ。実行時のメモリがそのまま入る" },
  { test: (n) => n === ".env" || (n.startsWith(".env.") && n !== ".env.example"), why: "資格情報" },
  { test: (n) => /\.(pem|key|p12|pfx|jks)$/.test(n), why: "鍵ファイル" },
  { test: (n) => /^id_(rsa|dsa|ecdsa|ed25519)$/.test(n), why: "秘密鍵" },
];

/** 先頭が ELF か。**中身は読まない。4バイトだけ見る。** */
export function looksExecutable(path) {
  try {
    if (statSync(path).size < 4) return false;
    const fd = openSync(path, "r");
    const head = Buffer.alloc(4);
    readSync(fd, head, 0, 4, 0);
    closeSync(fd);
    return head.equals(ELF);
  } catch {
    return false;
  }
}

/**
 * 追跡されているファイルのうち、置いてはいけないものを返す。
 *
 * **中身は返さない。** どのファイルが、なぜ駄目かだけを返す。
 *
 * @param {string} root
 * @param {string[]} files 追跡されているファイルの一覧
 * @returns {Array<{ path: string, why: string }>}
 */
export function forbidden(root, files) {
  const found = [];
  for (const path of files) {
    const name = basename(path);
    const byName = BY_NAME.find((r) => r.test(name));
    if (byName !== undefined) {
      found.push({ path, why: byName.why });
      continue;
    }
    // 名前で分からないものは、先頭だけ見る。**コアダンプは名前を変えられる。**
    const full = join(root, path);
    if (existsSync(full) && looksExecutable(full)) {
      found.push({ path, why: "実行形式。追跡する理由が無ければ置かない" });
    }
  }
  return found;
}

/**
 * 人が読む形にする。
 *
 * **何をすればよいかまで出す。** 「見つかった」だけでは、消せばよいのか履歴ごと
 * 消すのかが分からない。**履歴に入っていれば、消すコミットを積むだけでは消えない。**
 */
export function describe(found) {
  if (found.length === 0) return [];
  const lines = [
    "",
    "追跡してはいけないものが追跡されている:",
    "",
  ];
  for (const f of found) lines.push(`  ${f.path}  — ${f.why}`);
  lines.push(
    "",
    "**履歴に入っている場合、消すコミットを積むだけでは消えない。**",
    "資格情報が含まれていた可能性があるなら、**まず失効させること。**",
    "失効させれば、どこに複製が残っていても無意味になる。**消し切るより確実で安い。**",
  );
  return lines;
}
