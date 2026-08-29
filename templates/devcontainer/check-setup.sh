#!/usr/bin/env bash
# 支度が足りているかを見る。
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
  echo "⚠ .env が無い。.env.example を写して作り、資格情報を書くこと。"
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

exit 0
