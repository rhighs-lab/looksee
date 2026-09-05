import type { RunCtx } from '@/cli/commands.js';
import { connect } from '@/cli/connect.js';
import { format } from '@/cli/output.js';
import type {
  Pin,
  RepoState,
  ScopePreset,
  Session,
} from '@/shared/protocol.js';

export const CLI_PRESETS: ScopePreset[] = ['session', 'working', 'branch'];

export const pinShort = (pin: Pin | null | undefined): string | null =>
  pin ? pin.head.slice(0, 7) : null;

export const liveSession = (s: Session | null): Session | null =>
  s && !s.endedAt ? s : null;

export const runPin = async ({ flags, io }: RunCtx): Promise<number> => {
  const { http } = await connect(flags, io.env);
  const state = await http.post<RepoState>('/api/session/pin');
  const s = await http.get<Session | null>('/api/session');
  io.out(
    format(
      {
        openedAt: pinShort(s?.openedAt),
        approvedAt: pinShort(s?.approvedAt),
        label: state.comparison?.label ?? null,
      },
      false
    )
  );
  return 0;
};

export const runSessionEnd = async ({ flags, io }: RunCtx): Promise<number> => {
  const { http } = await connect(flags, io.env);
  const cur = liveSession(await http.get<Session | null>('/api/session'));
  if (cur) await http.post<RepoState>('/api/session/end');
  io.out(format({ ended: cur !== null }, false));
  return 0;
};

const isCliPreset = (v: string): v is ScopePreset =>
  (CLI_PRESETS as string[]).includes(v);

export const assertCliPreset = (v: string): ScopePreset => {
  if (v === 'custom') throw new Error('custom is set from the browser pickers');
  if (!isCliPreset(v))
    throw new Error(`scope must be one of ${CLI_PRESETS.join('|')}`);
  return v;
};

export const runScope = async ({
  positionals,
  flags,
  io,
}: RunCtx): Promise<number> => {
  const preset = positionals[0];
  if (preset !== undefined) assertCliPreset(preset);
  const { http } = await connect(flags, io.env);
  const state = preset
    ? await http.post<RepoState>('/api/scope', { preset })
    : await http.get<RepoState>('/api/state');
  io.out(format(state.comparison, flags['pretty'] === true));
  return 0;
};
