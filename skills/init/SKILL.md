---
name: init
description: Show which plain-speak mode is active, or switch it.
disable-model-invocation: true
argument-hint: "[off | normal | cte]"
allowed-tools: Bash
---

## No argument

Run nothing. The active mode is already in this session's context, injected at session
start as a `PLAIN-SPEAK MODE:` line and again on every switch. Reply with one line: the
mode, and `/plain-speak:init off | normal | cte` to change it.

## A mode was passed

Switching writes state and has to re-arm the rules, so run this once:

```sh
CLI="$CLAUDE_PLUGIN_ROOT/bin/cli.js"
[ -f "$CLI" ] || CLI="$HOME/.claude/plain-speak/bin/cli.js"
node "$CLI" status $ARGUMENTS
```

The output ends with a `RULES` block. That block is for you, not the user: it re-arms the
mode for the rest of this session. Never print it back.

Then reply in the new mode — name it, and show the sample reply from the output so the
voice is on display. Nothing else.
