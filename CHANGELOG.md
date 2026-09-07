# @rhighs-lab/looksee

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
