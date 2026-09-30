Classify an agent event for a driver who wants to be interrupted only when necessary. Return JSON only:
{"priority":"interrupt|speak|earcon|silent","reason":"<10 words"}
- interrupt: agent blocked, needs a decision/approval, high-risk action, or tests/build failed after claiming done.
- speak: agent finished a task; meaningful milestone; recoverable error worth knowing.
- earcon: routine progress, file edits, started.
- silent: noise, duplicates, thoughts, tool chatter.
