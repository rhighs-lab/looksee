import { Person, Sparkle } from '@/client/components/icons.js';
import { USER_ACTOR } from '@/shared/protocol.js';

const AGENT_HUES = [212, 265, 152, 28, 340, 190, 84, 310];

const hueOf = (name: string): number => {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AGENT_HUES[h % AGENT_HUES.length]!;
};

export function Avatar({ author }: { author: string }) {
  const isUser = author === USER_ACTOR;
  const hue = isUser ? null : hueOf(author);
  return (
    <span
      className={`avatar${isUser ? ' avatar-user' : ' avatar-agent'}`}
      title={isUser ? 'You' : `Agent: ${author}`}
      aria-hidden="true"
      style={
        hue === null
          ? undefined
          : {
              backgroundColor: `oklch(0.55 0.16 ${hue})`,
            }
      }
    >
      {isUser ? (
        <Person width={12} height={12} />
      ) : (
        <Sparkle width={12} height={12} />
      )}
    </span>
  );
}
