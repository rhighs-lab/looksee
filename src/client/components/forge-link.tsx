import { GitHubMark } from '@/client/components/icons.js';
import { useReview } from '@/client/store/review.js';
import { fileUrl, parseRemote } from '@/shared/forge.js';

export function ForgeLink({
  filePath,
  line,
}: {
  filePath: string;
  line?: number;
}) {
  const refs = useReview((s) => s.state?.refs ?? null);
  const remote = refs?.remoteUrl ? parseRemote(refs.remoteUrl) : null;
  if (!remote || !refs) return null;
  const ref = refs.head.branch ?? refs.head.sha;
  const label = `Open on ${remote.host}`;
  return (
    <a
      className="ui-btn ui-btn-small ui-btn-invisible ui-btn-icon"
      href={fileUrl(remote, ref, filePath, line)}
      target="_blank"
      rel="noreferrer noopener"
      data-tooltip={`${label} (${ref})`}
      aria-label={label}
    >
      <GitHubMark />
    </a>
  );
}
