---
description: "Scenario to clip file: inspect first, write the clip with expectations, rehearse, framing sheet, no recording."
tags: [smoke, author-clip]
runs: 1
max_turns: 60
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Write, Edit, Bash]
expected_outcome: clips-project/clips/todo-tick.clip.mjs written from the inspection, every action with an expect, a clean dry run and a framing sheet; nothing recorded.
---
In the ui-clips clip project at ./clips-project (already set up; the site it points at is in ./site), author a clip with the id todo-tick for this moment: the Today list → tick the first task, "Review the onboarding flow" → its label strikes through → hold → untick it → back to the start, so the clip loops. Natural length, return loop, keep the project's zoom default. Do not ask me anything. Rehearse it and give me the framing sheet; do not record yet.
