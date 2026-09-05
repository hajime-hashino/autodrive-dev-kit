/**
 * プロジェクトの構成。
 *
 * **何で動いているかを、そのプロジェクト自身が持つ。** 参照実装が知っていても
 * 意味が無い。プロジェクトごとに違い、参照実装は複数のプロジェクトに配られる。
 *
 * これが無いと3つ困る。
 *
 *   入れ替えが、置いたときの判断を再現できない
 *   既にあるプロジェクトへ、上書きで踏み込む形になる
 *   AIが、そこに何があるかを推測で決める（プレビューが出せるのか等）
 *
 * **プロジェクトのものである。入れ替えで上書きしない。** 道具一式（`autodrive/`）は
 * 参照実装が管理して丸ごと入れ替えるが、これは決めた内容であり、決めた人のものである。
 *
 * **いま抽象化はしない。記録するだけにする。** 今日の時点で選択肢が2つ以上ある
 * ポートはほとんど無い。それでも残すのは、2つ目の実装やアプリの種別が増えたときの
 * 行き先を作るためである（ADR 0004）。
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** 置き場所。**追跡する。** 手元にあるだけでは、別の機械で別の構成になる。 */
export const CONFIG_FILE = "autodrive.json";

/** 使わないことを、決めた結果として書く。**書かないのとは違う。** */
export const NONE = "none";
/** まだ決まっていない。**「使わない」と区別する。** */
export const UNKNOWN = "unknown";

/**
 * ポートと、いま選べる実装（定義§16）。
 *
 * **1つしか無いものも並べる。** 選べないことと、選ばれたことは違う。並べておくと、
 * 2つ目が入ったときに増える場所が既にある。
 */
export const PORT_CHOICES = {
  tracker: ["linear"],
  repo: ["github"],
  runner: ["github-actions"],
  sandbox: ["devcontainer", NONE],
  preview: ["cloudflare-workers", NONE],
  telemetry: ["jsonl"],
  flag: [NONE],
};


export const PORT_NAMES = Object.keys(PORT_CHOICES);

/** @typedef {"tracker" | "repo" | "runner" | "sandbox" | "preview" | "telemetry" | "flag"} PortName */

/** @typedef {{ name: string, why: string, lost: string }} AppCredential */

/**
 * @typedef {{
 *   version: 1,
 *   language: "ja" | "en",
 *   ports: Record<PortName, string>,
 *   app: {
 *     screen: "yes" | "no" | "unknown",
 *     credentials: AppCredential[],
 *     destinations: AppDestination[],
 *   },
 * }} Config
 */

/** 環境変数として通る名前か。**雛形に書き出す行になるため、形を確かめる。** */
const CREDENTIAL_NAME = /^[A-Z][A-Z0-9_]*$/;

/**
 * アプリ自身の資格情報を読む。
 *
 * **ポートとは別に、アプリが自分の資格情報を持つ。** 題材アプリ2では、モデルを
 * 叩くための鍵がそれにあたる。ポートから組み立てるだけでは、この種のものを
 * `.env.example` に載せる方法が無かった（AUT-112）。
 *
 * **手で足せば済む話ではない。** `.env.example` は入れ替えのたびに丸ごと書き直される。
 * `.env` に値が残っている限りアプリは動き続けるため、**消えたことに気づけない。**
 * 新しく入った人が雛形を見ても、その資格情報の存在を知れない。
 *
 * **欠けていたら、既定で埋めずに止まる。** 名前だけの一覧は役に立たない。何に使う
 * のか、失ったらどうなるのかが書かれていなければ、人は何を取りに行けばよいか
 * 分からない。
 */
function readAppCredentials(raw) {
  if (raw === undefined || raw === null) return { credentials: [], error: null };
  if (!Array.isArray(raw)) {
    return { credentials: [], error: `${CONFIG_FILE} の app.credentials が配列ではない` };
  }

  const credentials = [];
  for (const [i, entry] of raw.entries()) {
    const at = `app.credentials[${i}]`;
    if (typeof entry !== "object" || entry === null) {
      return { credentials: [], error: `${CONFIG_FILE} の ${at} が項目になっていない` };
    }
    const { name, why, lost } = entry;
    if (typeof name !== "string" || !CREDENTIAL_NAME.test(name)) {
      return {
        credentials: [],
        error: `${CONFIG_FILE} の ${at}.name が環境変数の名前になっていない（英大文字・数字・_）`,
      };
    }
    for (const [key, value] of [["why", why], ["lost", lost]]) {
      if (typeof value !== "string" || value.trim() === "") {
        return {
          credentials: [],
          error:
            `${CONFIG_FILE} の ${at}.${key} が空である（${name}）。` +
            (key === "why"
              ? "何に使うのかを書くこと。書かないと、人は何を取りに行けばよいか分からない"
              : "失ったらどうなるかを書くこと。書かないと、扱いの重さを判断できない"),
        };
      }
    }
    credentials.push({ name, why: why.trim(), lost: lost.trim() });
  }
  return { credentials, error: null };
}

