import { identicon } from '@/client/lib/identicon.js';
import { USER_ACTOR } from '@/shared/protocol.js';

const SIZE = 20;
const GRID = 5;
const CELL = SIZE / GRID;

export function Avatar({ author }: { author: string }) {
  const isUser = author === USER_ACTOR;
  const { hue, cells } = identicon(author);
  const bg = `oklch(0.32 0.09 ${hue})`;
  const fg = `oklch(0.86 0.13 ${hue})`;
  return (
    <span
      className={`avatar${isUser ? ' avatar-user' : ' avatar-agent'}`}
      title={isUser ? 'You' : `Agent: ${author}`}
      aria-hidden="true"
    >
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} width={SIZE} height={SIZE}>
        <rect width={SIZE} height={SIZE} rx={isUser ? SIZE / 2 : 5} fill={bg} />
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
      </svg>
    </span>
  );
}
