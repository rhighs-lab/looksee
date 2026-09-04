import { parsePatch } from '@/server/git/diff-parser.js';
import type { ChangedFile, FileDiff, RepoState } from '@/shared/protocol.js';
import { LAYERS } from '@/shared/protocol.js';

const PATCH = `diff --git a/src/pricing/calculator.ts b/src/pricing/calculator.ts
--- a/src/pricing/calculator.ts
+++ b/src/pricing/calculator.ts
@@ -12,7 +12,11 @@ export class PriceCalculator {
   calculate(order: Order): Money {
     const subtotal = this.subtotal(order);
-    const tax = subtotal * 0.1;
-    return subtotal + tax;
+    const rate = this.rateFor(order.region);
+    const tax = subtotal * rate;
+    const rounded = this.round(subtotal + tax);
+    return rounded;
   }

   private subtotal(order: Order): number {
diff --git a/src/pricing/regions.ts b/src/pricing/regions.ts
new file mode 100644
--- /dev/null
+++ b/src/pricing/regions.ts
@@ -0,0 +1,5 @@
+export const REGION_RATES: Record<string, number> = {
+  US: 0.0725,
+  EU: 0.20,
+  CA: 0.13,
+};
diff --git a/docs/PRICING.md b/docs/pricing.md
similarity index 66%
rename from docs/PRICING.md
rename to docs/pricing.md
--- a/docs/PRICING.md
+++ b/docs/pricing.md
@@ -1,3 +1,3 @@
-# Pricing (legacy)
+# Pricing

 How prices are computed.
diff --git a/assets/logo.png b/assets/logo.png
Binary files a/assets/logo.png and b/assets/logo.png differ
`;

const LAYER_OF = ['pushed', 'local', 'staged', 'unstaged'] as const;

export function sampleDiffs(): FileDiff[] {
  return parsePatch(PATCH).map((f) => ({
    ...f,
    newLineCount: null,
    rev: 'WORKTREE',
    oldRev: 'HEAD',
    truncated: false,
  }));
}

export function sampleState(): RepoState {
  const files: ChangedFile[] = sampleDiffs().map((f, i) => ({
    path: f.path,
    oldPath: f.oldPath,
    kind: f.kind,
    layers: [
      {
        layer: LAYER_OF[i % LAYER_OF.length]!,
        kind: f.kind,
        oldPath: f.oldPath,
      },
    ],
    binary: f.binary,
    additions: f.additions,
    deletions: f.deletions,
    digest: f.digest,
    generated: false,
    large: false,
  }));
  const byLayer = Object.fromEntries(
    LAYERS.map((l) => [l, 0])
  ) as RepoState['summary']['byLayer'];
  for (const f of files) for (const l of f.layers) byLayer[l.layer]++;
  return {
    version: 1,
    repoRoot: null,
    title: null,
    refs: {
      head: {
        branch: 'feature/pricing-rules',
        sha: 'sample',
        detached: false,
        checkedOut: true,
      },
      base: { ref: 'main', sha: 'sample', source: 'main' },
      mergeBase: null,
      upstream: null,
      remoteBase: null,
      pushedBase: null,
      remotes: [],
      remoteUrl: null,
      lastFetchAt: null,
    },
    comparison: {
      preset: 'branch',
      baseline: {
        kind: 'merge-base',
        oid: 'sample',
        short: 'sample',
        label: 'main sample (merge base)',
      },
      endpoint: {
        kind: 'worktree',
        oid: 'sample',
        short: 'sample',
        label: 'workspace',
      },
      label: 'main sample (merge base) to workspace',
      note: null,
    },
    drift: false,
    files,
    summary: {
      files: files.length,
      additions: files.reduce((n, f) => n + f.additions, 0),
      deletions: files.reduce((n, f) => n + f.deletions, 0),
      byLayer,
    },
    computedAt: new Date().toISOString(),
    error: null,
  };
}
