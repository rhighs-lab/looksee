import { describe, expect, it } from 'vitest';
import { resolveActor } from '@/cli/actor.js';
import { detectAgent } from '@/cli/agent-id.js';

describe('detectAgent', () => {
  it('names the agent that spawned us', () => {
    expect(detectAgent({ CLAUDE_CODE_ENTRYPOINT: 'cli' })?.actor).toBe(
      'claude-code'
    );
    expect(detectAgent({ CODEX_HOME: '/x' })?.actor).toBe('codex');
    expect(detectAgent({ OPENCODE: '1' })?.actor).toBe('opencode');
    expect(detectAgent({ PI_SESSION_ID: 'x' })?.actor).toBe('pi');
  });

  it('says nothing when no agent is in the environment', () => {
    expect(detectAgent({ HOME: '/x' })).toBeNull();
  });
});

describe('resolveActor', () => {
  it('prefers an explicit flag, then the env, then the detected agent', () => {
    const env = { CLAUDE_CODE_ENTRYPOINT: 'cli' };
    expect(resolveActor({ as: 'bot' }, env)).toBe('bot');
    expect(resolveActor({}, { ...env, LOOKSEE_ACTOR: 'named' })).toBe('named');
    expect(resolveActor({}, env)).toBe('claude-code');
    expect(resolveActor({}, {})).toBe('agent');
  });
});
