# Agent Instructions

This project uses **bd** (beads) for issue tracking. Run `bd onboard` to get started.

## Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work atomically
bd close <id>         # Complete work
bd export -o .beads/issues.jsonl  # Export the snapshot before committing
```

## Git Flow

本仓库使用 git flow，直接运行 Git 命令。沿用现有的 `feat/`、`fix/` 前缀。

| 分支 | 用途 | 创建基点 | PR 目标 |
| --- | --- | --- | --- |
| `main` | 已发布代码，每个版本有 `v<版本号>` 标签 | 发布或紧急修复合并 | — |
| `develop` | 下一版本的集成分支 | 用户确认的初始提交 | — |
| `feat/<短名>`、`fix/<短名>` | 一个功能或一次修复 | 最新 `develop` | `develop` |
| `release/<版本号>` | 版本号、发布说明和发布修复 | `develop` | `main`，发布后合并回 `develop` |
| `hotfix/<版本号>` | 已发布版本的紧急修复 | `main` | `main`，发布后合并回 `develop` |

开始工作前：

1. 检查 `git status --short --branch`、当前分支和远端状态，保留用户已有改动。
2. 运行 `git fetch origin`，从最新 `develop` 创建本次工作的 `feat/` 或 `fix/` 分支。
3. 本地和远端都没有 `develop` 时，先让用户指定创建基点，再创建和推送。
4. 一个功能分支只做一件事。直接提交的目标必须是功能、发布或紧急修复分支。

提交和 PR：

- 提交前检查全部变更，并将 Beads 导出快照加入同一次提交。
- 功能和修复完成后创建指向 `develop` 的 PR。PR 说明最终行为、验证结果和已知限制。
- 用户要求提交 PR 时，授权包含该 PR 所需的功能分支推送。其他推送先确认是否已有授权。
- 已推送分支也要核对 PR 是否存在；交付时提供 PR 链接。
- 已有旧分支先比较补丁是否已进入集成分支。已包含的改动不重复提交 PR。
- 旧分支与当前实现冲突时，保留原提交，创建草稿 PR 并写明冲突及未验证范围。

合并和发布：

- 合并功能、发布和紧急修复分支时使用 `git merge --no-ff`，保留分支历史。
- 发布前提高版本号。合并到 `main`、打标签、发布和删除远端分支前，核对用户对该操作的明确授权。
- `release/` 或 `hotfix/` 合并到 `main` 后，在该版本提交上打标签，再合并回 `develop`。
- 功能分支在 PR 合并后清理。远端分支删除仍需用户授权。

## Non-Interactive Shell Commands

**ALWAYS use non-interactive flags** with file operations to avoid hanging on confirmation prompts.

Shell commands like `cp`, `mv`, and `rm` may be aliased to include `-i` (interactive) mode on some systems, causing the agent to hang indefinitely waiting for y/n input.

**Use these forms instead:**
```bash
# Force overwrite without prompting
cp -f source dest           # NOT: cp source dest
mv -f source dest           # NOT: mv source dest
rm -f file                  # NOT: rm file

