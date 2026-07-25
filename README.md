# plain-speak

Response rules for Claude Code, injected on every session start and every prompt.

## Install

```sh
cp response-rules.md ~/.claude/response-rules.md
```

Add to `~/.claude/settings.json`:

```json
{
  "hooks": {
    "SessionStart": [
      { "hooks": [{ "type": "command", "command": "cat ~/.claude/response-rules.md" }] }
    ],
    "UserPromptSubmit": [
      { "hooks": [{ "type": "command", "command": "cat ~/.claude/response-rules.md" }] }
    ]
  }
}
```

Open `/hooks` once to reload, or restart.

## Edit

Change `response-rules.md`, copy it to `~/.claude/`. No settings edit needed.
