# autodrive-dev-kit

AIオートドライビング開発の参照実装。手法の定義は [autodrive-dev-definition](https://github.com/hajimegane/autodrive-dev-definition) にある。

段階0の時点では、不変条件の発効判定器 `verify` のみを持つ。他の要素は段階5で、題材アプリで育ったもののうち一般化できるものを抽出して置く。

設計判断の記録は [docs/adr/](docs/adr/) にある。**計画の冒頭で索引を引くこと。**

## `verify`

定義§9の4つの不変条件それぞれについて、発効しているか、未発効なら何が手で代替しているかを判定する。

判定基準の全文は [docs/verify-criteria.md](docs/verify-criteria.md) を参照。

### 実行

```sh
# ワークディレクトリ全体を横断して判定する（既定）
./verify --root /path/to/autodrive-dev-work

# 1リポジトリの中だけで閉じる判定に限る（各リポジトリの CI 用）
./verify --root . --scope self

# 機械可読な出力
./verify --root . --format json
```

不変条件「AIがこれらを無効化できないこと」の判定に Repo API を読むため、環境変数 `AUTODRIVE_CI_TOKEN` が要る。無い場合は判定不能として失敗する（定義§9「発効の判定ができない状態は、それ自体を失敗として扱う」）。

```sh
set -a; . /path/to/autodrive-dev-work/.env; set +a
./verify --root /path/to/autodrive-dev-work
```

### 終了コード

| 値 | 意味 |
|---|---|
| 0 | 失敗なし。未発効の不変条件があっても、代替が記録されていれば 0 |
| 1 | 代替の記録が無い不変条件がある、または判定できない不変条件がある |
| 2 | 引数が不正、または判定対象のリポジトリが見つからない |

**未発効であること自体は失敗ではない。** 失敗なのは、代替の記録が無いことと、判定ができないことである。

### エージェントの外から実行できること

`verify` は実行可能なファイルであり、スラッシュコマンドとしてのみ存在する形は取らない。エージェントに接続されないまま運用が続く事故を防げないためである。CI からの実行は [.github/workflows/verify.yml](.github/workflows/verify.yml) を参照。

## ポート語彙

定義§16の語彙を、そのまま入口の名前にしている。**呼び出し側は実装名を知らない。**
差し替えるときは `src/adapters/` の中だけを置き換える。

```sh
./bin/tracker 作業単位を取得する [<ID>]
./bin/tracker 作業単位を起票する --title <題> --body <本文>
./bin/tracker 状態を進める <ID> --to started --repo <対象リポジトリ>
./bin/tracker 経過を追記する <ID> --text <内容>

./bin/telemetry 停止を記録する     --kind <種別> --detail <内容>
./bin/telemetry 修正を記録する     --target <対象> --detail <内容> [--cause <原因>] [--found-in <工程>]
./bin/telemetry 境界変更を記録する --area <領域> --from <状態> --to <状態> --detail <内容>
```

入口が `bin/` にあるのは、`telemetry/` が記録の置き場所として定義で決まっており、
同名のファイルをルートに置けないため。`verify` はルートのままにしている。

**必須属性（作業単位ID・モデル・参照実装の版・書き込み経路）は渡さない。**
アダプタが自動で付ける（定義§16の補足）。渡せる形にすると、渡し忘れた記録と
渡された記録が混ざり、遡って直せなくなる。

### 着手が紐づけの起点になる

`状態を進める --to started` は作業単位マーカーを書く。以降の記録はその作業単位に
紐づく。**着手していない状態で記録が発生したら、`work_item_id` が `null` になり
`verify` が落ちる。** 起票せずに作業した事実を、記録から消さずに検出する。

`--to done` / `--to canceled` はマーカーを外す。別の作業単位の記録が紛れ込まない
ようにするため。

## トークン消費の記録

実行基盤のフックから呼ばれ、セッション記録から使用量を読んで
`<対象リポジトリ>/telemetry/<作業単位ID>.jsonl` へ追記する。

```sh
./hooks/record-tokens   # フックの入力を標準入力から受け取る
```

フックの登録は、この参照実装ではなく利用側のリポジトリの `.claude/settings.json`
に置く。`verify` が読める場所に置くことで、外されたときに検出できる。

設計と、他の経路を採らなかった理由は
[ADR 0002](docs/adr/0002-token-usage-capture.md) にある。

### 作業単位マーカー

使用量を作業単位へ紐づけるため、利用側のリポジトリ直下に次を置く。追跡対象外。

```
.autodrive/current-work-item.json   {"work_item_id": "AUT-10", "repo": "autodrive-dev-kit"}
.autodrive/cursors/<セッションID>.json
```

マーカーが無い状態で使用量が発生した場合、`work_item_id` に `null` を書いて
`telemetry/unattributed.jsonl` へ残す。**握りつぶさない。** 起票せずに始めた作業を
記録から消すと、違反も消えるため。`verify` がこれを検出する。

## 開発

TypeScript を Node で直接実行する。ビルド手順は無い。

```sh
npm test    # node:test。テストフレームワークの依存は無い
```

**`dependencies` を置かないこと。** 依存ゼロであることが、この参照実装のサプライチェーン上の防御である。追加したくなった場合は [ADR 0001](docs/adr/0001-implementation-language.md) を読み、必要なら更新の提案から始める。

| | |
|---|---|
| 必要なもの | Node 22.18 以上（型注釈の直接実行） |
| 依存 | 無し |
| 入口 | `verify`（起動用の殻）→ `src/main.ts` |
