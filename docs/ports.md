# ポート語彙

定義§16の語彙を、そのまま入口の名前にしている。**呼び出し側は実装名を知らない。**

Tracker を Linear から GitHub Issues へ差し替えるとき、置き換えるのは `src/adapters/` の中だけである。手順もスキルも書き換えずに済む。

## 作業単位（Tracker）

```sh
./bin/tracker 作業単位を取得する [<ID>]
./bin/tracker 作業単位を起票する --title <題> --body <本文>
./bin/tracker 状態を進める <ID> --to started --repo <対象リポジトリ>
./bin/tracker 経過を追記する <ID> --text <内容>
```

状態は `backlog` / `todo` / `started` / `done` / `canceled`。

`started` へ進めるときは `--repo` が要る。**記録の書き込み先になる**ため、決まらないと着手が成立しない。

資格情報は環境変数 `LINEAR_API_KEY` から読む。対象が複数ある場合は `AUTODRIVE_TRACKER_TEAM` で指定する。

## 記録（Telemetry）

```sh
./bin/telemetry 停止を記録する   --kind <種別> --detail <内容> [--resolved]
./bin/telemetry 修正を記録する   --target <対象> --detail <内容> [--cause <原因>] [--found-in <工程>]
./bin/telemetry 抜き取り確認を記録する --area <領域> --looked <見た範囲> --not-looked <見なかった範囲> \
                                 --detail <内容> [--fixed]
./bin/telemetry 境界変更を記録する --area <領域> --from <状態> --to <状態> --detail <内容> [--basis <根拠>]
```

原因は「要件のズレ」「設計のズレ」「実装バグ」のいずれか（定義§6）。

`--found-in` を付けた修正は**検出漏れ**として記録される（定義§16）。

**抜き取り確認は、修正が入らなかった場合も必ず記録する**（定義§8）。緩和の判定が「N回連続で修正が入らないこと」で成立するため、修正が無かった回が残らないと判定できない。

作業単位ID・モデル・参照実装の版・書き込み経路は**自動で付く**。渡さない。

## 語彙に無い操作が要るとき

**足す前に、定義へ差し戻す。** ポート語彙は定義§16が定めており、参照実装が勝手に増やすと、実装ごとに語彙が違う状態になる。

定義§16はこうも書いている。

> 段階1以降に `manual` が消えない記録が出た場合、それは**ポート語彙に欠けた操作があるという信号**である
