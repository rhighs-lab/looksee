import type {
  BranchesResponse,
  ContextResponse,
  DecoratedComment,
  DiffResponse,
  FileViewResponse,
  RefSelection,
  RepoState,
  Rev,
  SavedReply,
  Scope,
} from '@/shared/protocol.js';

export const CLIENT_ID = (globalThis.crypto?.randomUUID?.() ??
  String(Math.random())) as string;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body: unknown
  ) {
    super(message);
  }
}

async function request<T>(
  method: string,
  url: string,
  body?: unknown,
  init: RequestInit = {}
): Promise<T> {
  const req: RequestInit = {
    ...init,
    method,
    headers: {
      'x-looksee-client': CLIENT_ID,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(init.headers as Record<string, string> | undefined),
    },
  };
  if (body !== undefined) req.body = JSON.stringify(body);
  const res = await fetch(url, req);
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const msg =
      data && typeof data === 'object' && 'error' in data
        ? String((data as { error: unknown }).error)
        : `${res.status} ${res.statusText}`;
    throw new ApiError(res.status, msg, data);
  }
  return data as T;
}

const q = (
  params: Record<string, string | number | string[] | undefined>
): string => {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) for (const x of v) sp.append(k, x);
    else sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
};

export const api = {
  state: () => request<RepoState>('GET', '/api/state'),
  diff: (scope: Scope, paths?: string[], full?: boolean) =>
    request<DiffResponse>(
      'GET',
      `/api/diff${q({ scope, path: paths, full: full ? '1' : undefined })}`
    ),
  context: (path: string, rev: Rev, start: number, end: number) =>
    request<ContextResponse>(
      'GET',
      `/api/context${q({ path, rev, start, end })}`
    ),
  file: (path: string, scope: Scope) =>
    request<FileViewResponse>('GET', `/api/file${q({ path, scope })}`),
  branches: () => request<BranchesResponse>('GET', '/api/branches'),
  refs: () => request<RefSelection>('GET', '/api/refs'),
  setRefs: (sel: Partial<RefSelection>) =>
    request<RepoState>('POST', '/api/refs', sel),

  comments: (branch: string | null) =>
    request<{ comments: DecoratedComment[] }>(
      'GET',
      `/api/comments${q({ branch: branch ?? undefined })}`
    ),
  createComment: (body: Record<string, unknown>) =>
    request<{ comment: DecoratedComment }>('POST', '/api/comments', body),
  patchComment: (id: string, body: Record<string, unknown>) =>
    request<{ comment: DecoratedComment }>(
      'PATCH',
      `/api/comments/${encodeURIComponent(id)}`,
      body
    ),
  deleteComment: (id: string) =>
    request<{ ok: boolean }>(
      'DELETE',
      `/api/comments/${encodeURIComponent(id)}`
    ),
  applySuggestion: (id: string) =>
    request<{ comment: DecoratedComment }>(
      'POST',
      `/api/comments/${encodeURIComponent(id)}/apply`
    ),
  applyAll: (branch: string | null) =>
    request<{
      applied: DecoratedComment[];
      skipped: { id: string; reason: string }[];
    }>(
      'POST',
      `/api/suggestions/apply-all${q({ branch: branch ?? undefined })}`
    ),
  clearComments: (branch: string | null) =>
    request<{ cleared: number }>('POST', '/api/comments/clear', { branch }),
  restoreComments: () =>
    request<{ restored: number }>('POST', '/api/comments/restore'),
  exportComments: (branch: string | null, format: 'md' | 'json') =>
    request<{ count: number; content: string; path: string | null }>(
      'POST',
      '/api/export',
      { branch, format }
    ),
  preview: (body: Record<string, unknown>) =>
    request<{ html: string }>('POST', '/api/preview', body),
  savedReplies: () =>
    request<{ replies: SavedReply[] }>('GET', '/api/saved-replies'),
  addSavedReply: (name: string, body: string) =>
    request<{ reply: SavedReply }>('POST', '/api/saved-replies', {
      name,
      body,
    }),
  deleteSavedReply: (id: string) =>
    request<{ ok: boolean }>(
      'DELETE',
      `/api/saved-replies/${encodeURIComponent(id)}`
    ),
  upload: (name: string, type: string, data: string) =>
    request<{ url: string; path: string; name: string }>(
      'POST',
      '/api/attachments',
      { name, type, data }
    ),
};
