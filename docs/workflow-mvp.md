# Workflow MVP

## Purpose

A workflow represents a durable responsibility. Each request or release creates a workflow run with an immutable copy of the current stages and tasks.

## Task Model

- Stages are ordered. A serial stage unlocks one task at a time; a parallel stage unlocks all its tasks together.
- A stage starts only after every task in the previous stage succeeded or was explicitly skipped.
- Manual and approval tasks are completed by the user. Command and AI tasks are explicitly started by the user.
- A failed or interrupted task blocks downstream work. It can be retried in the same context or skipped with a required reason.
- Run completion distinguishes clean completion from completion containing skipped tasks.

## Repository Safety

- Each workflow run creates one worktree per referenced repository under the configured global worktrees directory.
- Tasks in that run share the repository worktree; separate runs never share one.
- Git and task commands use argument arrays with `shell: false`.
- Noty does not fetch, pull, commit, merge, push, or automatically remove completed worktrees.
- A repository and local base ref must exist before the run is created. Partial context creation is rolled back on failure.

## Template Variables

Command arguments and AI prompts support `{{run.title}}`, `{{run.version}}`, `{{run.workItem}}`, `{{repo.<alias>.path}}`, and `{{repo.<alias>.branch}}`. A missing variable prevents the task from starting.

## Deferred Integrations

Email, issue trackers, package upload, and release platforms are represented as manual or approval tasks with evidence in this version. Direct external adapters and automatic task start are intentionally deferred.
