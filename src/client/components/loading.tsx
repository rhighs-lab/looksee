const L_BRACE =
  'M 101 70 C 84 70 84 84 84 105 C 84 118 63 128 63 128 C 63 128 84 138 84 151 C 84 172 84 185 101 185';
const R_BRACE =
  'M 155 70 C 172 70 172 84 172 105 C 172 118 193 128 193 128 C 193 128 172 138 172 151 C 172 172 172 185 155 185';

export function Logo({
  size = 24,
  className,
  spinning = false,
}: {
  size?: number;
  className?: string;
  spinning?: boolean;
}) {
  return (
    <svg
      className={`logo-mark${spinning ? ' is-spinning' : ''}${className ? ` ${className}` : ''}`}
      width={size}
      height={size}
      viewBox="0 0 256 256"
      role="img"
      aria-label="looksee"
    >
      <g transform="translate(128 128) scale(1.329) translate(-128 -128)">
        <path
          className="logo-brace logo-brace-l"
          d={L_BRACE}
          fill="none"
          stroke="#fd5f4e"
          strokeWidth="22"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          className="logo-brace logo-brace-r"
          d={R_BRACE}
          fill="none"
          stroke="#4acd78"
          strokeWidth="22"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M 88.75 128 L 167.25 128"
          fill="none"
          stroke="#0046fc"
          strokeWidth="7.1"
          strokeLinecap="round"
        />
        <circle
          className="logo-dot"
          cx="128"
          cy="128"
          r="17.4"
          fill="#0046fc"
        />
      </g>
    </svg>
  );
}

export function Loading({
  label,
  size = 40,
}: {
  label: string;
  size?: number;
}) {
  return (
    <div className="loading" role="status" aria-live="polite">
      <Logo size={size} spinning />
      <span className="loading-label">{label}</span>
    </div>
  );
}

export function SkeletonLines({ rows = 8 }: { rows?: number }) {
  const widths = [92, 64, 78, 45, 88, 57, 72, 38, 84, 61, 70, 50];
  return (
    <div className="skeleton" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={`${i}:${widths[i % widths.length]}`}
          className="skeleton-line"
          style={{ width: `${widths[i % widths.length]}%` }}
        />
      ))}
    </div>
  );
}
