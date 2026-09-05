const L_BRACE =
  'M 79.75 35.05 C 62.75 35.05 62.75 56.06 62.75 90.82 C 62.75 111.83 42.75 128 42.75 128 C 42.75 128 62.75 144.17 62.75 165.18 C 62.75 199.94 62.75 220.95 79.75 220.95';
const R_BRACE =
  'M 176.25 35.05 C 193.25 35.05 193.25 56.06 193.25 90.82 C 193.25 111.83 213.25 128 213.25 128 C 213.25 128 193.25 144.17 193.25 165.18 C 193.25 199.94 193.25 220.95 176.25 220.95';

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
      <g transform="translate(128 128) scale(1.0639) translate(-128 -128)">
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
          d="M 93.5 128 L 162.5 128"
          fill="none"
          stroke="#0046fc"
          strokeWidth="9.5"
          strokeLinecap="round"
        />
        <circle
          className="logo-dot"
          cx="128"
          cy="128"
          r="17.5"
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
