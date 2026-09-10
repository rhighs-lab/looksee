import type {
  AnswersResponse,
  BranchesResponse,
  CommitDetailResponse,
  CommitsResponse,
  Comparison,
  ContextResponse,
  DecoratedAnswer,
  DecoratedComment,
  DiffResponse,
  FileHistoryInfo,
  FileHistoryResponse,
  FileStatInfo,
  FileViewResponse,
  IdentitiesResponse,
  RepoState,
  Rev,
  Review,
  ReviewsResponse,
  SavedReply,
  Scope,
  ScopePreset,
  Session,
  TreeAtCommitResponse,
  UiPrefs,
  Verdict,
} from '@/shared/protocol.js';

export const CLIENT_ID = (globalThis.crypto?.randomUUID?.() ??
  String(Math.random())) as string;

const REQUEST_TIMEOUT_MS = 30_000;

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
  req.signal ??= AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, req);
  } catch (err) {
    if ((err as Error).name === 'TimeoutError')
      throw new ApiError(0, 'the server did not answer', null);
    throw err;
  }
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
  diff: (scope: Scope, paths?: string[], full?: boolean, attribute?: boolean) =>
    request<DiffResponse>(
      'GET',
      `/api/diff${q({
        scope,
        path: paths,
        full: full ? '1' : undefined,
        attribute: attribute ? '1' : undefined,
      })}`
    ),
  context: (path: string, rev: Rev, start: number, end: number) =>
    request<ContextResponse>(
      'GET',
      `/api/context${q({ path, rev, start, end })}`
    ),
  file: (path: string, scope: Scope) =>
    request<FileViewResponse>('GET', `/api/file${q({ path, scope })}`),
  fileStat: (path: string) =>
    request<FileStatInfo>('GET', `/api/file-info${q({ path, part: 'stat' })}`),
  fileHistoryInfo: (path: string) =>
    request<FileHistoryInfo>(
      'GET',
      `/api/file-info${q({ path, part: 'history' })}`
    ),
  branches: () => request<BranchesResponse>('GET', '/api/branches'),
  commits: () => request<CommitsResponse>('GET', '/api/commits'),
  commit: (sha: string) =>
    request<CommitDetailResponse>(
      'GET',
      `/api/commit/${encodeURIComponent(sha)}`
    ),
  treeAt: (sha: string) =>
    request<TreeAtCommitResponse>(
      'GET',
      `/api/tree/${encodeURIComponent(sha)}`
    ),
  fileHistory: (path: string) =>
    request<FileHistoryResponse>('GET', `/api/file-history${q({ path })}`),
  session: () => request<Session | null>('GET', '/api/session'),
  pin: () => request<RepoState>('POST', '/api/session/pin'),
  endSession: () => request<RepoState>('POST', '/api/session/end'),
  setScope: (preset: ScopePreset, custom?: Comparison) =>
    request<RepoState>('POST', '/api/scope', {
      preset,
      ...(custom ? { custom } : {}),
    }),

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
  openEditor: (path: string, line?: number) =>
    request<{ ok: boolean }>('POST', '/api/open-editor', { path, line }),
  identities: (actor?: string) =>
    request<IdentitiesResponse>(
      'GET',
      `/api/identities${actor ? `?actors=${encodeURIComponent(actor)}` : ''}`
    ),
  uiPrefs: () => request<UiPrefs>('GET', '/api/ui-prefs'),
  setUiPrefs: (patch: Partial<UiPrefs>) =>
    request<UiPrefs>('POST', '/api/ui-prefs', patch),
  answers: () => request<AnswersResponse>('GET', '/api/answers'),
  answer: (id: string) =>
    request<{ answer: DecoratedAnswer }>(
      'GET',
      `/api/answers/${encodeURIComponent(id)}`
    ),
  deleteAnswer: (id: string) =>
    request<{ ok: boolean }>(
      'DELETE',
      `/api/answers/${encodeURIComponent(id)}`
    ),
  listReviews: () => request<ReviewsResponse>('GET', '/api/reviews'),
  startReview: (branch: string | null) =>
    request<{ review: Review; guard: string }>('POST', '/api/reviews', {
      branch,
    }),
  getReview: (id: string) =>
    request<{ review: Review; comments: DecoratedComment[] }>(
      'GET',
      `/api/reviews/${encodeURIComponent(id)}`
    ),
  submitReview: (id: string, verdict: Verdict, body: string) =>
    request<{ review: Review; comments: DecoratedComment[] }>(
      'POST',
      `/api/reviews/${encodeURIComponent(id)}/submit`,
      { verdict, body }
    ),
  discardReview: (id: string) =>
    request<{ ok: boolean }>(
      'DELETE',
      `/api/reviews/${encodeURIComponent(id)}`
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
