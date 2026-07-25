#!/usr/bin/env bash
# A/B the response rules: same prompts, hook on vs off, compare output tokens.
# Toggles by emptying ~/.claude/response-rules.md so only THIS hook changes —
# blanking every hook would also drop unrelated context injections and skew the result.
set -euo pipefail

RULES=~/.claude/response-rules.md
SRC="$(cd "$(dirname "$0")" && pwd)/response-rules.md"
PROMPTS="${1:-$(dirname "$SRC")/prompts.txt}"
BACKUP=$(mktemp)

cp "$RULES" "$BACKUP" 2>/dev/null || : > "$BACKUP"
trap 'cp "$BACKUP" "$RULES"; rm -f "$BACKUP"' EXIT

run() { # $1 = prompt -> "output_tokens cost"
  cd /tmp && claude -p "$1" --output-format json \
    | jq -r '"\(.usage.output_tokens) \(.total_cost_usd)"'
}

off_tok=0 on_tok=0 off_cost=0 on_cost=0 n=0
printf '%-46s %8s %8s\n' PROMPT OFF ON
while IFS= read -r p; do
  [ -z "$p" ] && continue
  : > "$RULES";        read -r a b <<<"$(run "$p")"
  cp "$SRC" "$RULES";  read -r c d <<<"$(run "$p")"
  off_tok=$((off_tok + a)); on_tok=$((on_tok + c)); n=$((n + 1))
  off_cost=$(echo "$off_cost + $b" | bc -l); on_cost=$(echo "$on_cost + $d" | bc -l)
  printf '%-46.46s %8d %8d\n' "$p" "$a" "$c"
done < "$PROMPTS"

rules_tok=$(( $(wc -c < "$SRC") / 4 ))  # ~4 chars/token; measured value was 187
printf '\n%d prompts\n' "$n"
printf 'output tokens   off=%d  on=%d  saved=%d (%.0f%%)\n' \
  "$off_tok" "$on_tok" $((off_tok - on_tok)) \
  "$(echo "($off_tok - $on_tok) * 100 / $off_tok" | bc -l)"
printf 'rules injected  ~%d tok/prompt x %d = ~%d tok\n' "$rules_tok" "$n" $((rules_tok * n))
printf 'cost usd        off=%.4f  on=%.4f\n' "$off_cost" "$on_cost"
