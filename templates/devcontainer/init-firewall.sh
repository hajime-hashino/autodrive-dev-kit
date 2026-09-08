#!/usr/bin/env bash
# 外向き通信を許可制にする。
#
# **隔離だけでは情報の持ち出しを防げない。** サンドボックスに入れたものは、
# 中から読めるし、出口が開いていれば送れる。守れるのはプロジェクトの外にある
# ものだけである。中にあるものを守るには、出口を絞る必要がある。
#
# 既定を拒否にし、allowed-domains.txt に書かれた宛先だけを通す。
#
# **規則は名前解決した時点の IP に置かれる。** 大手の CDN は IP を入れ替えるため、
# 置いたままにすると出られなくなる。実測では19宛先のうち2つが数時間でズレた
# （CI のログ本文と、公式文書の置き場）。**静かに出られなくなる**（AUT-63）。
#
# そのため、置いたあとも定期的に引き直す。
#
#   init-firewall.sh            全部を組み立て直し、引き直しを背後で始める
#   init-firewall.sh --refresh  **足りない IP を足すだけ。** 一度きり
#
# **引き直しで丸ごと置き直さない。** `-F` の瞬間に、通っている接続の戻りを許す
# 規則も消えるため、実行中の通信が切れる。足すだけなら切れない。
#
# **引き直す対象は、一覧にある名前だけである。** 出られなかった宛先を引き直す形に
# すると、一覧に無い名前を足す経路になる。そこは通さない。
#
# **規則は溜まる。** 古い IP は消さないため、動かし続けると増える（実測で1日に
# 55→85）。増える分はすべて一覧にある名前の回っている IP であり、**出られる名前は
# 増えない。** ただし CDN が使わなくなった IP を許可したままにはなる。
#
# 溜まりはコンテナの停止で消える。起動のたびに組み立て直すため、**上限は
# コンテナを動かし続けた時間で決まる。**
set -euo pipefail

ALLOWED="$(dirname "$0")/allowed-domains.txt"
[ -f "$ALLOWED" ] || { echo "許可する宛先の一覧が無い: $ALLOWED" >&2; exit 1; }

# 引き直しの間隔（秒）。0 にすると背後で回さない。
REFRESH_INTERVAL="${AUTODRIVE_FIREWALL_REFRESH:-600}"

# 一覧にある名前の、いま引ける IP のうち、まだ許可されていないものを足す。
refresh() {
  added=0
  while read -r line; do
    domain="${line%%#*}"
    domain="$(echo "$domain" | tr -d "[:space:]")"
    [ -z "$domain" ] && continue
    for ip in $(getent ahostsv4 "$domain" 2>/dev/null | awk "{print \$1}" | sort -u || true); do
      # 既にあるなら足さない。二重に積むと規則が際限なく増える。
      iptables -C OUTPUT -d "$ip" -j ACCEPT 2>/dev/null && continue
      iptables -A OUTPUT -d "$ip" -j ACCEPT && added=$((added + 1))
    done
  done < "$ALLOWED"
  echo "$added"
}

if [ "${1:-}" = "--refresh" ]; then
  # **閉じていないなら何もしない。** 開いた状態で足しても意味が無く、
  # 「引き直したから守られている」と読める出力だけが残る。
  if ! iptables -S OUTPUT | head -1 | grep -q "DROP"; then
    echo "出口が閉じていない。先に init-firewall.sh を打つこと" >&2
    exit 1
  fi
  n="$(refresh)"
  [ "$n" -gt 0 ] && echo "引き直した: ${n} 件の宛先を足した"
  exit 0
fi

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

# 引き直しを背後で始める。**二重に回さない。**
#
# **止める相手は PID で特定する。** 名前で探して落とす形（`pkill -f`）は、
# その文字列を含むだけの無関係な処理まで巻き込む。実際に、確認していた
# シェル自身を落とした（AUT-63）。**絞る仕掛けが、絞る対象を間違えては困る。**
PIDFILE=/run/autodrive-firewall-refresh.pid
if [ "$REFRESH_INTERVAL" -gt 0 ]; then
  if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
    kill "$(cat "$PIDFILE")" 2>/dev/null || true
  fi
  SELF="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
  setsid bash -c 'while sleep '"$REFRESH_INTERVAL"'; do bash "'"$SELF"'" --refresh >/dev/null 2>&1 || true; done' \
    </dev/null >/dev/null 2>&1 &
  echo $! > "$PIDFILE"
  echo "  引き直し: ${REFRESH_INTERVAL} 秒ごと"
fi

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
