/** `/Users/me/repos/x` reads as `~/repos/x`: shorter, and it keeps the
 *  account name out of screenshots and shared links. */
export const tildify = (
  p: string | null,
  home: string | null
): string | null => {
  if (!p) return p;
  if (!home || home === '/') return p;
  const h = home.replace(/\/+$/, '');
  if (p === h) return '~';
  return p.startsWith(`${h}/`) ? `~${p.slice(h.length)}` : p;
};
