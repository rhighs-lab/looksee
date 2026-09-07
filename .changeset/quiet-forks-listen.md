---
"@rhighs-lab/looksee": minor
---

Keep resolved threads readable, fit toolbars into narrow viewports, and give
turn-based agents a listener they can actually poll. Resolved threads now
expand from the review, so a reply left just before a resolve stays visible.
File headers keep one line with extra actions in an overflow menu, while comment actions wrap instead of overlapping. `looksee listen
--wait <seconds>` returns after the first event or the timeout, and the
installed guidance no longer promises that a background listener wakes an idle
agent.
