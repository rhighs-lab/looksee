/** GitHub accounts used for known harness identities across review surfaces. */
export const AGENT_LOGIN: Record<string, string> = {
  'claude-code': 'claude',
  codex: 'openai',
  opencode: 'sst',
  cursor: 'cursor',
  aider: 'Aider-AI',
  'gemini-cli': 'google-gemini',
};

/** Git co-author display names vary by model; their known address is stable. */
export function contributorActor(email: string): string | null {
  switch (email.trim().toLowerCase()) {
    case 'noreply@anthropic.com':
    case 'no-reply@anthropic.com':
      return 'claude-code';
    case 'noreply@openai.com':
    case 'no-reply@openai.com':
      return 'codex';
    default:
      return null;
  }
}
