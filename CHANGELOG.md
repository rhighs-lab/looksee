# @rhighs-lab/looksee

## 0.3.0

### Minor Changes

- a33e952: Faster file search with multi-term fuzzy matching and basename ranking, the finder covers the whole repository tree and jumps in page, and the file list follows the diff you are reading.
- febc385: Set comment and markdown prose in a reading serif and let the prose and code fonts be picked in settings.

### Patch Changes

- 662de1d: Syntax highlight fenced code in comment bodies and tell agents that comments are GitHub-flavored markdown.
- 5f44884: Load each file-info item on its own request and show a skeleton per item instead of holding the whole tooltip for the slowest fetch.
- fa798bb: Document the polling workflow for Codex and other turn-based harnesses: a background `looksee listen` cannot wake an idle agent, so the rule and skill use a bounded foreground wait.
- 4c7580b: Rename the "Local commits" layer to "Unpushed commits" and explain in each layer tab's tooltip which range it covers.

## 0.2.0

### Minor Changes

- d2896b7: Keep resolved threads readable, fit toolbars into narrow viewports, and give
  turn-based agents a listener they can actually poll. Resolved threads now
  expand from the review, so a reply left just before a resolve stays visible.
  File headers keep one line with extra actions in an overflow menu, while comment actions wrap instead of overlapping. `looksee listen
  --wait <seconds>` returns after the first event or the timeout, and the
  installed guidance no longer promises that a background listener wakes an idle
  agent.
- d2896b7: Add Tree-sitter symbol navigation and sticky enclosing declarations to file view. Symbols follow the selected file revision and support JavaScript, TypeScript, Python, Go, Rust, Java, C#, C/C++, Ruby, PHP, and Bash.

### Patch Changes

- d2896b7: Add a file sidebar toggle to answer mode and load avatars for answer authors,
  including harnesses that have not posted comments. Preserve known harness avatar
  URLs when GitHub identity lookup fails.
