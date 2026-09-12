#!/usr/bin/env bash
# 環境を作った後の準備。確認は check-setup.sh が行う。
set -uo pipefail

ENV_FILE="$PWD/.env"

# --- 準備 -------------------------------------------------------------------

# 設定の置き場所を、この環境の利用者が書けるようにする。
#
# **名前付き volume は root 所有で作られる。** 割り当て先が基のイメージに
# 存在しない場合、Docker は空の volume を root 所有で用意する。エージェントは
# root では動かさないため、そのままでは設定も認証も保存できない。
CONFIG_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
if [ -d "$CONFIG_DIR" ] && [ ! -w "$CONFIG_DIR" ]; then
  sudo chown -R "$(id -u):$(id -g)" "$CONFIG_DIR"
  echo "設定の置き場所の所有者を直した: $CONFIG_DIR"
fi

# 資格情報を、この環境の全ての shell から見えるようにする。
# 毎回手で読み込ませる形は手順を増やすだけで、忘れれば gh も git も動かない。
if [ -f "$ENV_FILE" ]; then
  LOADER="set -a; . '$ENV_FILE'; set +a"
  for rc in "$HOME/.bashrc" "$HOME/.zshrc"; do
    [ -f "$rc" ] || continue
    grep -qF "$ENV_FILE" "$rc" || {
      printf '\n# このプロジェクトの資格情報\n[ -f %s ] && { %s; }\n' "$ENV_FILE" "$LOADER" >> "$rc"
    }
  done
  # この先の準備でも使う。
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi

# Repo への push が資格情報を尋ねずに通るようにする。
git config --global credential."https://github.com".helper \
  '!f() { echo username=x-access-token; echo "password=${GH_TOKEN}"; }; f'

# コミットの作者情報。**ホストの設定は引き継がれない**ため、環境を作り直すたびに要る。
# 無いと commit そのものが通らない。値は人が決めるものなので .env から取る。
[ -n "${GIT_USER_NAME:-}" ]  && git config --global user.name  "$GIT_USER_NAME"
[ -n "${GIT_USER_EMAIL:-}" ] && git config --global user.email "$GIT_USER_EMAIL"

# --- 確認 -------------------------------------------------------------------

# **確認はここでは走らせない。** `postStartCommand` が、出口を閉じたあとに走らせる。
#
# ここに置いていた間、確認は毎回「出口制限が効いていない」と誤って報告していた。
# **devcontainer は postCreate → postStart の順に走るため、この時点では
# init-firewall.sh がまだ走っておらず、出口は必ず開いている**（AUT-169）。
#
# 環境を作った直後にも、続けて postStart が走る。**確認の機会は失われない。**
# むしろ起動のたびに走るようになり、規則が消えた状態を毎回見られる。
