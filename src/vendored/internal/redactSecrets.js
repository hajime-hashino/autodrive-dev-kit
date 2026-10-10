/**
 * ツールの出力から、秘密の値を置き換える。実行基盤の PostToolUse フックから呼ばれる（AUT-275）。
 *
 * ## 何が起きたか
 *
 * AI が `.env` に値が入っているかを確かめるとき、シェルの式を誤って（`echo
 * "${v:+set}${v:-EMPTY}"`。値が入っていると `${v:-EMPTY}` が値そのものになる）、
 * API トークン2つをツールの出力に出した。**出力は会話の記録に残るため、2つとも
 * 失効させて作り直した。**
 *
 * ## 止めずに、置き換える
 *
 * **実行前にコマンドの文字列を見て止める形は取らない。** 書き方を変えればすり抜け、
 * 正しいコマンドまで止める。上の式も、変数名が `v` なので「KEY・TOKEN・SECRET を
 * 含む変数の echo」では止まらない。**防げていない事故を、防げているように見せる。**
 *
 * 代わりに、**出てきた出力を `.env` の値そのものと突き合わせる。** 書き方に依らない。
 *
 * ## 置き換えれば、AI に届かない
 *
 * `updatedToolOutput` に **`tool_response` と同じ形**を返すと、AI が受け取る出力が
 * 置き換わり、**セッション記録にも元の値が残らない**（Claude Code 2.1.241 で実測）。
 * **文字列を返すと置き換わらない。** Bash の出力は `{ stdout, stderr, ... }` であり、
 * 形が合わないと黙って捨てられる。だから形を保ったまま中の文字列だけを書き換える。
 *
 * ## 何を秘密とみなすか
 *
 * - `.env` の値。ただし**秘密でないと分かっている名前**（`credentials.js` の
 *   `secret: false`、`app.credentials` の `secret: false`）と、**短い値**は除く。
 *   コミットの作者や `default` のような値を置き換えると、正しい出力が読めなくなり、
 *   知らせが多すぎて本物が読み流される
 * - 発行元が形を決めているトークン（`tracked.js` の `SECRETS` と、ここで足すもの）。
 *   `.env` に無い鍵が出ても拾う
 *
 * **書かれていない名前は秘密として扱う。** 迷ったら隠す側に倒す。
 *
 * ## 拾えないもの
 *
 * 加工された形（base64、一部だけ、行をまたぐもの）。そして `.env` の外から来た、
 * 形の決まっていない値。**ここは最後の網であり、値を出さない書き方が先にある**
 * （`env check`）。
 *
 * ## 知らせと記録
 *
 * AI には `additionalContext` で、人には `systemMessage` で知らせる。記録は着手中の
 * 作業単位の作業ログに残す。**値は書かない。** 秘密の漏れは定義§6の5種類のどれにも
 * 当たらないため、テレメトリには種別を足さない（人の判断、2026-10-10）。
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readConfig } from "./config.js";
import { NOT_SECRET } from "./credentials.js";
import { SECRETS } from "./tracked.js";

/**
 * これより短い値は突き合わせない。
 *
 * **発行される鍵は、どれもこれより長い。** 短い値（`default`、`true`、ポート番号）は
 * 出力のあちこちに現れ、置き換えると出力が壊れる。
 */
export const MIN_LENGTH = 12;

/**
 * `tracked.js` に無い、形の決まったトークン。
 *
 * **追跡されているファイルの検査には足さない。** あちらは配った先のリポジトリ全体を
 * 見ており、偽陽性の重さが違う。ここで外れても、出力の一部が読めなくなるだけである。
 */
const MORE_SHAPES = [
  { re: /\bcfut_[A-Za-z0-9_-]{20,}/, label: "Cloudflare token" },
  { re: /\bcfat_[A-Za-z0-9_-]{20,}/, label: "Cloudflare token" },
  { re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/, label: "Slack token" },
  { re: /\bsk-[A-Za-z0-9_-]{20,}/, label: "API key" },
];

/** 置き換えに使う形。**`g` を付け直す。** 1つ目だけ置き換えると、2つ目が残る。 */
export const SHAPES = [
  ...SECRETS.map((s) => ({ re: s.re, label: s.why })),
  ...MORE_SHAPES,
].map((s) => ({ re: new RegExp(s.re.source, s.re.flags.includes("g") ? s.re.flags : `${s.re.flags}g`), label: s.label }));

/**
 * `.env` を読む。**値の解釈は、読み込む側（sh の `.`）に合わせる。**
 *
 * 囲みの引用符は外す。外さないと、出力に現れる値（引用符なし）と一致しない。
 *
 * @returns {Array<{ name: string, value: string }>}
 */