/** @typedef {{ host: string, why: string }} AppDestination */

/** @typedef {{ id: string, options: object, why: string }} SandboxFeature */

/**
 * 作業場に足す道具を読む。
 *
 * **ポートの語彙で持つ。** 鍵は `sandbox`（定義§16のポート名）であり、その中身を
 * どう解釈するかは実装が決める。`ports.sandbox` の値が `devcontainer` であるのと
 * 同じ関係になる。**鍵に実装名を入れない。**
 *
 * 作っているものによって、作業場に要る道具は変わる。配布するコンテナのイメージを
 * 手元で作って確かめるには Docker が要る、など。**道具が無いと、出す前に確かめ
 * られず、問題が出るのは統合の後になる**（AUT-132）。
 */
function readSandboxFeatures(raw) {
  if (raw === undefined || raw === null) return { features: [], error: null };
  if (!Array.isArray(raw)) {
    return { features: [], error: `${CONFIG_FILE} の app.sandbox.features が配列ではない` };
  }

  const features = [];
  for (const [i, entry] of raw.entries()) {
    const at = `app.sandbox.features[${i}]`;
    if (typeof entry !== "object" || entry === null) {
      return { features: [], error: `${CONFIG_FILE} の ${at} が項目になっていない` };
    }
    const { id, options, why } = entry;
    if (typeof id !== "string" || id.trim() === "") {
      return { features: [], error: `${CONFIG_FILE} の ${at}.id が空である` };
    }
    if (typeof why !== "string" || why.trim() === "") {
      return {
        features: [],
        error:
          `${CONFIG_FILE} の ${at}.why が空である（${id}）。` +
          "なぜ要るのかを書くこと。**作業場に入れたものは、AIが使える道具になる。**",
      };
    }
    if (options !== undefined && (typeof options !== "object" || options === null || Array.isArray(options))) {
      return { features: [], error: `${CONFIG_FILE} の ${at}.options が項目になっていない（${id}）` };
    }
    features.push({ id: id.trim(), options: options ?? {}, why: why.trim() });
  }
  return { features, error: null };
}

/**
 * 名前解決できる形か。**ワイルドカードは通さない。**
 *
 * 規則は名前解決した IP に対して置かれるため、`*.workers.dev` のような書き方は
 * できない。書ければ通ると思わせないために、ここで弾く。
 */
const HOST_NAME = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

/**
 * アプリ自身が叩く宛先を読む。
 *
 * **ポートとは別に、作っているものが自分で叩く先を持つ。** 外部サービス、配布した
 * 先の疎通確認など。ポートから組み立てるだけでは置く方法が無かった（AUT-115）。
 *
 * **手で足せば済む話ではない。** 許可一覧は入れ替えのたびに丸ごと書き直される。
 * それどころか、**足せと書いてあった。** 書けと言った場所が、書いたものを消していた。
 *
 * 消えると出口が閉じる。**動いていたものが `update` で止まり、止まった理由が
 * 結びつかない。**
 */
