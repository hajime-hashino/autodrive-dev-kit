/**
 * トークン消費の送り先。**OTLP over HTTP/JSON で送る。**
 *
 * ## なぜブランチに載せないか
 *
 * トークンの記録はフック（Stop / SessionEnd）が書く。**順番が決まっている。**
 * コミット → 提出 → 報告して止まる → ここでフックが走る。**最後の1件は構造的に
 * その作業単位のコミットに入らない**（AUT-156）。
 *
 * 以前は次の着手のときに拾ってコミットしていた。**拾えるのは、同じ作業ツリーが
 * 残っている場合に限られる。** 作業単位ごとにワークツリーを作って捨てる並列実行
 * では拾う機会そのものが消え、並列度が上がるほど欠損が増える（AUT-162）。
 *
 * **そして、拾った記録は次の作業単位の提出に乗る。** 作業と無関係の変更が提出に
 * 混ざるため、読む人に説明が要る。説明が要る時点で、形として歪んでいる。
 *
 * ブランチに載せない以上、行き先は作業ツリーの外になる。
 *
 * ## なぜ OTLP か。**送り先の名前で書かないため**
 *
 * ここが話すのは OTLP であって、特定のサービスの API ではない。宛先と認証は
 * 構成から受け取る。**送り先を変えても、このファイルは変わらない。**
 *
 * 定義§16が Telemetry の実装例として挙げているのも OTLP である。
 *
 * **送り先の固有名を、この中に書かないこと。** 唯一の例外は下の属性名で、これは
 * 受け側が読む語である。値ではなく語彙であり、宛先を変えれば読まれずに無視される。
 *
 * ## 送るのは数だけである
 *
 * **会話の中身を送らない。** 送るのはモデル名・トークン数・作業単位ID・セッション
 * 識別子に限る。受け側は入出力の本文も受け取れるが、**外へ出す理由が無い。**
 *
 * ## 依存を増やさない
 *
 * OTLP over HTTP/JSON は素の POST で送れる。OpenTelemetry の SDK を入れると、
 * 依存とバックグラウンドの送信処理が増える。**フックは常に 0 で終わる短命な
 * プロセスであり、まとめて後で送る仕組みとは噛み合わない。**
 */

import { randomBytes } from "node:crypto";

/** OTLP の span kind。内部処理なので INTERNAL（1）。 */
const SPAN_KIND_INTERNAL = 1;

/**
 * 宛先と認証。**構成から読む。**
 *
 * 名前は OpenTelemetry の環境変数の慣習に合わせている（`OTEL_EXPORTER_OTLP_*`）。
 * **送り先の名前を付けない。** 付けると、差し替えのたびに名前が嘘になる。
 */
export function otlpTarget(env) {
  const endpoint = typeof env.AUTODRIVE_OTLP_ENDPOINT === "string" ? env.AUTODRIVE_OTLP_ENDPOINT.trim() : "";
  const raw = typeof env.AUTODRIVE_OTLP_HEADERS === "string" ? env.AUTODRIVE_OTLP_HEADERS.trim() : "";
  if (endpoint === "") return null;

  // `key=value,key=value`。OTEL_EXPORTER_OTLP_HEADERS と同じ書き方にしている。
  // **値に `=` が入りうる**（Basic 認証の base64 は `=` で終わる）ので、最初の
  // `=` だけで割る。
  const headers = {};
  for (const pair of raw.split(",")) {
    const at = pair.indexOf("=");
    if (at <= 0) continue;
    headers[pair.slice(0, at).trim()] = pair.slice(at + 1).trim();
  }
  return { endpoint, headers };
}

/** 属性1つ。OTLP は型を明示させる。 */
const attr = (key, value) =>
  typeof value === "number"
    ? { key, value: { intValue: String(value) } }
    : { key, value: { stringValue: String(value) } };