export function parseEnv(text) {
  const out = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (m === null) continue;
    let value = m[2].trim();
    const quoted = /^(['"])(.*)\1$/.exec(value);
    if (quoted !== null) value = quoted[2];
    out.push({ name: m[1], value });
  }
  return out;
}

/**
 * 突き合わせる値を選ぶ。**長い順に並べる。** 短い値が長い値の一部だった場合、
 * 先に短いほうを置き換えると、長いほうの残りが出力に残る。
 *
 * @param {Set<string>} notSecret
 */
export function secretsFrom(entries, notSecret) {
  return entries
    .filter((e) => e.value.length >= MIN_LENGTH && !notSecret.has(e.name))
    .sort((a, b) => b.value.length - a.value.length);
}

/**
 * 文字列の中を置き換える。
 *
 * @param {Set<string>} found 当たった名前を足していく
 */
export function redactText(text, secrets, found) {
  let out = text;
  for (const s of secrets) {
    if (!out.includes(s.value)) continue;
    out = out.split(s.value).join(`[redacted: ${s.name}]`);
    found.add(s.name);
  }
  for (const shape of SHAPES) {
    shape.re.lastIndex = 0;
    if (!shape.re.test(out)) continue;
    shape.re.lastIndex = 0;
    out = out.replace(shape.re, `[redacted: ${shape.label}]`);
    found.add(shape.label);
  }
  return out;
}

/**
 * 出力の形を保ったまま、中の文字列だけを置き換える。
 *
 * **形を変えない。** 形が合わないと、実行基盤は置き換えを黙って捨てる（実測）。
 */
export function redact(value, secrets, found = new Set()) {
  const walk = (v) => {
    if (typeof v === "string") return redactText(v, secrets, found);
    if (Array.isArray(v)) return v.map(walk);
    if (v !== null && typeof v === "object") {
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    }
    return v;
  };
  return { output: walk(value), found: [...found] };
}

/**
 * 秘密でない名前。表に書かれたものと、プロジェクトが `app.credentials` に
 * `secret: false` と書いたもの。
 *
 * **構成が読めなくても止めない。** 表の分だけで続ける。秘密として扱う側に倒れる。
 */
export function notSecretAt(root) {
  const names = new Set(NOT_SECRET);
  const { config } = readConfig(root);
  for (const c of config?.app?.credentials ?? []) {
    if (c.secret === false) names.add(c.name);
  }
  return names;
}

/**
 * フックの入力から、返すものを組み立てる。当たらなければ null。
 *
 * @param {{ tool_name?: unknown, tool_input?: unknown, tool_response?: unknown }} input
 * @param {Array<{ name: string, value: string }>} secrets
 * @param {(text: string) => string} note 作業ログに残し、結果を一文で返す
 */
export function respond(input, secrets, note) {
  if (input.tool_response === undefined) return null;
  const { output, found } = redact(input.tool_response, secrets);
  if (found.length === 0) return null;

  const tool = typeof input.tool_name === "string" ? input.tool_name : "a tool";
  const names = found.join(", ");
  // **コマンドも置き換えてから使う。** 値を打ち込んだコマンドだった場合に、記録へ写る。
  const command = (() => {
    const c = /** @type {{ command?: unknown }} */ (input.tool_input ?? {}).command;
    if (typeof c !== "string") return "";
    const clean = redactText(c, secrets, new Set());
    return clean.length > 200 ? `${clean.slice(0, 200)}…` : clean;
  })();

  const logged = note(
    [
      `A secret appeared in the output of ${tool} and was replaced before it reached the AI (${names}).`,
      command === "" ? "" : `Command: ${command}`,
      "The value is not written here.",
    ]
      .filter((l) => l !== "")
      .join("\n"),
  );

  return {
    systemMessage:
      `A secret (${names}) appeared in the output of ${tool}. **It was replaced before it reached the AI and is not in the session record.** ` +
      `No need to revoke it for this. ${logged}`,
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      updatedToolOutput: output,
      additionalContext:
        `The output contained a secret (${names}) and it was replaced with [redacted: ...]. ` +
        "**Do not try to see the value another way.** To check whether a credential is set, use " +
        "`autodrive-dev-kit env check <NAME>...`, which prints only set / empty / unset.",
    },
  };
}

/** 参照実装の入口。**複製先でも同じ辿り方で届く。** */
const CLI = resolve(dirname(fileURLToPath(import.meta.url)), "cli.js");

/**
 * 作業ログへ残す。**失敗しても止めない。** 失敗したことは文で返し、人への知らせに載せる。
 *
 * **フックには `.env` が読み込まれていない**（CLAUDE_ENV_FILE は SessionStart にしか
 * 効かない）。Tracker の鍵は、読んだ `.env` から渡す。
 */
export function noteToWorkLog(root, entries) {
  return (text) => {
    const env = { ...process.env };
    for (const e of entries) if (env[e.name] === undefined) env[e.name] = e.value;
    const r = spawnSync(process.execPath, [CLI, "tracker", "append-to-work-log", "--text", text], {
      cwd: root,
      env,
      encoding: "utf8",
      timeout: 30_000,
    });
    return r.status === 0
      ? "It was noted in the work log."
      : "**It could not be noted in the work log** (no work item started, or the Tracker could not be reached).";
  };
}

const invokedDirectly = process.argv[1] !== undefined && import.meta.filename === resolve(process.argv[1]);
if (invokedDirectly) {
  try {
    const input = JSON.parse(readFileSync(0, "utf8"));
    const root = process.env.CLAUDE_PROJECT_DIR ?? (typeof input.cwd === "string" ? input.cwd : process.cwd());
    const envPath = join(root, ".env");
    const entries = existsSync(envPath) ? parseEnv(readFileSync(envPath, "utf8")) : [];
    const result = respond(input, secretsFrom(entries, notSecretAt(root)), noteToWorkLog(root, entries));
    if (result !== null) process.stdout.write(JSON.stringify(result));
  } catch (error) {
    // **エージェントを止めない。** 置き換えられなかったことは、標準エラーに残す。
    console.error(`redact-secrets: ${error instanceof Error ? error.message : String(error)}`);
  }
}
