export const fileAnchor = (path: string): string =>
  `diff-${path.replace(/[^A-Za-z0-9_-]/g, (c) => `_${c.charCodeAt(0).toString(16)}`)}`;

export const encodePath = (p: string): string =>
  p.split('/').map(encodeURIComponent).join('/');

export const fileHref = (path: string, scope: string): string =>
  `/file/${encodePath(path)}${scope !== 'cumulative' ? `?scope=${scope}` : ''}`;
