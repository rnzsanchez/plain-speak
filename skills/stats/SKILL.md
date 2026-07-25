---
name: stats
description: Token and drift report for plain-speak — this session plus lifetime.
disable-model-invocation: true
allowed-tools: Bash
---

Run this and show the output exactly as printed, with no commentary:

```sh
node "$(ls "$CLAUDE_PLUGIN_ROOT/bin/cli.js" "$HOME/.claude/plain-speak/bin/cli.js" 2>/dev/null | head -1)" stats
```
