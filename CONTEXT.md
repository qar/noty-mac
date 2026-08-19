# Noty Work Orchestration

Noty organizes durable responsibilities, concrete deliveries, and the local development contexts used to carry them out.

## Language

**Workflow**:
A durable responsibility and its reusable delivery procedure. A workflow is not the record of one release or request.
_Avoid_: Workspace, run, checklist

**Workflow Run**:
One immutable-snapshot execution of a workflow for a specific request, version, or work item.
_Avoid_: Workflow, session

**Stage**:
An ordered group of tasks whose members run serially or become available in parallel.
_Avoid_: Status, project

**Task**:
One independently tracked piece of work in a workflow run, completed manually, by approval, by a command, or by a local AI program.
_Avoid_: Stage, issue

**Execution Context**:
The isolated checkout used by tasks for one repository in one workflow run. Tasks in the same run share that repository context.
_Avoid_: Workspace

**Workspace**:
A user-facing development context linked to a tmux session and project. It is a place to enter work, not a durable delivery procedure.
_Avoid_: Workflow, execution context

**Evidence**:
A reference recorded when completing a task, such as a commit, package, email, work item, or release URL.
_Avoid_: Log
