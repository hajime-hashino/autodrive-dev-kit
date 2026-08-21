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
