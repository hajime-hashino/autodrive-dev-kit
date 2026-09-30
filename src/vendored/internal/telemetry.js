/** テレメトリ（JSONL）の読取。 */

import { canonicalValue } from "./ports/telemetry.js";


/** 帰属できなかった記録の置き場。作業単位を解決できない場合だけここへ落ちる。 */
export const UNATTRIBUTED_FILE = "unattributed.jsonl";

export const REQUIRED_EVENT_ATTRS = [
  "work_item_id",
  "model",
  "kit_version",
  "emitter",
];

/** 書き込み経路。誰が内容を決めたかではなく、アダプタを通ったかを表す。 */
export const EMITTERS = ["adapter", "manual"];

/** @typedef {{ source: string, [key: string]: unknown }} TelemetryEvent */
export function loadEvents(repos) {
  const events = [];
  const broken = [];
/** @typedef {{ events: TelemetryEvent[], broken: string[] }} TelemetryLoad */
  for (const repo of repos) {
    for (const path of repo.telemetryFiles()) {
      const name = path.split("/").at(-1);
      const lines = repo.read(path).split("\n");
      lines.forEach((line, index) => {
        if (line.trim() === "") return;
        try {
          const parsed = JSON.parse(line);
          // **前の版の日本語の値を、英語へ揃えて読む**（AUT-267）。書き直さずに読み替える。
          // 記録そのものは遡って書き換えない（定義§6）。
          const read = { ...parsed, source: `${repo.name}/telemetry/${name}` };
          if ("stop_type" in read) read.stop_type = canonicalValue(read.stop_type);
          if ("cause" in read) read.cause = canonicalValue(read.cause);
          events.push(read);
        } catch (error) {
          const why = error instanceof Error ? error.message : String(error);
          broken.push(`${repo.name}/${name}:${index + 1} cannot be read as JSON (${why})`);
        }
      });
    }
  }
  return { events, broken };
}

/**
 * 該当する不変条件について、代替を記録したイベントを新しい順に返す。
 *
 * 代替の事実は宣言用のファイルではなく記録そのものから読む。宣言を別に持つと、
 * 記録と宣言という2つの真実ができ、宣言だけを更新して有効を名乗る経路が開く。
 */
export function substitutionNotes(
  events ,
  invariantKey ,
) {
  return events
    .filter((e) => e.type === "substitution" && e.invariant === invariantKey)
    .sort((a, b) => String(b.ts ?? "").localeCompare(String(a.ts ?? "")));
}

export function firstSubstitutionDetail(
  events ,
  invariantKey ,
) {
  const note = substitutionNotes(events, invariantKey)[0];
  if (note === undefined) return null;
  return typeof note.detail === "string" ? note.detail : "(no details written)";
}

/**
 * 帰属できなかった記録か。
 *
 * **置き場と理由の両方を要求する。** 片方だけでは抜け道になる。理由だけを見ると、
 * どの記録も「帰属できなかった」と名乗れば作業単位を持たずに済む。置き場だけを
 * 見ると、そのファイルへ何でも投げ込めばよいことになる。
 *
 * 帰属できないことが正当な場面は実在する。作業単位を起こすかどうかの検討や、
 * 起票されていない依頼がそれにあたる。**定義§6（v0.10）はこれらを§6のイベント
 * ではないと整理している。** 壊れた記録として扱うと、正しく動いた記録が失敗と
 * して現れ続ける。
 */
export function isUnattributed(event) {
  const inFile = event.source.endsWith(`/${UNATTRIBUTED_FILE}`);
  const reason = event.unattributed_reason;
  return inFile && typeof reason === "string" && reason.trim() !== "";
}
