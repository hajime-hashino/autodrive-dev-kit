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
} as const satisfies Record<string, readonly string[]>;

export type PortName = keyof typeof PORT_CHOICES;
export const PORT_NAMES = Object.keys(PORT_CHOICES) as PortName[];

export interface Config {
  version: 1;
  ports: Record<PortName, string>;
  app: {
    /**
     * 画面があるか。**init では聞かない。**
     *
     * 何を作るかを聞く段で決まるものであり（AUT-80 の1）、土台を置く時点では
     * まだ誰も知らない。AIが聞き取ったときに書き足す。
     */
    screen: "yes" | "no" | typeof UNKNOWN;
  };
}

/** 既定。**推奨であって、決定ではない。** */
export function defaults(): Config {
  return {
    version: 1,
    ports: {
      tracker: "linear",
      repo: "github",
      runner: "github-actions",
      sandbox: "devcontainer",
      preview: NONE,
      telemetry: "jsonl",
      flag: NONE,
    },
    app: { screen: UNKNOWN },
  };
}

export function configPath(root: string): string {
  return join(root, CONFIG_FILE);
}

export function hasConfig(root: string): boolean {
  return existsSync(configPath(root));
}

/**
 * 読む。
 *
 * **壊れていれば、そう言って止まる。** 既定で埋めて進むと、決めた内容が黙って
 * 別のものに入れ替わる。
 */
export function readConfig(root: string): { config: Config | null; error: string | null } {
  const path = configPath(root);
  if (!existsSync(path)) return { config: null, error: null };

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    return { config: null, error: `${CONFIG_FILE} を読めない: ${e instanceof Error ? e.message : String(e)}` };
  }

  const raw = parsed as Partial<Config>;
  if (raw.version !== 1) return { config: null, error: `${CONFIG_FILE} の version が 1 ではない` };
  if (typeof raw.ports !== "object" || raw.ports === null) {
    return { config: null, error: `${CONFIG_FILE} に ports が無い` };
  }

  // **知らないポートを捨てない。** 新しい版が足したものを、古い版が読んで書き戻すと
  // 消える。既定で補うのは欠けているものだけにする。
  const base = defaults();
  const ports = { ...base.ports, ...raw.ports } as Record<PortName, string>;
  const screen = raw.app?.screen ?? UNKNOWN;

  return { config: { version: 1, ports, app: { screen } }, error: null };
}

export function writeConfig(root: string, config: Config): void {
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
export interface Inference {
  config: Config;
  /** どこを見てそう判断したか。**人が確かめられる形で残す。** */
  because: Partial<Record<PortName, string>>;
}

export function infer(root: string, gitRemote: string | null): Inference {
  const config = defaults();
  const because: Partial<Record<PortName, string>> = {};
  const here = (...p: string[]) => existsSync(join(root, ...p));

  if (gitRemote !== null && gitRemote.includes("github.com")) {
    because.repo = "git の遠隔が github.com を指している";
  }

  if (here(".github", "workflows")) {
    because.runner = ".github/workflows/ がある";
  }

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
