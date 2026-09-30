#!/usr/bin/env bash
# Check whether the setup is sufficient.
#
# **Do not stop even if something is missing.** On first start having no .env yet is normal,
# and stopping here would make it impossible to get in and fix it. What is missing is shown.
#
# **What is needed is read from .env.example.** Keeping a list here would mean fixing two
# places when something new is needed, and one would be left behind.
set -uo pipefail

ROOT="${1:-$PWD}"
EXAMPLE="$ROOT/.env.example"
ENV_FILE="$ROOT/.env"

missing=()

if [ ! -f "$EXAMPLE" ]; then
  echo "⚠ There is no .env.example. Check whether autodrive-dev-kit init was run."
  exit 0
fi

if [ ! -f "$ENV_FILE" ]; then
  echo "⚠ There is no .env. Copy .env.example to create it, and write the credentials."
  exit 0
fi

# Take only the variable names (lines of the form NAME=).
while IFS= read -r name; do
  [ -n "$name" ] || continue
  value=$(grep -E "^${name}=" "$ENV_FILE" | head -1 | cut -d= -f2-)
  [ -n "$value" ] || missing+=("$name")
done < <(grep -oE '^[A-Z_][A-Z0-9_]*(?==)' "$EXAMPLE" 2>/dev/null || grep -oE '^[A-Z_][A-Z0-9_]*=' "$EXAMPLE" | tr -d '=')

if [ ${#missing[@]} -gt 0 ]; then
  echo "⚠ Some entries in .env have no value:"
  for name in "${missing[@]}"; do echo "    $name"; done
  echo "  .env.example says what each one is for."
else
  echo "✓ Credentials are in place"
fi

# Whether the egress is closed.
#
# **Do not leave "I think it is closed."** Rules disappear when the container stops, so even
# if they were placed they may not be in effect. It actually ran for 10 days without them (AUT-121).
#
# This does not fix it. **What fixes it is init-firewall.sh, which runs on every start.**
# This is the last net for noticing that it did not run.
#
# **So it is meaningless unless it runs after closing.** While it sat in postCreateCommand
# it ran before closing, and reported "not in effect" every time everywhere it was distributed
# (AUT-169). It is called from postStartCommand in devcontainer.json.
#
# **Being unable to get out is not by itself grounds that it is closed.** If networking itself
# is dead, or the rules are so strict that even allowed destinations are unreachable, you also
# cannot get out. **Only after looking in both directions can you say "it is closed."**
if [ -f "$ROOT/.devcontainer/allowed-domains.txt" ]; then
  if ! command -v curl >/dev/null 2>&1; then
    echo "⚠ Cannot check the egress restriction. curl is not installed."
    echo "    **What cannot be checked is not treated as in effect.**"
  elif curl -fsS --max-time 5 -o /dev/null https://example.com 2>/dev/null; then
    echo "⚠ The egress restriction is not in effect. Destinations that are not allowed are reachable."
    echo "    Run sudo bash .devcontainer/init-firewall.sh."
    echo "    **Running without it means working while believing you are isolated.**"
  elif curl -fsS --max-time 5 -o /dev/null https://api.github.com 2>/dev/null; then
    echo "✓ The egress restriction is in effect"
  else
    echo "⚠ Cannot check the egress restriction. Even allowed destinations are unreachable."
    echo "    Either the rules are too strict, or networking itself is down."
  fi
fi

exit 0
