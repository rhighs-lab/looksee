const HOSTS: Record<string, string> = {
  'github.com': 'blob',
  'gitlab.com': 'blob',
};

export interface ForgeRepo {
  host: string;
  owner: string;
  repo: string;
}

export function parseRemote(url: string): ForgeRepo | null {
  const trimmed = url.trim().replace(/\.git$/, '');
  const scp = /^(?:[\w.-]+@)?([\w.-]+):(.+)$/.exec(trimmed);
  const m = /^[a-z+]+:\/\/(?:[^@/]+@)?([\w.-]+)(?::\d+)?\/(.+)$/.exec(trimmed);
  const [host, path] = m
    ? [m[1]!, m[2]!]
    : scp
      ? [scp[1]!, scp[2]!]
      : [null, null];
  if (!host || !path || !(host in HOSTS)) return null;
  const parts = path.split('/').filter(Boolean);
  if (parts.length < 2) return null;
  return { host, owner: parts.slice(0, -1).join('/'), repo: parts.at(-1)! };
}

export function fileUrl(
  repo: ForgeRepo,
  ref: string,
  filePath: string,
  line?: number
): string {
  const segment = HOSTS[repo.host] ?? 'blob';
  const path = filePath.split('/').map(encodeURIComponent).join('/');
  const base = `https://${repo.host}/${repo.owner}/${repo.repo}/${segment}/${encodeURIComponent(ref)}/${path}`;
  return line ? `${base}#L${line}` : base;
}
