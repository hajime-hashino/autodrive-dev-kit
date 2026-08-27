/**
 * 対象プロジェクトに、道具が動くための土台を置く。
 *
 * **人が打つのはこれだけである。** 着手も記録も判定もAIが行う。人に手順を打たせる
 * 形にすると、人の関与を減らすという目的と噛み合わない。
 *
 * 置くものは3つに分かれる（BOOTSTRAP 段階5）。
 *
 *   管理下  CI定義、AI向けの規約、.env の雛形     → 上書きする
 *   播種    境界表の初期状態、What/Why の雛形      → **既にあれば触らない**
 *   固有    テスト、ADR、境界変更履歴              → 生成しない
 *
 * **何度実行しても壊れないこと。** 途中で失敗したときに、やり直せる必要がある。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

export type Placement = "managed" | "seeded" | "skipped" | "merged";

export interface Placed {
  path: string;
  placement: Placement;
}

/** 管理下。上書きする。**ローカルの編集は参照実装への起票の契機である。** */
function managed(root: string, path: string, body: string, out: Placed[]): void {
  write(join(root, path), body);
  out.push({ path, placement: "managed" });
}

/** 播種。**既にあれば触らない。** 中身はプロジェクトのものになる。 */
function seeded(root: string, path: string, body: string, out: Placed[]): void {
  const full = join(root, path);
  if (existsSync(full)) {
    out.push({ path, placement: "skipped" });
    return;
  }
  write(full, body);
  out.push({ path, placement: "seeded" });
}

function write(full: string, body: string): void {
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, body, "utf8");
}

/**
 * 記録の仕掛けを登録する。
 *
 * **既にある登録を壊さない。** 設定は利用側のものであり、こちらの都合で
 * 上書きしてよいものではない。同じ登録が既にあれば何もしない。
 */
export function mergeHook(existing: string | null, command: string): { json: string; changed: boolean } {
  let settings: { hooks?: Record<string, unknown[]> } = {};
  if (existing !== null && existing.trim() !== "") {
    try {
      settings = JSON.parse(existing) as typeof settings;
    } catch {
      // **読めない設定を捨てない。** 呼び出し側が判断できるよう、変更なしで返す。
      return { json: existing, changed: false };
    }
  }

  const hooks = (settings.hooks ?? {}) as Record<string, unknown[]>;
  const stop = Array.isArray(hooks.Stop) ? hooks.Stop : [];
  if (JSON.stringify(stop).includes(command)) return { json: existing ?? "", changed: false };

  hooks.Stop = [...stop, { hooks: [{ type: "command", command }] }];
  settings.hooks = hooks;
  return { json: `${JSON.stringify(settings, null, 2)}\n`, changed: true };
}

export interface InitResult {
  placed: Placed[];
  todo: string[];
  code: number;
  message: string | null;
}

export function init(root: string, kitRoot: string): InitResult {
  const placed: Placed[] = [];

  if (!existsSync(join(root, ".git"))) {
    return {
      placed,
      todo: [],
      code: 1,
      message:
        "ここは git のリポジトリではない。\n" +
        "先に `git init` してから、もう一度実行すること。記録も判定も履歴の上で成り立っている。",
    };
  }

  // 管理下 ------------------------------------------------------------------
  managed(root, ".env.example", ENV_EXAMPLE, placed);
  managed(root, ".github/workflows/verify.yml", workflow(), placed);
  managed(root, "docs/autodrive.md", AGENT_RULES, placed);

  // 記録の仕掛け。**利用側の設定へ併合する。**
  const settingsPath = join(root, ".claude", "settings.json");
  const before = existsSync(settingsPath) ? readFileSync(settingsPath, "utf8") : null;
  const command = join(relative(root, kitRoot) || ".", "hooks", "record-tokens");
  const { json, changed } = mergeHook(before, command);
  if (changed) {
    write(settingsPath, json);
    placed.push({ path: ".claude/settings.json", placement: "merged" });
  } else {
    placed.push({ path: ".claude/settings.json", placement: "skipped" });
  }

  // 播種 --------------------------------------------------------------------
  seeded(root, "boundaries.yaml", BOUNDARIES, placed);
  seeded(root, "docs/what-why.md", WHAT_WHY, placed);
  seeded(root, ".gitignore", GITIGNORE, placed);

  // AI が読む入口。**既にあれば触らない。** 利用側の規約が入っていることがある。
  const claude = join(root, "CLAUDE.md");
  // **既にある規約を上書きしない。** ただし、繋がっていなければそう言う。
  const pointer =
    existsSync(claude) && !readFileSync(claude, "utf8").includes("docs/autodrive.md")
      ? "CLAUDE.md に次の1行を足すこと: 「作業の進め方は docs/autodrive.md に従う」"
      : null;
  seeded(root, "CLAUDE.md", CLAUDE_MD, placed);

  // 人にしかできないこと ------------------------------------------------------
  const todo = [
    ".env を作り、資格情報を書く（.env.example に必要なものが並んでいる）",
    "Repo の Actions シークレットに AUTODRIVE_CI_TOKEN を登録する（提出の読取を含めること）",
  ];
  if (pointer !== null) todo.push(pointer);
  todo.push("Claude Code を開き、作りたいものを話す。着手も記録もAIが行う");

  return { placed, todo, code: 0, message: null };
}