function readAppDestinations(raw) {
  if (raw === undefined || raw === null) return { destinations: [], error: null };
  if (!Array.isArray(raw)) {
    return { destinations: [], error: `${CONFIG_FILE} の app.destinations が配列ではない` };
  }

  const destinations = [];
  for (const [i, entry] of raw.entries()) {
    const at = `app.destinations[${i}]`;
    if (typeof entry !== "object" || entry === null) {
      return { destinations: [], error: `${CONFIG_FILE} の ${at} が項目になっていない` };
    }
    const { host, why } = entry;
    if (typeof host !== "string" || !HOST_NAME.test(host)) {
      return {
        destinations: [],
        error:
          `${CONFIG_FILE} の ${at}.host が宛先の形になっていない` +
          (typeof host === "string" && host.includes("*")
            ? `（${host}）。**ワイルドカードは書けない。** 規則は名前解決した IP に対して置かれる。宛先ごとに1行が要る`
            : "（小文字の英数字とハイフン、ドット区切り）"),
      };
    }
    if (typeof why !== "string" || why.trim() === "") {
      return {
        destinations: [],
        error:
          `${CONFIG_FILE} の ${at}.why が空である（${host}）。` +
          "なぜ要るのかを書くこと。**書けないなら要らない可能性が高い。**",
      };
    }
    destinations.push({ host, why: why.trim() });
  }
  return { destinations, error: null };
}
/** 既定。**推奨であって、決定ではない。** */
export function defaults() {
  return {
    version: 1,
    // **セットアップの表示だけに効く。** 開発の会話はAIが相手の言語で行う。
    language: "ja",
    ports: {
      tracker: "linear",
      repo: "github",
      runner: "github-actions",
      sandbox: "devcontainer",
      preview: NONE,
      telemetry: "jsonl",
      flag: NONE,
    },
    // **アプリ自身の資格情報も宛先も、聞かない。** 何を作るかが決まる前には
    // 分からない。何を作るかを聞き終えたあとで、AIがここへ足す。
    app: { screen: UNKNOWN, credentials: [], destinations: [], sandbox: { features: [] } },
  };
}

export function configPath(root) {
  return join(root, CONFIG_FILE);
}

export function hasConfig(root) {
  return existsSync(configPath(root));
}

/**
 * 読む。
 *
 * **壊れていれば、そう言って止まる。** 既定で埋めて進むと、決めた内容が黙って
 * 別のものに入れ替わる。
 */
export function readConfig(root) {
  const path = configPath(root);
  if (!existsSync(path)) return { config: null, error: null };

  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    return { config: null, error: `${CONFIG_FILE} を読めない: ${e instanceof Error ? e.message : String(e)}` };
  }

  const raw = parsed;
  if (raw.version !== 1) return { config: null, error: `${CONFIG_FILE} の version が 1 ではない` };
  if (typeof raw.ports !== "object" || raw.ports === null) {
    return { config: null, error: `${CONFIG_FILE} に ports が無い` };
  }

  // **知らないポートを捨てない。** 新しい版が足したものを、古い版が読んで書き戻すと
  // 消える。既定で補うのは欠けているものだけにする。
  const base = defaults();
  const ports = { ...base.ports, ...raw.ports };
  const screen = raw.app?.screen ?? UNKNOWN;
  const language = raw.language === "en" || raw.language === "ja" ? raw.language : base.language;

  const app = readAppCredentials(raw.app?.credentials);
  if (app.error !== null) return { config: null, error: app.error };

  const out = readAppDestinations(raw.app?.destinations);
  if (out.error !== null) return { config: null, error: out.error };

  const box = readSandboxFeatures(raw.app?.sandbox?.features);
  if (box.error !== null) return { config: null, error: box.error };

  return {
    config: {
      version: 1,
      language,
      ports,
      app: {
        screen,
        credentials: app.credentials,
        destinations: out.destinations,
        sandbox: { features: box.features },
      },
    },
    error: null,
  };
}

export function writeConfig(root , config) {
  writeFileSync(configPath(root), `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

/**
 * 既にあるプロジェクトを見て、構成を推測する。
 *
 * **推測であって、確定ではない。** 呼び出し側は必ず人に確かめる。見て分かるのは
 * 「何が置かれているか」までで、**何を使うつもりかは分からない。**
 *
 * 推測できないものは既定のままにする。**空欄にしない。** 空欄は「使わない」と
 * 見分けがつかない。
 */


export function infer(root , gitRemote) {
  const config = defaults();
  const because = {};
  const here = (...p) => existsSync(join(root, ...p));

  if (gitRemote !== null && gitRemote.includes("github.com")) {
    because.repo = "git の遠隔が github.com を指している";
  }

  if (here(".github", "workflows")) {
    because.runner = ".github/workflows/ がある";
  }
/** @typedef {{ config: Config, because: Partial<Record<PortName, string>> }} Inference */
  if (here(".devcontainer")) {
    because.sandbox = ".devcontainer/ がある";
  } else {
    config.ports.sandbox = NONE;
    because.sandbox = ".devcontainer/ が無い";
  }

  // **雛形を見て決めない。** 置かれるのはこの後であり、いま見えているのは
  // プロジェクトが自分で置いたものだけ。
  for (const name of ["wrangler.jsonc", "wrangler.toml", "wrangler.json"]) {
    if (here(name)) {
      config.ports.preview = "cloudflare-workers";
      because.preview = `${name} がある`;
      break;
    }
  }

  return { config, because };
}
