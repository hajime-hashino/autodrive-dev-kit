#!/usr/bin/env bash
# 準備が足りているかを見る。
#
# **足りなくても止めない。** 初回は .env がまだ無いのが正常であり、ここで止めると、
# 中に入って直すことができなくなる。足りないものは表示で伝える。
#
# **何が要るかは .env.example から読む。** ここに一覧を持つと、要るものが増えた
# ときに2か所を直すことになり、片方が置き去りになる。
set -uo pipefail

ROOT="${1:-$PWD}"
EXAMPLE="$ROOT/.env.example"
ENV_FILE="$ROOT/.env"

missing=()

if [ ! -f "$EXAMPLE" ]; then
  echo "⚠ .env.example が無い。autodrive-dev-kit init を打ったか確認すること。"
  exit 0
fi

if [ ! -f "$ENV_FILE" ]; then
  echo "⚠ .env が無い。.env.example をコピーして作り、資格情報を書くこと。"
  exit 0
fi

# 変数名だけを取り出す（NAME= の形の行）。
while IFS= read -r name; do
  [ -n "$name" ] || continue
  value=$(grep -E "^${name}=" "$ENV_FILE" | head -1 | cut -d= -f2-)
  [ -n "$value" ] || missing+=("$name")
done < <(grep -oE '^[A-Z_][A-Z0-9_]*(?==)' "$EXAMPLE" 2>/dev/null || grep -oE '^[A-Z_][A-Z0-9_]*=' "$EXAMPLE" | tr -d '=')

if [ ${#missing[@]} -gt 0 ]; then
  echo "⚠ .env に値の入っていないものがある:"
  for name in "${missing[@]}"; do echo "    $name"; done
  echo "  .env.example に、それぞれ何に使うかが書いてある。"
else
  echo "✓ 資格情報は揃っている"
fi

# 出口が閉じているか。
#
# **「閉じているつもり」を残さない。** 規則はコンテナの停止で消えるため、置いた
# はずでも効いていないことがある。実際に10日間、効かないまま動いていた（AUT-121）。
#
# ここでは直さない。**直すのは init-firewall.sh であり、起動のたびに走る。**
# ここは、それが走らなかったことに気づくための最後の網である。
#
# **したがって、閉じたあとに走らなければ意味が無い。** postCreateCommand に
# 置いていた間は閉じる前に走っており、配った先すべてで毎回「効いていない」と
# 報告していた（AUT-169）。呼ぶ場所は devcontainer.json の postStartCommand。
#
# **出られないことだけでは、閉じていることの根拠にならない。** 通信そのものが
# 死んでいても、規則が厳しすぎて許可した宛先にも届かなくても、同じように
# 出られない。**両方向を見て、初めて「閉じている」と言える。**
if [ -f "$ROOT/.devcontainer/allowed-domains.txt" ]; then
  if ! command -v curl >/dev/null 2>&1; then
    echo "⚠ 出口制限を確かめられない。curl が入っていない。"
    echo "    **確かめられないことを、効いていることにしない。**"
  elif curl -fsS --max-time 5 -o /dev/null https://example.com 2>/dev/null; then
    echo "⚠ 出口制限が効いていない。許可していない宛先へ出られる。"
    echo "    sudo bash .devcontainer/init-firewall.sh を打つこと。"
    echo "    **効かないまま動くと、隔離されていると思ったまま作業することになる。**"
  elif curl -fsS --max-time 5 -o /dev/null https://api.github.com 2>/dev/null; then
    echo "✓ 出口制限が効いている"
  else
    echo "⚠ 出口制限を確かめられない。許可した宛先にも届かない。"
    echo "    規則が厳しすぎるか、通信そのものが落ちている。"
  fi
fi

exit 0
