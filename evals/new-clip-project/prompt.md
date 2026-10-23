---
description: "The interview path, scaffold and doctor, with answers given in the prompt so no question is needed."
tags: [smoke, new-clip-project]
runs: 1
max_turns: 40
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill, Write, Edit, Bash]
expected_outcome: A clips-project folder with an annotated clips.config.mjs (full frame + 4:5 card, served from ./site), an empty clips/, a CLAUDE.md, and a doctor report that is all green.
---
Use the ui-clips plugin to create a clip project in ./clips-project for the static site in ./site (it has an index.html; serve it locally rather than giving a URL). I do not want to be asked anything: take the defaults, which are the desktop 1440×900 layout, full frame plus the 4:5 portfolio card, MP4 + WebM + poster, gentle auto-zoom, light theme, arrow cursor. Run the doctor check afterwards and tell me what it found and what the next step is.
