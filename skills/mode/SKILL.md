---
name: mode
description: Turn plain-speak on, switch its mode, or show where it stands.
disable-model-invocation: true
argument-hint: "[off | normal | cte]"
allowed-tools: Bash
---

Run this and show the output exactly as printed, with no commentary:

```sh
CLI="$CLAUDE_PLUGIN_ROOT/bin/cli.js"
[ -f "$CLI" ] || CLI="$HOME/.claude/plain-speak/bin/cli.js"
node "$CLI" status $ARGUMENTS
```

With no argument it turns plain-speak on if it was off, then reports the mode. With
`off`, `normal` or `cte` it switches. A switch applies from the next message onward.
