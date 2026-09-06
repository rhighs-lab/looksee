export interface AgentId {
  actor: string;
  label: string;
}

/**
 * Which coding agent is running us. Each entry is keyed on a variable that
 * agent sets in the environment it hands to a subprocess, so detection costs
 * nothing and needs no process-tree walk.
 */
const MARKERS: Array<{ env: string[]; actor: string; label: string }> = [
  {
    env: ['CLAUDE_CODE_ENTRYPOINT', 'CLAUDECODE', 'CLAUDE_CODE_EXECPATH'],
    actor: 'claude-code',
    label: 'Claude Code',
  },
  {
    env: ['CODEX_SANDBOX', 'CODEX_HOME', 'CODEX_THREAD_ID'],
    actor: 'codex',
    label: 'Codex',
  },
  {
    env: ['OPENCODE', 'OPENCODE_BIN_PATH'],
    actor: 'opencode',
    label: 'opencode',
  },
  { env: ['PI_SESSION_ID', 'PI_AGENT'], actor: 'pi', label: 'Pi' },
  { env: ['CURSOR_TRACE_ID'], actor: 'cursor', label: 'Cursor' },
  { env: ['AIDER_MODEL'], actor: 'aider', label: 'Aider' },
  { env: ['GEMINI_CLI'], actor: 'gemini-cli', label: 'Gemini CLI' },
];

export function detectAgent(env: NodeJS.ProcessEnv): AgentId | null {
  for (const m of MARKERS)
    if (m.env.some((k) => env[k])) return { actor: m.actor, label: m.label };
  return null;
}
