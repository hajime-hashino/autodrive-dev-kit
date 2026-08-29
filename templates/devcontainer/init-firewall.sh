#!/usr/bin/env bash
# 外向き通信を許可制にする。
#
# **隔離だけでは情報の持ち出しを防げない。** サンドボックスに入れたものは、
# 中から読めるし、出口が開いていれば送れる。守れるのはプロジェクトの外にある
# ものだけである。中にあるものを守るには、出口を絞る必要がある。
#
# 既定を拒否にし、allowed-domains.txt に書かれた宛先だけを通す。
# 名前解決した時点の IP を許可するため、宛先が変わる場合は入れ直しが要る。
set -euo pipefail

ALLOWED="$(dirname "$0")/allowed-domains.txt"
[ -f "$ALLOWED" ] || { echo "許可する宛先の一覧が無い: $ALLOWED" >&2; exit 1; }

echo "外向き通信を許可制にする"

# 既存の規則を捨ててから組み立てる。二重に積むと意図しない許可が残る。
iptables -F OUTPUT
iptables -F INPUT 2>/dev/null || true

# 折り返しと、こちらから開いた接続の戻りは通す。
iptables -A OUTPUT -o lo -j ACCEPT
iptables -A INPUT -i lo -j ACCEPT
iptables -A OUTPUT -m state --state ESTABLISHED,RELATED -j ACCEPT
iptables -A INPUT -m state --state ESTABLISHED,RELATED -j ACCEPT

# 名前解決。これを閉じると宛先を引けない。
iptables -A OUTPUT -p udp --dport 53 -j ACCEPT
iptables -A OUTPUT -p tcp --dport 53 -j ACCEPT

# ホスト側（編集機からの接続）は通す。閉じると VS Code がつながらない。
GATEWAY="$(ip route | awk '/^default/ {print $3; exit}')"
if [ -n "$GATEWAY" ]; then
  SUBNET="$(ip -o -f inet addr show | awk '/scope global/ {print $4; exit}')"
  [ -n "$SUBNET" ] && iptables -A OUTPUT -d "$SUBNET" -j ACCEPT
fi

allowed=0
skipped=0
while read -r line; do
  domain="${line%%#*}"
  domain="$(echo "$domain" | tr -d '[:space:]')"
  [ -z "$domain" ] && continue

  # 名前が引けない宛先は飛ばす。ここで止めると、一時的な不通で環境が起動しなくなる。
  ips="$(getent ahostsv4 "$domain" 2>/dev/null | awk '{print $1}' | sort -u || true)"
  if [ -z "$ips" ]; then
    echo "  引けない: $domain"
    skipped=$((skipped + 1))
    continue
  fi
  for ip in $ips; do
    iptables -A OUTPUT -d "$ip" -j ACCEPT
    allowed=$((allowed + 1))
  done
done < "$ALLOWED"

# 最後に既定を拒否にする。**組み立ての途中で閉じると、名前解決ができなくなる。**
iptables -P OUTPUT DROP
iptables -P INPUT DROP 2>/dev/null || true

echo "  許可した宛先: ${allowed} 件（引けなかったもの: ${skipped} 件）"

# 効いていることを確かめる。**確かめずに「絞った」と言わない。**
if curl -fsS --max-time 5 -o /dev/null https://api.github.com 2>/dev/null; then
  echo "  確認: 許可した宛先へ出られる"
else
  echo "  確認に失敗: 許可した宛先へ出られない。規則が厳しすぎる" >&2
  exit 1
fi
if curl -fsS --max-time 5 -o /dev/null https://example.com 2>/dev/null; then
  echo "  確認に失敗: 許可していない宛先へ出られてしまう" >&2
  exit 1
fi
echo "  確認: 許可していない宛先へは出られない"
