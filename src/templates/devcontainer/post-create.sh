#!/usr/bin/env bash
# Setup after the environment is created. The check is done by check-setup.sh.
set -uo pipefail

ENV_FILE="$PWD/.env"

# --- setup -------------------------------------------------------------------

# Make the settings location writable by this environment's user.
#
# **Named volumes are created owned by root.** If the mount target does not exist in the
# base image, Docker prepares an empty volume owned by root. The agent does not run as
# root, so as is, neither settings nor authentication can be saved.
CONFIG_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
if [ -d "$CONFIG_DIR" ] && [ ! -w "$CONFIG_DIR" ]; then
  sudo chown -R "$(id -u):$(id -g)" "$CONFIG_DIR"
  echo "Fixed the owner of the settings location: $CONFIG_DIR"
fi

# Make the credentials visible from every shell in this environment.
# Loading them by hand every time only adds steps, and if forgotten neither gh nor git works.
if [ -f "$ENV_FILE" ]; then
  LOADER="set -a; . '$ENV_FILE'; set +a"
  for rc in "$HOME/.bashrc" "$HOME/.zshrc"; do
    [ -f "$rc" ] || continue
    grep -qF "$ENV_FILE" "$rc" || {
      printf '\n# credentials of this project\n[ -f %s ] && { %s; }\n' "$ENV_FILE" "$LOADER" >> "$rc"
    }
  done
  # Also used by the setup below.
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi

# Let pushes to the Repo go through without asking for credentials.
git config --global credential."https://github.com".helper \
  '!f() { echo username=x-access-token; echo "password=${GH_TOKEN}"; }; f'

# Commit author information. **Host settings are not carried over**, so it is needed on every rebuild.
# Without it, commit itself fails. The values are for the human to decide, so they come from .env.
[ -n "${GIT_USER_NAME:-}" ]  && git config --global user.name  "$GIT_USER_NAME"
[ -n "${GIT_USER_EMAIL:-}" ] && git config --global user.email "$GIT_USER_EMAIL"

# --- check -------------------------------------------------------------------

# **The check does not run here.** `postStartCommand` runs it after closing the egress.
#
# While it sat here, the check falsely reported "the egress restriction is not in effect" every time.
# **devcontainer runs postCreate → postStart, so at this point init-firewall.sh has not run yet,
# and the egress is always open** (AUT-169).
#
# Right after the environment is created, postStart runs next as well. **No chance to check is lost.**
# If anything, it now runs on every start, so a state where the rules disappeared is seen every time.
