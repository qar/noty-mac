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
SOURCE_PROJECT=""
TMUX_TARGET="$(echo "$INPUT" | jq -r '.tmux.target // .metadata.tmux.target // .tmuxTarget // .tmux_target // .target // empty')"
TMUX_SESSION="$(echo "$INPUT" | jq -r '.tmux.session // .metadata.tmux.session // .tmux_session // empty')"
TMUX_WINDOW="$(echo "$INPUT" | jq -r '.tmux.window // .metadata.tmux.window // .tmux_window // empty')"
TMUX_PANE="$(echo "$INPUT" | jq -r '.tmux.pane // .metadata.tmux.pane // .tmux_pane // empty')"
if [ -z "$TMUX_TARGET" ] && [ -n "$TMUX_SESSION" ] && [ -n "$TMUX_WINDOW" ] && [ -n "$TMUX_PANE" ]; then
  TMUX_TARGET="${TMUX_SESSION}:${TMUX_WINDOW}.${TMUX_PANE}"
fi

if [ -z "$TMUX_TARGET" ] && [[ "$TMUX_PANE" =~ ^%[0-9]+$ ]]; then
  TMUX_TARGET="$TMUX_PANE"
fi

if [ -z "$TMUX_TARGET" ] && command -v tmux >/dev/null 2>&1; then
  SOURCE_CWD="${CWD:-$PWD}"
  # Tool cwd may be a temporary review checkout. The thread's session header
  # records its terminal launch directory without trusting shared-daemon env.
  THREAD_ID="${CODEX_THREAD_ID:-}"
  THREAD_CWD=""
  if [[ "$THREAD_ID" =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$ ]]; then
    SESSION_FILES=("${CODEX_HOME:-$HOME/.codex}"/sessions/*/*/*/rollout-*-"$THREAD_ID".jsonl)
    if [ "${#SESSION_FILES[@]}" -eq 1 ] && [ -f "${SESSION_FILES[0]}" ]; then
      SESSION_HEADER=""
      IFS= read -r SESSION_HEADER < "${SESSION_FILES[0]}" || true
      THREAD_CWD="$(printf '%s' "$SESSION_HEADER" | jq -er --arg thread "$THREAD_ID" '
        select(.type == "session_meta" and .payload.id == $thread) | .payload.cwd
        | select(type == "string" and startswith("/") and (test("[\\r\\n\\t]") | not))' 2>/dev/null || true)"
      [ -z "$THREAD_CWD" ] || SOURCE_CWD="$THREAD_CWD"
    fi
  fi
  SOURCE_CWD="$(cd "$SOURCE_CWD" 2>/dev/null && pwd -P || printf '%s' "$SOURCE_CWD")"
  SOURCE_ROOT="$(git -C "$SOURCE_CWD" rev-parse --show-toplevel 2>/dev/null || printf '%s' "$SOURCE_CWD")"
  # Shared agent daemons can retain another terminal's TMUX_PANE. Validate it
  # against this notification's checkout; never use the currently active pane.
  # A unique foreground Codex can be distinguished from sibling idle shells;
  # another agent or an unknown command remains ambiguous.
  PANE_SNAPSHOT="$(LC_ALL=en_US.UTF-8 tmux list-panes -a -F $'#{pane_id}\t#{pane_current_path}\t#{pane_current_command}' 2>/dev/null || true)"
  TMUX_TARGET="$(printf '%s' "$PANE_SNAPSHOT" | jq -Rrs \
    --arg cwd "$SOURCE_CWD" --arg root "$SOURCE_ROOT" --arg inherited "$SOURCE_TMUX_PANE" \
    --arg codexThread "${CODEX_THREAD_ID:-}" '
    [split("\n")[] | split("\t") | select(length == 3 and (.[0] | test("^%[0-9]+$")))
      | {id: .[0], path: .[1], command: .[2]} | select(.path == $root or (.path | startswith($root + "/")))] as $project
    | [$project[] | select(.path == $cwd)] as $exact
    | (if ($exact | length) > 0 then $exact else $project end) as $matches
    | [$matches[] | select(.command == "codex")] as $codex
    | if $codexThread == "" and any($project[]; .id == $inherited) then $inherited
      elif ($matches | length) == 1 then $matches[0].id
      elif $codexThread != "" and ($codex | length) == 1
        and all($matches[]; .command == "codex" or (.command | test("^(bash|zsh|sh|fish|dash|ksh|nu)$"))) then $codex[0].id
      else empty end')"
  if [ -n "$TMUX_TARGET" ]; then
    if [ -n "${THREAD_CWD:-}" ]; then
      SOURCE_PROJECT="$(basename "$SOURCE_ROOT")"
    fi
    TMUX_SESSION="$(tmux display-message -p -t "$TMUX_TARGET" '#S' 2>/dev/null || true)"
    TMUX_WINDOW="$(tmux display-message -p -t "$TMUX_TARGET" '#I' 2>/dev/null || true)"
    TMUX_PANE="$(tmux display-message -p -t "$TMUX_TARGET" '#P' 2>/dev/null || true)"
  fi
fi

TMUX_INFO=""
[ -n "$TMUX_TARGET" ] && TMUX_INFO="🖥 tmux: ${TMUX_TARGET}"
if [ -n "$SOURCE_PROJECT" ]; then
  TMUX_INFO="${TMUX_INFO}
tmux-source: $(jq -cn --arg project "$SOURCE_PROJECT" '{project: $project}')"
fi

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
  --arg sourceProject "$SOURCE_PROJECT" \
  --arg chainTestApp "$CHAIN_TEST_APP" \
  '{
    topic: $topic,
    title: $title,
    message: $message,
    tags: ["robot"]
  }
  + (if ($tmuxTarget | length) > 0 then {
      tmux: ({
        target: $tmuxTarget,
        session: $tmuxSession,
        window: $tmuxWindow,
        pane: $tmuxPane
      } + (if $sourceProject != "" then {sourceProject: $sourceProject} else {} end)),
      metadata: {
        tmux: ({
          target: $tmuxTarget,
          session: $tmuxSession,
          window: $tmuxWindow,
          pane: $tmuxPane
        } + (if $sourceProject != "" then {sourceProject: $sourceProject} else {} end))
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
