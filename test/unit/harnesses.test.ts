import { expect, it } from 'vitest';
import { AGENT_LOGIN, contributorActor } from '@/shared/harnesses.js';

it('maps model co-author addresses to the same harness avatar as answers', () => {
  expect(AGENT_LOGIN[contributorActor('noreply@anthropic.com')!]).toBe(
    'claude'
  );
  expect(contributorActor(' NOREPLY@ANTHROPIC.COM ')).toBe('claude-code');
  expect(contributorActor('noreply@openai.com')).toBe('codex');
  expect(contributorActor('claude@example.com')).toBeNull();
});

it('renders the GitHub image for a Claude commit before identity fetching finishes', async () => {
  const { createElement } = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { PersonAvatar } = await import('@/client/components/people.js');
  const markup = renderToStaticMarkup(
    createElement(PersonAvatar, {
      person: {
        name: 'Claude Opus 5',
        email: 'noreply@anthropic.com',
        login: null,
        avatarUrl: null,
        bot: true,
        role: 'co-author',
      },
    })
  );
  expect(markup).toContain('https://github.com/claude.png?s=40');
  expect(markup).not.toContain('<svg');
});
