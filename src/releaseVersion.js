/**
 * バージョンが、提出のたびに動いていること。
 *
 * ## なぜ要るか
 *
 * `VERSION` は置かれた日から一度も動いていなかった。164コミットの間ずっと 0.1.0 で、
 * 記録 270 件すべてが同じ値だった（AUT-155）。定義§6が `kit_version` を必須属性と
 * しているのは**記録を後から比べるため**であり、全部が同じ値なら比べようがない。
 * ADR 0004 が直そうとした問題が、形を変えて残っていた。
 *
 * **上げ忘れたことに気づく機会が無かった。** 規約に書いても、通らなければ思い出せ
 * ない。`begin` を入口にしたのと同じ理由で、ここは判定に置く。
 *
 * ## 何を見るか
 *
 * **配られる中身が変わったなら、`VERSION` も動いていること。** 配られないもの
 * （テスト、文書、記録、変異の一覧）だけの変更では求めない。上げても、受け取る側で
 * 何も変わらないためである。
 *
 * ## 一覧を二重に持たない
 *
 * 配られるものは `init.js` が持っている。ここへ写すと、置くものを変えたときに
 * 片方だけが古くなる。**実際に、索引を手で保っていて古くなった**（AUT-160）。
 * したがって `VENDORED` から導く。
 */

import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { VENDORED } from "./init.js";

/**
 * 配られるもの。
 *
 * **`VERSION` 自身は外す。** それが動いたかどうかを見る側であり、引き金にすると
 * 「上げたから上げなければならない」になる。
 *
 * **`templates` を足す。** 複製されはしないが、`init` と `update` がここから
 * プロジェクトのファイルを作る。中身が変われば、受け取る側のものが変わる。
 */
export const DISTRIBUTED = [...VENDORED.filter((name) => name !== "VERSION"), "templates"];

/** そのパスが、配られるものの中にあるか。 */
export function isDistributed(path) {
  return DISTRIBUTED.some((top) => path === top || path.startsWith(`${top}/`));
}

/** 変わったもののうち、配られるもの。 */
export function distributedChanges(paths) {
  return paths.filter(isDistributed);
}

/**
 * `1.2.3` を数の並びにする。読めなければ null。
 *
 * **読めないことを 0 として扱わない。** タグは `v<VERSION>` で打たれるため、
 * 形が崩れていると打てない名前になる。読めなかったことは、そう言う。
 */
export function parseVersion(text) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec((text ?? "").trim());
  return m === null ? null : [Number(m[1]), Number(m[2]), Number(m[3])];
}

/**
 * `head` が `base` より後か。
 *
 * **下がっていないことまで見る。** 「動いた」だけを見ると、取り違えて戻した場合に
 * 通る。既に打ってあるタグと同じ名前が後から出てくることになる。
 */
export function isNewer(base, head) {
  const [a, b] = [parseVersion(base), parseVersion(head)];
  if (a === null || b === null) return false;
  for (let i = 0; i < 3; i++) {
    if (b[i] > a[i]) return true;
    if (b[i] < a[i]) return false;
  }
  return false;
}

/** 一覧を、読める長さに畳んで並べる。 */
function listed(paths, limit = 10) {
  const head = paths.slice(0, limit).map((p) => `  ${p}`);
  return paths.length > limit ? [...head, `  … 他 ${paths.length - limit} 件`] : head;
}

/**
 * 上げ忘れていないかを判定する。
 *
 * **止まるときは、なぜ・何をすればよいか・詰まったときの受け皿まで出す**（配布物
 * 「停止するときの作法」）。「失敗しました」で終わらせない。
 *
 * @param {{ changed: string[] | null, base: string | null, head: string | null }} facts
 * @returns {{ ok: boolean, message: string }}
 */
