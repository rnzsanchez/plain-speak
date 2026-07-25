---
name: stats
description: Token and drift report for plain-speak — this session plus lifetime.
disable-model-invocation: true
allowed-tools: Bash
---

Run this and show the output exactly as printed, with no commentary:

```sh
CLI="$CLAUDE_PLUGIN_ROOT/bin/cli.js"
[ -f "$CLI" ] || CLI="$HOME/.claude/plain-speak/bin/cli.js"
node "$CLI" stats
```