# For recursive operations
rm -rf directory            # NOT: rm -r directory
cp -rf source dest          # NOT: cp -r source dest
```

**Other commands that may prompt:**
- `scp` - use `-o BatchMode=yes` for non-interactive
- `ssh` - use `-o BatchMode=yes` to fail instead of prompting
- `apt-get` - use `-y` flag
- `brew` - use `HOMEBREW_NO_AUTO_UPDATE=1` env var

<!-- BEGIN BEADS INTEGRATION -->
## Issue Tracking with bd (beads)

**IMPORTANT**: This project uses **bd (beads)** for ALL issue tracking. Do NOT use markdown TODOs, task lists, or other tracking methods.

### Why bd?

- Dependency-aware: Track blockers and relationships between issues
- Version-controlled: Built on Dolt with cell-level merge
- Agent-optimized: JSON output, ready work detection, discovered-from links
- Prevents duplicate tracking systems and confusion

### Quick Start

**Check for ready work:**

```bash
bd ready --json
```

**Create new issues:**

```bash
bd create "Issue title" --description="Detailed context" -t bug|feature|task -p 0-4 --json
bd create "Issue title" --description="What this issue is about" -p 1 --deps discovered-from:bd-123 --json
```

**Claim and update:**

```bash
bd update <id> --claim --json
bd update bd-42 --priority 1 --json
```

**Complete work:**

```bash
bd close bd-42 --reason "Completed" --json
```

### Issue Types

- `bug` - Something broken
- `feature` - New functionality
- `task` - Work item (tests, docs, refactoring)
- `epic` - Large feature with subtasks
- `chore` - Maintenance (dependencies, tooling)

### Priorities

- `0` - Critical (security, data loss, broken builds)
- `1` - High (major features, important bugs)
- `2` - Medium (default, nice-to-have)
- `3` - Low (polish, optimization)
- `4` - Backlog (future ideas)

### Workflow for AI Agents

1. **Check ready work**: `bd ready` shows unblocked issues
2. **Claim your task atomically**: `bd update <id> --claim`
3. **Work on it**: Implement, test, document
4. **Discover new work?** Create linked issue:
   - `bd create "Found bug" --description="Details about what was found" -p 1 --deps discovered-from:<parent-id>`
5. **Complete**: `bd close <id> --reason "Done"`

### Auto-Sync

Use the tracked `.beads/issues.jsonl` snapshot to share issue state through Git.
Run `bd export -o .beads/issues.jsonl` and stage it before every commit that changes issue state.
The installed CLI has no `bd sync` subcommand, and this repository has no Dolt remote.
Do not rely on background export or Git hooks to stage the snapshot.

### Important Rules

- ✅ Use bd for ALL task tracking
- ✅ Always use `--json` flag for programmatic use
- ✅ Link discovered work with `discovered-from` dependencies
- ✅ Check `bd ready` before asking "what should I work on?"
- ❌ Do NOT create markdown TODO lists
- ❌ Do NOT use external issue trackers
- ❌ Do NOT duplicate tracking systems

For more details, see README.md and docs/QUICKSTART.md.

## Landing the Plane (Session Completion)

**When ending a work session**, complete these steps within the user's authorized scope.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **Commit and publish the PR** - Export and stage the Beads snapshot, then commit on the work branch. Fetch before pushing. Rebase only an unpublished work branch; coordinate changes to shared history. Push the work branch when authorized and create its PR against the Git Flow target above.
5. **Verify** - Check the PR base and head, the remote commit, and the worktree status. Preserve user changes and stashes.
6. **Hand off** - Provide the PR link, validation results, and any pending release or merge work.

**CRITICAL RULES:**
- A PR request is complete when the authorized work is committed, pushed, and linked to its PR.
- When authorization is required, finish the local changes and checks first, then state the exact pending operation.
- Resolve push failures without discarding user work or rewriting shared history without agreement.

<!-- END BEADS INTEGRATION -->

## Commit-Time Beads Sync

This repo wires beads into git via `core.hooksPath=.beads/hooks`. bd's own `pre-commit` hook runs forensics only (agent-identity trailers, chained bd hooks) — **it does NOT auto-export `issues.jsonl` into the current commit**. You must do that explicitly.

**Required workflow before every `git commit`** (agent responsibility):

```bash
bd export -o .beads/issues.jsonl
git add .beads/issues.jsonl
git commit -m "..."
```

- `.beads/issues.jsonl` is tracked in git (`.beads/.gitignore` explicitly does NOT ignore it). Every commit that changes beads state should also carry the updated JSONL snapshot in the same commit, so `git log -p -- .beads/issues.jsonl` stays reviewable.
- Background export, when available, does not stage the snapshot. Only your explicit `git add` gets the file into the commit.

Agent rules:

- Before starting work on a task, `bd create` an issue (or claim an existing one with `bd update <id> --status in_progress`).
- On completion, update the description (mark execution-plan checkboxes as done) then `bd close <id> --reason "…"`. Do this **before** the `bd export` + `git commit` step, so the closing state lands in the JSONL snapshot.
- **Do not edit `.beads/hooks/*`** — bd regenerates those files and will overwrite manual changes. If a hook misbehaves, run `bd doctor`.
- Prefer referencing the issue id in commit messages: `Refs: t-<id>` or `Closes: t-<id>`.

Running bd inside Claude Code sandboxes: bd connects to a local Dolt server on localhost. Pass `dangerouslyDisableSandbox: true` on the Bash tool call whenever the command uses `bd`, `git commit` (because it triggers the bd hook), or `git push`.
