import { useState } from 'react';
import { useReview } from '@/client/store/review.js';
import {
  Button,
  Notice,
  Select,
  type SelectOption,
} from '@/client/ui/index.js';
import type {
  BranchesResponse,
  Comparison,
  ComparisonNote,
  RepoRefs,
  ScopePreset,
  Session,
} from '@/shared/protocol.js';

const WORKTREE: Comparison['endpoint'] = { kind: 'worktree' };

const short = (sha: string): string => sha.slice(0, 7);

const selected = (
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
  return 'custom';
};

const optionsOf = (
  live: Session | null,
  refs: RepoRefs | null,
  branches: BranchesResponse | null
): SelectOption[] => {
  const opts: SelectOption[] = [];
  if (live?.approvedAt)
    opts.push({
      value: 'pin:approved',
      label: `Since last approval ${short(live.approvedAt.head)}`,
      group: 'Session',
    });
  if (live?.openedAt)
    opts.push({
      value: 'pin:opened',
      label: `Since session start ${short(live.openedAt.head)}`,
      group: 'Session',
    });
  opts.push({ value: 'working', label: 'Since last commit', group: 'Local' });
  if (refs?.mergeBase && refs.mergeBase !== refs.head.sha)
    opts.push({
      value: 'branch',
      label: `Since branch base (${refs.base.ref})`,
      group: 'Local',
    });
  const names = [...(branches?.local ?? []), ...(branches?.remote ?? [])];
  for (const b of names) {
    if (b === branches?.current) continue;
    opts.push({ value: `ref:${b}`, label: `Since ${b}`, group: 'Branches' });
  }
  return opts;
};

export function ScopeSwitcher() {
  const preset = useReview((s) => s.preset);
  const status = useReview((s) => s.status);
  const setPreset = useReview((s) => s.setPreset);
  const session = useReview((s) => s.session);
  const branches = useReview((s) => s.branches);
  const refs = useReview((s) => s.state?.refs ?? null);
  const note = useReview((s) => s.state?.comparison?.note ?? null);
  const label = useReview((s) => s.state?.comparison?.baseline.label ?? '');
  const [picked, setPicked] = useState<string | null>(null);

  const live = session && !session.endedAt ? session : null;
  const derived = selected(preset, live, note, session?.custom ?? null);
  const value = status === 'loading' && picked ? picked : derived;
  const options = optionsOf(live, refs, branches);
  if (!options.some((o) => o.value === value))
    options.unshift({ value, label: `Since ${label}` });

  const pick = (v: string) => {
    setPicked(v);
    if (v === 'pin:approved') return void setPreset('session');
    if (v === 'pin:opened')
      return void (live?.approvedAt
        ? setPreset('custom', {
            baseline: { kind: 'pin', name: 'opened' },
            endpoint: WORKTREE,
          })
        : setPreset('session'));
    if (v === 'working' || v === 'branch') return void setPreset(v);
    if (v.startsWith('ref:'))
      void setPreset('custom', {
        baseline: { kind: 'merge-base', left: v.slice(4), right: 'HEAD' },
        endpoint: WORKTREE,
      });
  };

  return (
    <Select
      prefix="compare:"
      value={value}
      options={options}
      onChange={pick}
      title="Baseline the workspace is compared against"
      aria-label="Comparison baseline"
    />
  );
}

export function ScopeNotices() {
  const drift = useReview((s) => s.state?.drift ?? false);
  const note = useReview((s) => s.state?.comparison?.note ?? null);
  const repin = useReview((s) => s.repin);
  if (!drift && !note) return null;
  return (
    <>
      {drift && (
        <div className="review-banner">
          <Notice tone="attention">
            <span>
              Baseline predates this branch: the pin is not an ancestor of HEAD.
            </span>
            <Button small onClick={() => void repin()}>
              Re-pin
            </Button>
          </Notice>
        </div>
      )}
      {note === 'same-as-working' && (
        <div className="review-banner">
          <Notice tone="muted">
            <span>
              Branch base equals the last commit on the default branch.
            </span>
          </Notice>
        </div>
      )}
      {note === 'index-unmerged' && (
        <div className="review-banner">
          <Notice tone="attention">
            <span>Index is unmerged: showing the workspace instead.</span>
          </Notice>
        </div>
      )}
    </>
  );
}