// ---------------------------------------------------------------- 置くもの

const ENV_EXAMPLE = `# 資格情報。**このファイルは雛形であり、値を書かない。**
# 写して .env を作り、そちらに書くこと（.env は追跡しない）。

# 作業単位の取得・起票・状態の更新。
LINEAR_API_KEY=

# 判定が Repo を読むために使う。**提出の読取（Pull requests: Read）を含めること。**
# 無いと「外側ループが起動したか」を判定できず、判定が失敗する。
AUTODRIVE_CI_TOKEN=

# コミットの身元。**ホストの git の設定は引き継がれない環境がある。**
GIT_USER_NAME=
GIT_USER_EMAIL=
`;

const workflow = (): string => `name: verify

# このリポジトリの範囲の判定のみを行う。リポジトリをまたいで初めて成立する
# 不変条件は、参照実装側の定期実行が見る。
on:
  pull_request:
  push:
    branches: [main]
  workflow_dispatch:

jobs:
  self:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
        with:
          # **既定ブランチの履歴が要る。** 提出を経ずに入った変更の検出は
          # first-parent を辿って判定するため、浅い取得では判定できない。
          fetch-depth: 0

      - uses: actions/setup-node@v5
        with:
          node-version: "22.18"

      - name: 判定する
        run: <参照実装の場所>/verify --root . --scope self
`;

const BOUNDARIES = `# 境界表
#
# 領域ごとに「気づけるか」「戻せるか」を記し、任せる範囲の状態を持つ。
#
#            | 気づけない        | 気づける
#   戻せない | 固定条件          | 自動ゲート＋人が発火
#   戻せる   | 抜き取り確認      | 完全委譲
#
# 状態は 保留 / 観察中 / 委譲済み の3つ。
#   緩和  : 観察中でN回連続して人の修正が入らなければ委譲済みへ
#   締め直し: 委譲済みで失敗が出たら観察中へ戻す
#   **緩和と締め直しは必ず対で運用する。**
#
# 変更の提案はAI、承認は人、**履歴は必ず残す**（docs/boundary-changes.md）。
#
# ---
#
# **初期状態を推測で埋めないこと。** 人が実際にどこを見ていたかが記録に残ってから、
# それを使って起こす。見ていた領域を保留、見ていなかった領域を委譲済みとする。
#
# 宣言と実態がズレていれば、それ自体が読むべき信号になる。

version: 1

areas: []
`;

const WHAT_WHY = `# 何を作るか、なぜ作るか

**提示は人の役割である。この文書をAIが独断で書き換えないこと。** 変更は人の提示を受けてのみ行う。

確定度のラベルの意味は次のとおり。

| ラベル | 意味 | AIの扱い |
|---|---|---|
| 確定 | 決まっている | 前提として進める |
| 暫定 | 仮に置いている | 矛盾を見つけたら停止点として上げる |
| 要検証 | まだ確かめていない | 着手前に確かめる |

**暫定と要検証を区別して書くことに意味がある。** 人が固めた要件はAIから見て決定済みに見えるため、ラベルが無いと矛盾があっても指摘せず従ってしまう。

---

## 何を作るか

（ここに書く）

## できること

| | 内容 | 確定度 |
|---|---|---|
| | | |
`;

const GITIGNORE = `# 資格情報。追跡しない。
.env
.env.*
!.env.example

# 作業状態。成果物ではない。
.autodrive/
`;

const CLAUDE_MD = `# 作業ルール

作業の進め方は [docs/autodrive.md](docs/autodrive.md) に従う。

（プロジェクト固有の決まりがあれば、ここに足す）
`;

const AGENT_RULES = `# 作業の進め方

**この文書は参照実装が置いたものである。** 直したくなったら、参照実装側へ起票すること。
ここを直しても、次に配られたときに上書きされる。

## 着手する

\`\`\`sh
autodrive-dev-kit begin <作業単位ID> --repo <対象リポジトリ>
\`\`\`

**必ずこの入口を通る。** 作業単位の確認・既定ブランチを最新にして枝を切る・記録の
紐づけ先の設置を、まとめて行う。手で順に踏むと、どれかを飛ばしたことに気づけない。

前提が崩れていれば進めずに止まる。止まったら、出ている案内に従うこと。

## 記録する

\`\`\`sh
autodrive-dev-kit telemetry 停止を記録する   --kind <種別> --detail <内容>
autodrive-dev-kit telemetry 修正を記録する   --target <対象> --detail <内容> --cause <原因>
\`\`\`

原因は「要件のズレ」「設計のズレ」「実装バグ」のいずれか。後工程で見つかった誤りは
\`--found-in\` を付ける（検出漏れとして記録される）。

**トークン消費は自動で付く。** 何もしなくてよい。

## 画面のあるものを作るとき

**実装に入る前に、見え方を人に決めてもらう。** 見え方は What の一部であり、AIが
決めるものではない。承認を求めるのではなく、選択肢を出すこと。

要らない場合もある。既にある形に沿って項目が増えるだけのとき、画面が無いとき。

## 守ること

- **提出を経ずに既定ブランチへ入れない。** 判定が検出する
- **本番の資格情報を手元に置かない。** 配布用のトークンは CI だけが持つ
- **判定器を、判定が緩む方向に書き換えない**
`;
