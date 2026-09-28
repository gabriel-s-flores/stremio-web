# Agent instructions

## WebOS task branch development flow

- Develop each webOS task on its own branch named `t3code/implement-<task-id>`; do not implement or commit task work directly on `webos`.
- Start from the latest `origin/webos`. If a task depends on work that has not merged yet, stack its branch on that task branch and record the dependency in the plan/evidence. Rebase or retarget after the dependency merges.
- Before editing, check the active branch and `git status`. Preserve pre-existing staged and unstaged changes; keep commits limited to one task and its required Markdown/artifacts.
- Treat Markdown as part of the deliverable. Update the task plan and checkboxes, add/update `tests/webos/<task> - Evidências.md`, refresh phase status and downstream handoffs, including the Fase 6 `appinfo.json` item when relevant. Sync `~/stremio-memory` only when it is available.
- Mark a criterion complete only when its evidence exists. Record commands, results, limitations, and artifact links. Unrun tests/builds/runtime checks stay open.
- Commit task code and versioned Markdown with the task ID in the message. Push to `origin/<task-branch>`, confirm the exact commit SHA is present there, then report the branch. Integrate into `webos` through review after the task branch is ready; do not push directly to `origin/webos` as the task workflow.
- If commit or push fails, keep the task open and report the failure. Never include unrelated or pre-existing user changes in a task commit.