/**
 * 送る中身を組み立てる。**送信はしない。**
 *
 * 分けているのは、組み立てが正しいことをネットワーク無しで確かめられるように
 * するためである。
 *
 * モデルごとに1つの span を作る。受け側はモデル名とトークン数から費用を出すため、
 * **モデルを混ぜた合計にすると費用が出せない。**
 */
export function buildPayload({ usages, workItemId, sessionId, kitVersion, repo, now }) {
  const ts = now.getTime();
  // ミリ秒しか持っていない。ナノ秒へ上げる。
  const endNano = String(ts * 1_000_000);
  const traceId = randomBytes(16).toString("hex");

  const spans = usages.map((usage) => {
    // **受け側が費用を出すための形。** input / output のほかにキャッシュの内訳も
    // 渡す。名前は受け側が読む語であり、こちらが決めるものではない。
    const usageDetails = {
      input: usage.input_tokens,
      output: usage.output_tokens,
      cache_creation_input_tokens: usage.cache_creation_input_tokens,
      cache_read_input_tokens: usage.cache_read_input_tokens,
    };

    const attributes = [
      attr("langfuse.observation.type", "generation"),
      attr("langfuse.observation.model.name", usage.model),
      attr("gen_ai.request.model", usage.model),
      attr("langfuse.observation.usage_details", JSON.stringify(usageDetails)),
      // **作業単位IDは、trace と observation の両方に付ける。** 受け側の集計は
      // observation 単位で動くため、trace にだけ付けると絞り込めない。
      attr("langfuse.trace.name", workItemId ?? "作業単位に帰属しない"),
      attr("langfuse.trace.metadata.work_item_id", workItemId ?? ""),
      attr("langfuse.trace.metadata.kit_version", kitVersion),
      attr("langfuse.observation.metadata.work_item_id", workItemId ?? ""),
      attr("langfuse.observation.metadata.kit_version", kitVersion),
      attr("langfuse.observation.metadata.responses", usage.responses),
      attr("langfuse.session.id", sessionId),
    ];
    if (repo !== null && repo !== undefined) {
      attributes.push(attr("langfuse.trace.metadata.repo", repo));
      attributes.push(attr("langfuse.observation.metadata.repo", repo));
    }
    // **帰属できなかった理由も送る。** 送らないと、作業単位の無い記録が
    // 「壊れたもの」と見分けられない（定義§6）。
    if (usage.unattributedReason !== undefined) {
      attributes.push(attr("langfuse.observation.metadata.unattributed_reason", usage.unattributedReason));
    }

    return {
      traceId,
      spanId: randomBytes(8).toString("hex"),
      name: `tokens ${usage.model}`,
      kind: SPAN_KIND_INTERNAL,
      // 区間ではなく時点の記録である。**幅を持たせない。**
      startTimeUnixNano: endNano,
      endTimeUnixNano: endNano,
      attributes,
    };
  });

  return {
    resourceSpans: [
      {
        resource: { attributes: [attr("service.name", "autodrive-dev-kit"), attr("service.version", kitVersion)] },
        scopeSpans: [{ scope: { name: "autodrive-dev-kit" }, spans }],
      },
    ],
  };
}

/**
 * 送る。**失敗してもエージェントを止めない。**
 *
 * フックから呼ばれる。トークン消費は任意の記録対象であり（定義§6）、送れなかった
 * ことを失敗として扱わない。**ただし黙らない。** 理由を返し、呼び出し側が出す。
 */
export async function send(payload, target, { fetchImpl = fetch, timeoutMs = 5000 } = {}) {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    const res = await fetchImpl(target.endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", ...target.headers },
      body: JSON.stringify(payload),
      signal: abort.signal,
    });
    if (!res.ok) return { ok: false, note: `The destination returned ${res.status}` };
    return { ok: true, note: "sent" };
  } catch (e) {
    // **理由を残す。** 落ちた理由が分からないと、設定の誤りと通信の失敗を
    // 見分けられない。
    return { ok: false, note: `Could not send: ${e instanceof Error ? e.message : String(e)}` };
  } finally {
    clearTimeout(timer);
  }
}
