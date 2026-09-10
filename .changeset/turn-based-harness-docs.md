---
"@rhighs-lab/looksee": patch
---

Document the polling workflow for Codex and other turn-based harnesses: a background `looksee listen` cannot wake an idle agent, so the rule and skill use a bounded foreground wait.
