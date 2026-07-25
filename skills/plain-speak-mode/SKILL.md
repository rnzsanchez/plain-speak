---
name: plain-speak-mode
description: Switch plain-speak mode — off, normal, or cte.
disable-model-invocation: true
argument-hint: off | normal | cte
allowed-tools: Bash
---

Set the mode to `$ARGUMENTS`:

```sh
node "$HOME/.claude/plain-speak/bin/cli.js" mode $ARGUMENTS
```

Report the new mode in one line. Nothing else.

If `$ARGUMENTS` is empty, run the command with no argument — it prints the current
mode instead of changing it.

The new mode applies from your next message onward.
