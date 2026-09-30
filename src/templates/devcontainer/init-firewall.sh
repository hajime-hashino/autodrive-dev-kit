#!/usr/bin/env bash
# Make outbound traffic allowlisted.
#
# **Isolation alone cannot prevent information from being taken out.** What is put in the
# sandbox can be read from inside, and sent if the egress is open. Only what is outside the
# project is protected. To protect what is inside, the egress must be narrowed.
#
# Deny by default, and let through only destinations written in allowed-domains.txt.
#
# **Rules are placed against the IPs resolved at that time.** Major CDNs swap IPs, so rules
# left in place stop reaching them. Measured, 2 of 19 destinations drifted within hours
# (CI log bodies, and where the official docs live). **It silently becomes unreachable** (AUT-63).
#
# So after placing them, they are re-resolved periodically.
#
#   init-firewall.sh            rebuild everything, and start re-resolving in the background
#   init-firewall.sh --refresh  **only add missing IPs.** once
#
# **Re-resolving does not replace everything.** At the moment of `-F`, the rule allowing the
# return of established connections also disappears, cutting traffic in flight. Only adding does not cut it.
#
# **Only names on the list are re-resolved.** Re-resolving destinations that could not be reached
# would become a path to add names not on the list. That is not allowed.
#
# **Rules accumulate.** Old IPs are not removed, so they grow as it keeps running (measured:
# 55→85 in one day). Everything added is a rotating IP of a name on the list, so **the names
# that can be reached do not grow.** But IPs a CDN no longer uses stay allowed.
#
# The accumulation disappears when the container stops. Rules are rebuilt on every start, so
# **the upper bound is set by how long the container keeps running.**
set -euo pipefail

ALLOWED="$(dirname "$0")/allowed-domains.txt"
[ -f "$ALLOWED" ] || { echo "There is no list of allowed destinations: $ALLOWED" >&2; exit 1; }

# Re-resolve interval (seconds). 0 disables the background loop.
REFRESH_INTERVAL="${AUTODRIVE_FIREWALL_REFRESH:-600}"

# For names on the list, add the currently resolvable IPs that are not yet allowed.
refresh() {
  added=0
  while read -r line; do
    domain="${line%%#*}"
    domain="$(echo "$domain" | tr -d "[:space:]")"
    [ -z "$domain" ] && continue
    for ip in $(getent ahostsv4 "$domain" 2>/dev/null | awk "{print \$1}" | sort -u || true); do
      # Do not add if already present. Stacking duplicates grows the rules without limit.
      iptables -C OUTPUT -d "$ip" -j ACCEPT 2>/dev/null && continue
      iptables -A OUTPUT -d "$ip" -j ACCEPT && added=$((added + 1))
    done
  done < "$ALLOWED"
  echo "$added"
}

if [ "${1:-}" = "--refresh" ]; then
  # **If it is not closed, do nothing.** Adding while open means nothing, and would leave only
  # output that reads as "re-resolved, so protected."
  if ! iptables -S OUTPUT | head -1 | grep -q "DROP"; then
    echo "The egress is not closed. Run init-firewall.sh first" >&2
    exit 1
  fi
  n="$(refresh)"
  [ "$n" -gt 0 ] && echo "Re-resolved: added ${n} destinations"
  exit 0
fi

echo "Making outbound traffic allowlisted"

# Discard existing rules before building. Stacking duplicates leaves unintended allowances.
iptables -F OUTPUT
iptables -F INPUT 2>/dev/null || true

# Allow loopback, and the return of connections opened from here.
iptables -A OUTPUT -o lo -j ACCEPT
iptables -A INPUT -i lo -j ACCEPT
iptables -A OUTPUT -m state --state ESTABLISHED,RELATED -j ACCEPT
iptables -A INPUT -m state --state ESTABLISHED,RELATED -j ACCEPT

# Name resolution. Closing this makes destinations unresolvable.
iptables -A OUTPUT -p udp --dport 53 -j ACCEPT
iptables -A OUTPUT -p tcp --dport 53 -j ACCEPT

# Allow the host side (connections from the editing machine). Closing it disconnects VS Code.
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

  # Skip destinations whose names do not resolve. Stopping here would keep the environment from starting on a transient outage.
  ips="$(getent ahostsv4 "$domain" 2>/dev/null | awk '{print $1}' | sort -u || true)"
  if [ -z "$ips" ]; then
    echo "  does not resolve: $domain"
    skipped=$((skipped + 1))
    continue
  fi
  for ip in $ips; do
    iptables -A OUTPUT -d "$ip" -j ACCEPT
    allowed=$((allowed + 1))
  done
done < "$ALLOWED"

# Set the default to deny last. **Closing partway through building would break name resolution.**
iptables -P OUTPUT DROP
iptables -P INPUT DROP 2>/dev/null || true

echo "  allowed destinations: ${allowed} (did not resolve: ${skipped})"

# Start re-resolving in the background. **Do not run two.**
#
# **Identify what to stop by PID.** Finding and killing by name (`pkill -f`) also takes down
# unrelated processes that merely contain the string. It actually killed the very shell doing
# the checking (AUT-63). **A mechanism that narrows must not mistake what it narrows.**
PIDFILE=/run/autodrive-firewall-refresh.pid
if [ "$REFRESH_INTERVAL" -gt 0 ]; then
  if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
    kill "$(cat "$PIDFILE")" 2>/dev/null || true
  fi
  SELF="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
  setsid bash -c 'while sleep '"$REFRESH_INTERVAL"'; do bash "'"$SELF"'" --refresh >/dev/null 2>&1 || true; done' \
    </dev/null >/dev/null 2>&1 &
  echo $! > "$PIDFILE"
  echo "  re-resolving: every ${REFRESH_INTERVAL} seconds"
fi

# Confirm it is in effect. **Do not say "narrowed" without confirming.**
if curl -fsS --max-time 5 -o /dev/null https://api.github.com 2>/dev/null; then
  echo "  check: allowed destinations are reachable"
else
  echo "  check failed: allowed destinations are unreachable. The rules are too strict" >&2
  exit 1
fi
if curl -fsS --max-time 5 -o /dev/null https://example.com 2>/dev/null; then
  echo "  check failed: a destination that is not allowed is reachable" >&2
  exit 1
fi
echo "  check: a destination that is not allowed is unreachable"
