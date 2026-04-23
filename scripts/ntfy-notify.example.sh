#!/usr/bin/env bash
# Claude Code -> ntfy notification hook
# Purpose:
# 1) Only notify when Claude needs human intervention.
# 2) Include Claude's message for the human.
# 3) Attach tmux target so clicking card can jump to the right pane.

set -euo pipefail

# If jq is unavailable, do nothing (avoid breaking Claude hooks).
command -v jq >/dev/null 2>&1 || exit 0

INPUT="$(cat)"

# --- Trigger condition: send all Claude notifications ---
# (No notification_type filtering; user wants all notifications jumpable.)
NTYPE="$(echo "$INPUT" | jq -r '.notification_type // empty')"

# --- Basic fields ---
TOPIC="${NTFY_CHANNEL:-}"
if [ -z "$TOPIC" ]; then
  TOPIC="$(echo "$INPUT" | jq -r '.topic // empty')"
fi
[ -n "$TOPIC" ] || exit 0

SERVER="${NTFY_SERVER:-https://ntfy.sh}"
SERVER="${SERVER%/}"

TITLE="$(echo "$INPUT" | jq -r '.title // "Claude Code"')"
MESSAGE="$(echo "$INPUT" | jq -r '.message // "Claude Code 需要你的处理"')"
CWD="$(echo "$INPUT" | jq -r '.cwd // empty')"

NTFY_TITLE="$TITLE"
if [ -n "$NTYPE" ]; then
  NTFY_TITLE="${NTFY_TITLE} (${NTYPE})"
fi

# --- Context line (repo/branch) ---
GIT_INFO=""
if [ -n "$CWD" ] && [ -d "$CWD" ] && git -C "$CWD" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  REPO="$(basename "$(git -C "$CWD" rev-parse --show-toplevel 2>/dev/null)" 2>/dev/null || true)"
  BRANCH="$(git -C "$CWD" branch --show-current 2>/dev/null || true)"
  if [ -n "$REPO" ]; then
    GIT_INFO="📂 ${REPO}"
    [ -n "$BRANCH" ] && GIT_INFO="${GIT_INFO} (${BRANCH})"
  fi
fi

# --- tmux target resolution (priority: input target > session/window/pane > local detect) ---
SOURCE_TMUX_PANE="${TMUX_PANE:-}"
TMUX_TARGET="$(echo "$INPUT" | jq -r '.tmux.target // .metadata.tmux.target // .tmuxTarget // .tmux_target // .target // empty')"
TMUX_SESSION="$(echo "$INPUT" | jq -r '.tmux.session // .metadata.tmux.session // .tmux_session // empty')"
TMUX_WINDOW="$(echo "$INPUT" | jq -r '.tmux.window // .metadata.tmux.window // .tmux_window // empty')"
TMUX_PANE="$(echo "$INPUT" | jq -r '.tmux.pane // .metadata.tmux.pane // .tmux_pane // empty')"
if [ -z "$SOURCE_TMUX_PANE" ]; then
  SOURCE_TMUX_PANE="$TMUX_PANE"
fi

if [ -z "$TMUX_TARGET" ] && [ -n "$TMUX_SESSION" ] && [ -n "$TMUX_WINDOW" ] && [ -n "$TMUX_PANE" ]; then
  TMUX_TARGET="${TMUX_SESSION}:${TMUX_WINDOW}.${TMUX_PANE}"
fi

if [ -z "$TMUX_TARGET" ] && [ -n "$SOURCE_TMUX_PANE" ] && command -v tmux >/dev/null 2>&1; then
  TMUX_TARGET="$SOURCE_TMUX_PANE"
  TMUX_SESSION="$(tmux display-message -p -t "$SOURCE_TMUX_PANE" '#S' 2>/dev/null || true)"
  TMUX_WINDOW="$(tmux display-message -p -t "$SOURCE_TMUX_PANE" '#I' 2>/dev/null || true)"
  TMUX_PANE="$(tmux display-message -p -t "$SOURCE_TMUX_PANE" '#P' 2>/dev/null || true)"
fi

if [ -z "$TMUX_TARGET" ] && command -v tmux >/dev/null 2>&1; then
  if [ -n "${TMUX:-}" ]; then
    TMUX_TARGET="$(tmux display-message -p '#{pane_id}' 2>/dev/null || true)"
    TMUX_SESSION="$(tmux display-message -p '#S' 2>/dev/null || true)"
    TMUX_WINDOW="$(tmux display-message -p '#I' 2>/dev/null || true)"
    TMUX_PANE="$(tmux display-message -p '#P' 2>/dev/null || true)"
  else
    ACTIVE_CLIENT="$(tmux list-clients -F '#{client_activity}	#{client_name}' 2>/dev/null | sort -nr | awk 'NR==1 {print $2}')"
    if [ -n "$ACTIVE_CLIENT" ]; then
      TMUX_TARGET="$(tmux display-message -p -c "$ACTIVE_CLIENT" '#{pane_id}' 2>/dev/null || true)"
      TMUX_SESSION="$(tmux display-message -p -c "$ACTIVE_CLIENT" '#S' 2>/dev/null || true)"
      TMUX_WINDOW="$(tmux display-message -p -c "$ACTIVE_CLIENT" '#I' 2>/dev/null || true)"
      TMUX_PANE="$(tmux display-message -p -c "$ACTIVE_CLIENT" '#P' 2>/dev/null || true)"
    fi
  fi
fi

TMUX_INFO=""
[ -n "$TMUX_TARGET" ] && TMUX_INFO="🖥 tmux: ${TMUX_TARGET}"

# --- Build human-readable body ---
BODY="$MESSAGE"
[ -n "$GIT_INFO" ] && BODY="${GIT_INFO}

${BODY}"
[ -n "$TMUX_INFO" ] && BODY="${TMUX_INFO}

${BODY}"

# Optional chain test app for click-flow verification: calendar|safari
CHAIN_TEST_APP=""
if [ -n "${NTFY_CHAIN_TEST_APP:-}" ]; then
  APP="$(printf '%s' "$NTFY_CHAIN_TEST_APP" | tr '[:upper:]' '[:lower:]')"
  if [ "$APP" = "calendar" ] || [ "$APP" = "safari" ]; then
    CHAIN_TEST_APP="$APP"
  fi
fi

# --- Build payload ---
PAYLOAD="$(jq -n \
  --arg topic "$TOPIC" \
  --arg title "$NTFY_TITLE" \
  --arg message "$BODY" \
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
    } else {} end)'
)"

# --- Send ---
curl -fsS \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD" \
  "$SERVER" >/dev/null
