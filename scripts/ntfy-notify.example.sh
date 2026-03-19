#!/usr/bin/env bash
# Example: send Claude notification payload to ntfy with optional tmux metadata.
#
# Usage:
#   export NTFY_CHANNEL="your-topic"
#   export NTFY_SERVER="https://ntfy.sh"      # optional
#   export NTFY_CHAIN_TEST_APP="calendar"     # optional: calendar|safari
#   cat event.json | ./scripts/ntfy-notify.example.sh

set -euo pipefail

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required" >&2
  exit 1
fi

INPUT=$(cat)
TOPIC="${NTFY_CHANNEL:-}"
SERVER="${NTFY_SERVER:-https://ntfy.sh}"
SERVER="${SERVER%/}"

if [ -z "$TOPIC" ]; then
  TOPIC=$(echo "$INPUT" | jq -r '.topic // empty')
fi
if [ -z "$TOPIC" ]; then
  echo "NTFY_CHANNEL (or .topic in input JSON) is required" >&2
  exit 1
fi

TITLE=$(echo "$INPUT" | jq -r '.title // "Claude Code"')
MESSAGE=$(echo "$INPUT" | jq -r '.message // "需要你的输入"')
NTYPE=$(echo "$INPUT" | jq -r '.notification_type // empty')

TMUX_SESSION=""
TMUX_WINDOW=""
TMUX_PANE=""
TMUX_TARGET=""
if [ -n "${TMUX:-}" ] && command -v tmux >/dev/null 2>&1; then
  TMUX_SESSION=$(tmux display-message -p '#S' 2>/dev/null || true)
  TMUX_WINDOW=$(tmux display-message -p '#I' 2>/dev/null || true)
  TMUX_PANE=$(tmux display-message -p '#P' 2>/dev/null || true)
  if [ -n "$TMUX_SESSION" ] && [ -n "$TMUX_WINDOW" ] && [ -n "$TMUX_PANE" ]; then
    TMUX_TARGET="${TMUX_SESSION}:${TMUX_WINDOW}.${TMUX_PANE}"
  fi
fi

CHAIN_TEST_APP=""
if [ -n "${NTFY_CHAIN_TEST_APP:-}" ]; then
  app=$(printf '%s' "$NTFY_CHAIN_TEST_APP" | tr '[:upper:]' '[:lower:]')
  if [ "$app" = "calendar" ] || [ "$app" = "safari" ]; then
    CHAIN_TEST_APP="$app"
  fi
fi

FULL_TITLE="$TITLE"
if [ -n "$NTYPE" ]; then
  FULL_TITLE="${FULL_TITLE} (${NTYPE})"
fi

PAYLOAD=$(jq -n \
  --arg topic "$TOPIC" \
  --arg title "$FULL_TITLE" \
  --arg message "$MESSAGE" \
  --arg tmuxTarget "$TMUX_TARGET" \
  --arg tmuxSession "$TMUX_SESSION" \
  --arg tmuxWindow "$TMUX_WINDOW" \
  --arg tmuxPane "$TMUX_PANE" \
  --arg chainTestApp "$CHAIN_TEST_APP" \
  '{
    topic: $topic,
    title: $title,
    message: $message,
    tags: ["robot"]
  }
  + (if ($tmuxTarget | length) > 0 then {
      tmux: {
        target: $tmuxTarget,
        session: $tmuxSession,
        window: $tmuxWindow,
        pane: $tmuxPane
      },
      metadata: {
        tmux: {
          target: $tmuxTarget,
          session: $tmuxSession,
          window: $tmuxWindow,
          pane: $tmuxPane
        }
      }
    } else {} end)
  + (if ($chainTestApp | length) > 0 then {
      chainTestApp: $chainTestApp,
      metadata: ((.metadata // {}) + { chainTestApp: $chainTestApp })
    } else {} end)')

curl -fsS -H "Content-Type: application/json" -d "$PAYLOAD" "$SERVER" >/dev/null
