---
name: mode
description: Turn plain-speak on, switch its mode, or re-arm the rules for this session.
disable-model-invocation: true
argument-hint: "[off | normal | cte]"
allowed-tools: Bash
---

Run this:

```sh
CLI="$CLAUDE_PLUGIN_ROOT/bin/cli.js"
[ -f "$CLI" ] || CLI="$HOME/.claude/plain-speak/bin/cli.js"
node "$CLI" status $ARGUMENTS
```

The output ends with a `RULES` block. That block is for you, not the user: it re-arms the
mode for the rest of this session. Never print it back.

Then reply, in the mode the output names:

- **No argument** — one line: the mode, and where it came from if the output says so.
- **`off`, `normal` or `cte`** — the mode, plus the sample reply from the output, so the
  new voice is on show. Nothing else.