export function checkBump(facts) {
  const { changed, base, head } = facts;

  // **調べられなかったことを、通過として扱わない**（定義§9）。「調べたが無かった」と
  // 「調べられなかった」を同じ値で表すと、判定できない状態が通過に紛れる。
  if (changed === null) {
    return {
      ok: false,
      message: [
        "変わったファイルを読めない。",
        "既定ブランチの履歴が要る。浅いチェックアウトでは比べられない（fetch-depth: 0）。",
      ].join("\n"),
    };
  }
  if (head === null) {
    return { ok: false, message: "VERSION を読めない。ファイルが消えていないかを確かめること。" };
  }
  if (parseVersion(head) === null) {
    return {
      ok: false,
      message: [
        `VERSION が読めない形をしている: ${head}`,
        "`1.2.3` の形で書くこと。タグは `v<VERSION>` で打たれるため、崩れていると名前にならない。",
      ].join("\n"),
    };
  }

  const touched = distributedChanges(changed);
  if (touched.length === 0) {
    return { ok: true, message: `配られる中身は変わっていない。バージョンは ${head} のまま。` };
  }

  // 比べる相手が無いのは、既定ブランチにまだ VERSION が無い場合。**新しく置いた
  // ときであり、上げ忘れではない。**
  if (base === null) return { ok: true, message: `バージョンを ${head} で置いた。` };

  if (base === head) {
    return {
      ok: false,
      message: [
        `配られる中身が変わっているのに、VERSION が ${head} のまま動いていない。`,
        "",
        "**記録の `kit_version` が同じ値のままになり、後から比べられない。** 定義§6が",
        "この属性を必須にしているのは記録を比べるためである。統合されてもタグが打たれない。",
        "",
        "次を行うこと。",
        "  1. VERSION の末尾の数字を1つ上げる",
        "  2. package.json の version を同じ値にする",
        "",
        "配られない場所だけを触ったつもりなら、下の一覧を見ること。",
        ...listed(touched),
      ].join("\n"),
    };
  }

  if (!isNewer(base, head)) {
    return {
      ok: false,
      message: [
        `VERSION が下がっている（${base} → ${head}）。`,
        "既に打たれたタグと同じ名前が、後から出てくることになる。",
        `${base} より後の値にすること。`,
      ].join("\n"),
    };
  }

  return { ok: true, message: `バージョンを上げている（${base} → ${head}）。` };
}

// ---------------------------------------------------------------- git から読む

/**
 * 既定の git。**読めなかったことを例外にせず null で返す。**
 *
 * 判定する側が「無かった」と「読めなかった」を区別できる必要がある。
 */
export const runGit = (args) => {
  try {
    return execFileSync("git", args, {
      encoding: "utf8",
      timeout: 60_000,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    return null;
  }
};

/** 2点の間で変わったファイル。読めなければ null。 */
export function changedBetween(base, head, git = runGit) {
  const out = git(["diff", "--name-only", `${base}...${head}`]);
  return out === null ? null : out.split("\n").map((s) => s.trim()).filter((s) => s !== "");
}

/** その地点の VERSION。無ければ null。 */
export function versionAt(ref, git = runGit) {
  const out = git(["show", `${ref}:VERSION`]);
  return out === null ? null : out.trim();
}

/** git から facts を集めて判定する。 */
export function inspect(base, head, git = runGit) {
  return checkBump({
    changed: changedBetween(base, head, git),
    base: versionAt(base, git),
    head: versionAt(head, git),
  });
}

const USAGE = `バージョンを上げ忘れていないかを見る

  node src/releaseVersion.js --base <地点> --head <地点>

配られる中身が変わっているのに VERSION が動いていなければ、落とす。
提出のたびに CI から打たれる。**人が打つものではない。**`;

const invokedDirectly = process.argv[1] !== undefined && import.meta.filename === resolve(process.argv[1]);
if (invokedDirectly) {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: { base: { type: "string" }, head: { type: "string" } },
    strict: true,
  });
  if (values.base === undefined || values.head === undefined) {
    console.error(USAGE);
    process.exit(2);
  }
  const { ok, message } = inspect(values.base, values.head);
  (ok ? console.log : console.error)(message);
  process.exit(ok ? 0 : 1);
}

// 判定の検証用。配られる中身を変えて VERSION を上げていない。
