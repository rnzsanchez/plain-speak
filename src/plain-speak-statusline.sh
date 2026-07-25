#!/bin/bash
# plain-speak — statusline badge. Bash on purpose: this runs on every keystroke,
# and node's startup cost is too high for that.
#
# Chain it into your existing statusline rather than replacing it:
#   "statusLine": { "type": "command",
#     "command": "bash ~/.claude/plain-speak/statusline.sh; bash ~/my-statusline.sh" }

FLAG="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/plain-speak/mode"

# Refuse symlinks: a local attacker could point the flag at another file and have
# the statusline render its bytes — including terminal escapes — on every keystroke.
[ -L "$FLAG" ] && exit 0
[ ! -f "$FLAG" ] && exit 0

# Cap the read and strip anything outside [a-z-] to block escape-sequence injection.
MODE=$(head -c 32 "$FLAG" 2>/dev/null | tr -d '\n\r' | tr '[:upper:]' '[:lower:]')
MODE=$(printf '%s' "$MODE" | tr -cd 'a-z-')

case "$MODE" in
  normal) printf '\033[38;5;79m[PLAIN-SPEAK]\033[0m' ;;
  cte)    printf '\033[38;5;170m[PLAIN-SPEAK 🧠 CTE]\033[0m' ;;
  *)      exit 0 ;;  # off, empty, or anything unrecognised renders nothing
esac
