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
 * **だからここでは、広くパターンを探さない。** 名前と先頭の数バイトで決まるものだけを
 * 見る。推測が要らず、依存も要らず、既製品が見ない場所をちょうど埋める。
 *
 * ## ただし、この道具が実際に使う鍵だけは見る（AUT-225）
 *
 * 名前と ELF で捕まえられるのは**ファイルとして置かれた場合**である。**ソースやテスト
 * へ値が直に書かれた場合は捕まらない。** そこは既製品の領分だが、**この道具が実際に
 * 使う鍵に限れば、推測が要らない。** 接頭辞が決まっているためである。
 *
 * **広げないこと。** 「それらしい文字列」を探し始めると、既製品の劣化版になり、
 * 誤検出で本物の警告が流される。**ここに並ぶのは、`.env.example` に名前があるものだけ。**
 *
 * ## 中身を出さないこと
 *
 * **見つけたものの中身を、出力にも記録にも載せない。** 直すための仕掛けが漏洩の
 * 経路になっては本末転倒である。出すのは、どのファイルが何に当たるかだけ。
 */

import { existsSync, openSync, readFileSync, readSync, closeSync, statSync } from "node:fs";
import { basename, join } from "node:path";

/** ELF の先頭。コアダンプはこれで始まる。 */
const ELF = Buffer.from([0x7f, 0x45, 0x4c, 0x46]);

/**
 * 名前だけで判断できるもの。
 *
 * **`.env.example` は除く。** あれは値を持たないテンプレートであり、追跡するのが正しい。
 */
const BY_NAME = [
  { test: (n) => /^core(\.\d+)?$/.test(n), why: "Core dump. Contains the runtime memory as-is" },
  { test: (n) => n === ".env" || (n.startsWith(".env.") && n !== ".env.example"), why: "Credentials" },
  { test: (n) => /\.(pem|key|p12|pfx|jks)$/.test(n), why: "Key file" },
  { test: (n) => /^id_(rsa|dsa|ecdsa|ed25519)$/.test(n), why: "Private key" },
];

/**
 * この道具が実際に使う鍵の、接頭辞。
 *
 * **推測しない。** どれも発行元が形を決めており、**偽陽性がほぼ出ない。**
 * 並べてよいのは、`.env.example` に名前があるものに限る（AUT-225）。
 */
export const SECRETS = [
  { re: /\bghp_[A-Za-z0-9]{36}\b/, why: "A GitHub personal access token" },
  { re: /\bgithub_pat_[A-Za-z0-9_]{60,}\b/, why: "A GitHub fine-grained token" },
  { re: /\blin_api_[A-Za-z0-9]{40,}\b/, why: "A Tracker (Linear) key" },
  { re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/, why: "A key for calling models" },
  { re: /\bsk-lf-[A-Za-z0-9-]{20,}\b/, why: "A key for the record destination (Langfuse)" },
  { re: /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/, why: "The body of a private key" },
];

/**
 * 中身に鍵が直に書かれているか。
 *
 * **中身は返さない。** どのファイルが、何に当たるかだけを返す。**行番号も出さない。**
 * 出すと、そこを見に行く動線ができる。
 *
 * **読むのはテキストだけ。** バイナリは名前と ELF の側で見る。
 */
export function embeddedSecret(path) {
  try {
    if (statSync(path).size > 2_000_000) return null;
    const body = readFileSync(path, "utf8");
    // **正規表現そのものを書いた行を、検出しない。** この判定自身が引っかかる。
    const found = SECRETS.find((s) => s.re.test(body));
    return found === undefined ? null : found.why;
  } catch {
    return null;
  }
}

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
    if (!existsSync(full)) continue;
    if (looksExecutable(full)) {
      found.push({ path, why: "An executable. Do not keep it unless there is a reason to track it" });
      continue;
    }
    // **値が直に書かれている場合。** 名前と ELF では捕まらない（AUT-225）。
    const secret = embeddedSecret(full);
    if (secret !== null) found.push({ path, why: `${secret} is written as a raw value` });
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
    "Things that must not be tracked are tracked:",
    "",
  ];
  for (const f of found) lines.push(`  ${f.path}  — ${f.why}`);
  lines.push(
    "",
    "**If it is in the history, adding a commit that deletes it does not remove it.**",
    "If credentials may have been included, **revoke them first.**",
    "Once revoked, copies left anywhere become useless. **More certain and cheaper than erasing every copy.**",
  );
  return lines;
}
