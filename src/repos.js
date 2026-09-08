/** 判定対象のリポジトリの探索と、git の読取。 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";


// **ファイル名は変えない。** 語彙は「委譲範囲の変更履歴」へ改めたが（定義 v0.14）、
// 名前を変えると既に配った先で履歴が見つからなくなる。「境界変更履歴.md」も、
// 既にそう置いた先があるため読み続ける。
const BOUNDARY_HISTORY_NAMES = ["boundary-changes.md", "境界変更履歴.md"];

/**
 * origin の URL から owner/repo を取り出す。取れなければ null。
 *
 * **git の呼び出しから切り離してある。** 呼ぶ側によって git の入手経路が違う
 * （`invariants` は自前、`begin` は差し込まれたもの）。読み方まで二重に持つと、片方だけ
 * 直る。
 */
export function slugFromUrl(raw) {
  let url = (raw ?? "").trim();
  if (url === "") return null;
  if (url.startsWith("git@")) url = url.split(":").slice(1).join(":");
  else if (url.includes("://")) url = url.split("://")[1].split("/").slice(1).join("/");
  return url.endsWith(".git") ? url.slice(0, -4) : url;
}

export class Repo {
           path;
           name;

  constructor(path) {
    this.path = resolve(path);
    this.name = basename(this.path);
  }

  /** git の出力。失敗したら null を返す（例外にしない）。 */
  git(...args) {
    try {
      return execFileSync("git", ["-C", this.path, ...args], {
        encoding: "utf8",
        timeout: 30_000,
        stdio: ["ignore", "pipe", "ignore"],
      });
    } catch {
      return null;
    }
  }

  /** origin の URL から owner/repo を取り出す。取れなければ null。 */
  remoteSlug() {
    return slugFromUrl(this.git("remote", "get-url", "origin"));
  }

  /** 追跡されているファイルの一覧。取れなければ空。 */
  trackedFiles() {
    const out = this.git("ls-files", "-z");
    return out === null ? [] : out.split("\0").filter((n) => n !== "");
  }

  telemetryFiles() {
    const dir = join(this.path, "telemetry");
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((n) => n.endsWith(".jsonl"))
      .sort()
      .map((n) => join(dir, n));
  }

  boundariesFile() {
    const p = join(this.path, "boundaries.yaml");
    return existsSync(p) ? p : null;
  }

  boundaryHistoryFile() {
    for (const name of BOUNDARY_HISTORY_NAMES) {
      for (const p of [join(this.path, name), join(this.path, "docs", name)]) {
        if (existsSync(p)) return p;
      }
    }
    return null;
  }

  read(path) {
    return readFileSync(path, "utf8");
  }
}

/**
 * 判定対象のリポジトリを集める。
 *
 * 横断判定のため、起点自身と直下のサブディレクトリの両方を見る。
 * 不変条件はリポジトリをまたいで成立するため、リポジトリ単位で判定すると抜ける。
 */
export function discoverRepos(root , scope) {
  const base = resolve(root);
  const found = [];
  if (existsSync(join(base, ".git"))) found.push(new Repo(base));
  if (scope !== "cross") return found;

  let children = [];
  try {
    children = readdirSync(base).sort();
  } catch {
    return found;
  }
  for (const child of children) {
    const p = join(base, child);
    try {
      if (statSync(p).isDirectory() && existsSync(join(p, ".git"))) found.push(new Repo(p));
    } catch {
      // 読めないものは対象にしない
    }
  }
  return found;
}
