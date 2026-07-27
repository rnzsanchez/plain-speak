#!/bin/bash
# plain-speak — statusline badge. Bash on purpose: this runs on every keystroke,
# and node's startup cost is too high for that.
#
# The badge ends with a space so it never runs into whatever follows it.
# Chain it into your existing statusline rather than replacing it:
#   "statusLine": { "type": "command",
#     "command": "bash ~/.claude/plain-speak/src/plain-speak-statusline.sh; bash ~/mine.sh" }

# A project can pin its own mode; otherwise the global one applies.
FLAG="./.plain-speak-mode"
[ -f "$FLAG" ] || FLAG="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/plain-speak/mode"

# Refuse symlinks: a local attacker could point the flag at another file and have
# the statusline render its bytes — including terminal escapes — on every keystroke.
[ -L "$FLAG" ] && exit 0
[ ! -f "$FLAG" ] && exit 0

# Builtins only, no subprocesses. This runs on every keystroke, and four forks for
# head/tr cost more than everything else here put together.
MODE=""
IFS= read -r MODE < "$FLAG" || true
MODE="${MODE:0:32}"
MODE="${MODE//[!A-Za-z-]/}"   # strip anything that could carry a terminal escape
shopt -s nocasematch

case "$MODE" in
  normal) printf '\033[38;5;79m[PLAIN-SPEAK]\033[0m ' ;;
  cte)    printf '\033[38;5;170m[PLAIN-SPEAK 🧠 CTE]\033[0m ' ;;
  *)      exit 0 ;;  # off, empty, or anything unrecognised renders nothing
esac
