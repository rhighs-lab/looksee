import { Avatar } from '@/client/components/comments/avatar.js';
import { useIdentities } from '@/client/store/identities.js';
import type { CommitContributor } from '@/shared/protocol.js';

const AGENT_LABEL: Record<string, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  opencode: 'opencode',
  pi: 'Pi',
  cursor: 'Cursor',
  aider: 'Aider',
  'gemini-cli': 'Gemini CLI',
  agent: 'agent',
};

/** The name to print for an actor, live: re-renders once identities land. */
export function AuthorName({ actor }: { actor: string }) {
  const name = useIdentities((s) => s.byActor[actor]?.name);
  return <>{name ?? AGENT_LABEL[actor] ?? actor}</>;
}

export function PersonAvatar({ person }: { person: CommitContributor }) {
  if (person.avatarUrl)
    return (
      <img
        className="avatar"
        src={`${person.avatarUrl}${person.avatarUrl.includes('?') ? '&' : '?'}s=40`}
        alt=""
        width={20}
        height={20}
        loading="lazy"
      />
    );
  return <Avatar author={person.name || 'user'} agent={person.bot} />;
}

/** "rhighs and claude", the way GitHub names a commit's people. */
export function People({ people }: { people: CommitContributor[] }) {
  const names = people.map((p) => p.login ?? p.name);
  const joined =
    names.length <= 1
      ? (names[0] ?? 'unknown')
      : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
  return (
    <span className="people">
      <span className="people-faces">
        {people.map((p) => (
          <PersonAvatar key={p.email || p.name} person={p} />
        ))}
      </span>
      <span className="people-names">{joined}</span>
    </span>
  );
}
