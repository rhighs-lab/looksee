import { useEffect, useState } from 'react';
import { identicon } from '@/client/lib/identicon.js';
import { useIdentities, useIdentity } from '@/client/store/identities.js';
import { AGENT_LOGIN } from '@/shared/harnesses.js';
import { USER_ACTOR } from '@/shared/protocol.js';

const SIZE = 20;
const GRID = 5;
const CELL = SIZE / GRID;

function Robot({ bg, fg }: { bg: string; fg: string }) {
  return (
    <>
      <circle cx={SIZE / 2} cy={SIZE / 2} r={SIZE / 2} fill={bg} />
      <g fill={fg}>
        <circle cx={10} cy={3.4} r={1} />
        <rect x={9.55} y={3.8} width={0.9} height={1.9} />
        <rect x={2.9} y={8.6} width={1.4} height={3.2} rx={0.7} />
        <rect x={15.7} y={8.6} width={1.4} height={3.2} rx={0.7} />
        <rect x={4.5} y={5.6} width={11} height={9.6} rx={2.6} />
      </g>
      <g fill={bg}>
        <circle cx={7.7} cy={9.3} r={1.4} />
        <circle cx={12.3} cy={9.3} r={1.4} />
        <rect x={7.6} y={12} width={4.8} height={1.3} rx={0.65} />
      </g>
    </>
  );
}

export function Avatar({
  author,
  agent,
}: {
  author: string;
  /** Defaults to "anyone who is not the browser user". Pass false for a git
   *  identity, where the name says nothing about who typed the commit. */
  agent?: boolean;
}) {
  const load = useIdentities((s) => s.load);
  const who = useIdentity(author);
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    void load(author);
  }, [author, load]);

  const isUser = !(agent ?? author !== USER_ACTOR);
  const label = who?.name ?? author;
  const avatarUrl =
    who?.avatarUrl ??
    (AGENT_LOGIN[author]
      ? `https://github.com/${AGENT_LOGIN[author]}.png`
      : null);
  // Reviews run offline as often as not; a github.com avatar that cannot load
  // must fall through to the identicon rather than leave a broken image.
  if (avatarUrl && failed !== avatarUrl)
    return (
      <img
        className={`avatar${isUser ? ' avatar-user' : ' avatar-agent'}`}
        src={`${avatarUrl}${avatarUrl.includes('?') ? '&' : '?'}s=40`}
        alt=""
        width={SIZE}
        height={SIZE}
        title={isUser ? label : `Agent: ${label}`}
        loading="lazy"
        onError={() => setFailed(avatarUrl)}
      />
    );

  const { hue, cells } = identicon(author);
  const bg = isUser ? `oklch(0.32 0.09 ${hue})` : `oklch(0.62 0.19 ${hue})`;
  const fg = isUser ? `oklch(0.86 0.13 ${hue})` : `oklch(0.97 0.03 ${hue})`;
  return (
    <span
      className={`avatar${isUser ? ' avatar-user' : ' avatar-agent'}`}
      title={isUser ? label : `Agent: ${label}`}
      aria-hidden="true"
    >
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} width={SIZE} height={SIZE}>
        {isUser ? (
          <>
            <rect width={SIZE} height={SIZE} rx={SIZE / 2} fill={bg} />
            {cells.map((on, i) =>
              on ? (
                <rect
                  // biome-ignore lint/suspicious/noArrayIndexKey: the grid is fixed-length and positional
                  key={i}
                  x={(i % GRID) * CELL}
                  y={Math.floor(i / GRID) * CELL}
                  width={CELL}
                  height={CELL}
                  fill={fg}
                />
              ) : null
            )}
          </>
        ) : (
          <Robot bg={bg} fg={fg} />
        )}
      </svg>
    </span>
  );
}
