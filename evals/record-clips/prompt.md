---
description: "The record path when the rehearsal cannot run: the skill rehearses first, stops at the failing step, edits nothing, invents no outputs, and says what blocked it."
tags: [smoke, record-clips]
runs: 1
max_turns: 30
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill, Bash]
expected_outcome: The skill runs dry-run before anything else; the rehearsal cannot reach the page inside the eval sandbox, so the skill stops there, never edits the clip file, writes no output files, and the reply names the failing step and the blocker instead of claiming the clip was produced. (The successful record path is exercised by evals/e2e.sh outside the sandbox.)
---
In the ui-clips clip project at ./clips-project, record and export the clip todo-tick (it is already authored). Verify the outputs and list the files you produced. Do not ask me anything.
