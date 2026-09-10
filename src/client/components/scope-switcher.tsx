import { useState } from 'react';
import { useReview } from '@/client/store/review.js';
import { Select, type SelectOption } from '@/client/ui/index.js';
import type {
  BranchesResponse,
  Comparison,
  ComparisonNote,
  Endpoint,
  RepoRefs,
  ScopePreset,
  Session,
} from '@/shared/protocol.js';

const short = (sha: string): string => sha.slice(0, 7);

const baseOf = (
  preset: ScopePreset,
  live: Session | null,
  note: ComparisonNote,
  custom: Comparison | null
): string => {
  if (preset === 'session')
    return live?.approvedAt ? 'pin:approved' : 'pin:opened';
  if (preset === 'working') return 'working';
  if (preset === 'branch')
    return note === 'same-as-working' ? 'working' : 'branch';
  const b = custom?.baseline;
  if (b?.kind === 'pin') return `pin:${b.name}`;
  if (b?.kind === 'merge-base') return `ref:${b.left}`;
  if (b?.kind === 'ref') return `ref:${b.name}`;
  if (b?.kind === 'head') return 'working';
  return 'custom';
};

const targetOf = (preset: ScopePreset, custom: Comparison | null): string => {
  if (preset !== 'custom' || !custom) return 'worktree';
  const e = custom.endpoint;
  if (e.kind === 'ref') return `ref:${e.name}`;
  if (e.kind === 'commit') return `commit:${e.oid}`;
  return e.kind;
};

const baseOptions = (
  live: Session | null,
  refs: RepoRefs | null,
  branches: BranchesResponse | null
): SelectOption[] => {
  const opts: SelectOption[] = [];
  if (live?.approvedAt)
    opts.push({
      value: 'pin:approved',
      label: `Last approval ${short(live.approvedAt.head)}`,
      group: 'Session',
    });
  if (live?.openedAt)
    opts.push({
      value: 'pin:opened',
      label: `Session start ${short(live.openedAt.head)}`,
      group: 'Session',
    });
  opts.push({ value: 'working', label: 'Last commit (HEAD)', group: 'Local' });
  if (refs?.mergeBase && refs.mergeBase !== refs.head.sha)
    opts.push({
      value: 'branch',
      label: `Branch base (${refs.base.ref})`,
      group: 'Local',
    });
  const names = [...(branches?.local ?? []), ...(branches?.remote ?? [])];
  for (const b of names) {
    if (b === branches?.current) continue;
    opts.push({ value: `ref:${b}`, label: b, group: 'Branches' });
  }
  return opts;
};

const targetOptions = (branches: BranchesResponse | null): SelectOption[] => {
  const opts: SelectOption[] = [
    { value: 'worktree', label: 'Working tree', group: 'Local' },
    { value: 'index', label: 'Staged (index)', group: 'Local' },
    { value: 'head', label: 'Last commit (HEAD)', group: 'Local' },
  ];
  const names = [...(branches?.local ?? []), ...(branches?.remote ?? [])];
  for (const b of names) {
    if (b === branches?.current) continue;
    opts.push({ value: `ref:${b}`, label: b, group: 'Branches' });
  }
  return opts;
};

const targetEndpoint = (v: string): Endpoint => {
  if (v.startsWith('ref:')) return { kind: 'ref', name: v.slice(4) };
  if (v.startsWith('commit:')) return { kind: 'commit', oid: v.slice(7) };
  if (v === 'index' || v === 'head') return { kind: v };
  return { kind: 'worktree' };
};

const baseEndpoint = (
  v: string,
  target: string,
  refs: RepoRefs | null
): Endpoint => {
  const right = target.startsWith('ref:') ? target.slice(4) : 'HEAD';
  if (v === 'pin:approved') return { kind: 'pin', name: 'approved' };
  if (v === 'pin:opened') return { kind: 'pin', name: 'opened' };
  if (v === 'branch' && refs?.base.ref)
    return { kind: 'merge-base', left: refs.base.ref, right };
  if (v.startsWith('ref:'))
    return { kind: 'merge-base', left: v.slice(4), right };
  return { kind: 'head' };
};

export function ScopeSwitcher() {
  const preset = useReview((s) => s.preset);
  const switching = useReview((s) => s.switching);
  const setPreset = useReview((s) => s.setPreset);
  const session = useReview((s) => s.session);
  const branches = useReview((s) => s.branches);
  const refs = useReview((s) => s.state?.refs ?? null);
  const note = useReview((s) => s.state?.comparison?.note ?? null);
  const label = useReview((s) => s.state?.comparison?.label ?? '');
  const [picked, setPicked] = useState<{ base: string; target: string } | null>(
    null
  );

  const live = session && !session.endedAt ? session : null;
  const custom = session?.custom ?? null;
  const derived = {
    base: baseOf(preset, live, note, custom),
    target: targetOf(preset, custom),
  };
  const cur = switching && picked ? picked : derived;
  const bases = baseOptions(live, refs, branches);
  const targets = targetOptions(branches);
  if (!bases.some((o) => o.value === cur.base))
    bases.unshift({ value: cur.base, label: label.split(' to ')[0] ?? '' });
  if (!targets.some((o) => o.value === cur.target))
    targets.unshift({ value: cur.target, label: label.split(' to ')[1] ?? '' });
  const baseLabel = bases.find((o) => o.value === cur.base)?.label ?? '';
  const targetLabel = targets.find((o) => o.value === cur.target)?.label ?? '';

  const pick = (base: string, target: string) => {
    setPicked({ base, target });
    if (target === 'worktree') {
      if (base === 'pin:approved') return void setPreset('session');
      if (base === 'pin:opened' && !live?.approvedAt)
        return void setPreset('session');
      if (base === 'working' || base === 'branch') return void setPreset(base);
    }
    void setPreset('custom', {
      baseline: baseEndpoint(base, target, refs),
      endpoint: targetEndpoint(target),
    });
  };

  return (
    <span
      className="scope-pickers"
      role="group"
      aria-label="Comparison"
      title={`Comparing ${targetLabel} against ${baseLabel}`}
    >
      <Select
        prefix="base:"
        value={cur.base}
        options={bases}
        onChange={(v) => pick(v, cur.target)}
        title={`What the changes are measured from: ${baseLabel}`}
        aria-label="Comparison base"
      />
      <Select
        prefix="compare:"
        value={cur.target}
        options={targets}
        onChange={(v) => pick(cur.base, v)}
        title={`The tree under review: ${targetLabel}`}
        aria-label="Comparison target"
      />
    </span>
  );
}
