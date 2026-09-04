import { customFrom, useReview } from '@/client/store/review.js';
import {
  Button,
  Notice,
  Select,
  type SelectOption,
  UnderlineNav,
} from '@/client/ui/index.js';
import type {
  BranchesResponse,
  Comparison,
  Endpoint,
  ScopePreset,
  Session,
} from '@/shared/protocol.js';

type Side = keyof Comparison;

const short = (sha: string): string => sha.slice(0, 7);

const encode = (ep: Endpoint): string => {
  switch (ep.kind) {
    case 'head':
    case 'index':
    case 'worktree':
      return ep.kind;
    case 'pin':
      return `pin:${ep.name}`;
    case 'ref':
      return `ref:${ep.name}`;
    case 'commit':
      return `commit:${ep.oid}`;
    case 'merge-base':
      return `merge-base:${ep.left}:${ep.right}`;
  }
};

const decode = (v: string): Endpoint | null => {
  if (v === 'head' || v === 'index' || v === 'worktree') return { kind: v };
  if (v === 'pin:opened' || v === 'pin:approved')
    return { kind: 'pin', name: v === 'pin:opened' ? 'opened' : 'approved' };
  if (v.startsWith('ref:')) return { kind: 'ref', name: v.slice(4) };
  return null;
};

const pickerOptions = (
  session: Session | null,
  branches: BranchesResponse | null
): SelectOption[] => {
  const live = session && !session.endedAt ? session : null;
  const pins: SelectOption[] = [];
  if (live?.openedAt)
    pins.push({
      value: 'pin:opened',
      label: `Session start ${short(live.openedAt.head)}`,
      group: 'Session',
    });
  if (live?.approvedAt)
    pins.push({
      value: 'pin:approved',
      label: `Last approval ${short(live.approvedAt.head)}`,
      group: 'Session',
    });
  return [
    ...pins,
    { value: 'head', label: 'HEAD', group: 'Checkout' },
    { value: 'index', label: 'Index', group: 'Checkout' },
    { value: 'worktree', label: 'Workspace', group: 'Checkout' },
    ...(branches?.local ?? []).map((b) => ({
      value: `ref:${b}`,
      label: b,
      group: 'Local branches',
    })),
    ...(branches?.remote ?? []).map((b) => ({
      value: `ref:${b}`,
      label: b,
      group: 'Remote branches',
    })),
  ];
};

const PRESETS: { value: ScopePreset; label: string; title: string }[] = [
  {
    value: 'session',
    label: 'Session',
    title: 'Since the session pin to the workspace',
  },
  { value: 'working', label: 'Working', title: 'HEAD to the workspace' },
  {
    value: 'branch',
    label: 'Branch',
    title: 'Merge base with the base branch to the workspace',
  },
  { value: 'custom', label: 'Custom', title: 'Pick baseline and endpoint' },
];

export function ScopeSwitcher() {
  const preset = useReview((s) => s.preset);
  const setPreset = useReview((s) => s.setPreset);
  const session = useReview((s) => s.session);
  const branches = useReview((s) => s.branches);
  const comparison = useReview((s) => s.state?.comparison ?? null);
  const refs = useReview((s) => s.state?.refs ?? null);

  const cur = session?.custom ?? customFrom(preset, session, refs);
  const options = pickerOptions(session, branches);
  const optionsFor = (side: Side): SelectOption[] => {
    const val = encode(cur[side]);
    if (options.some((o) => o.value === val)) return options;
    const label = comparison?.[side].label ?? val;
    return [{ value: val, label }, ...options];
  };
  const pick = (side: Side, v: string) => {
    const ep = decode(v);
    if (!ep) return;
    void setPreset('custom', { ...cur, [side]: ep });
  };

  return (
    <div className="pr-scope-row">
      <UnderlineNav<ScopePreset>
        label="Comparison scope"
        value={preset}
        onChange={(p) => void setPreset(p)}
        items={PRESETS}
      />
      {preset === 'custom' && (
        <span className="pr-scope-pickers">
          <Select
            prefix="baseline:"
            value={encode(cur.baseline)}
            options={optionsFor('baseline')}
            onChange={(v) => pick('baseline', v)}
            title="Baseline tree"
            aria-label="Baseline"
          />
          <span className="ui-muted">to</span>
          <Select
            prefix="endpoint:"
            value={encode(cur.endpoint)}
            options={optionsFor('endpoint')}
            onChange={(v) => pick('endpoint', v)}
            title="Endpoint tree"
            aria-label="Endpoint"
          />
        </span>
      )}
    </div>
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
            <span>Branch equals Working on the default branch.</span>
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
