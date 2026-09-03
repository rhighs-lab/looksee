export const LAYERS = [
  'pushed',
  'local',
  'staged',
  'unstaged',
  'untracked',
  'conflicted',
] as const;
export type Layer = (typeof LAYERS)[number];

export const LAYER_LABEL: Record<Layer, string> = {
  pushed: 'Pushed',
  local: 'Local commits',
  staged: 'Staged',
  unstaged: 'Unstaged',
  untracked: 'Untracked',
  conflicted: 'Conflicted',
};

export const LAYER_HINT: Record<Layer, string> = {
  pushed: 'On the remote branch, ahead of the base',
  local: 'Committed locally, not yet pushed',
  staged: 'In the index, not yet committed',
  unstaged: 'Edited in the working tree, not staged',
  untracked: 'New file git does not know about',
  conflicted: 'Merge conflict, needs resolution',
};

export type ChangeKind =
  | 'added'
  | 'modified'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'typechange'
  | 'unmerged'
  | 'unchanged';

export const KIND_LABEL: Record<ChangeKind, string> = {
  added: 'added',
  modified: 'modified',
  deleted: 'deleted',
  renamed: 'renamed',
  copied: 'copied',
  typechange: 'type changed',
  unmerged: 'conflicted',
  unchanged: 'no net change',
};

export interface LayerChange {
  layer: Layer;
  kind: ChangeKind;
  oldPath: string | null;
}

export interface ChangedFile {
  path: string;
  oldPath: string | null;
  kind: ChangeKind;
  layers: LayerChange[];
  binary: boolean;
  additions: number;
  deletions: number;
  digest: string;
  generated: boolean;
  large: boolean;
}

export type Scope = 'cumulative' | Layer;
export const SCOPES: Scope[] = ['cumulative', ...LAYERS];

export type BaseSource =
  | 'flag'
  | 'upstream-base'
  | 'remote-head'
  | 'main'
  | 'master'
  | 'head';

export interface RepoRefs {
  head: {
    branch: string | null;
    sha: string;
    detached: boolean;
    checkedOut: boolean;
  };
  base: { ref: string; sha: string | null; source: BaseSource };
  mergeBase: string | null;
  upstream: {
    ref: string;
    remote: string;
    sha: string;
    ahead: number;
    behind: number;
    mergeBase: string;
  } | null;
  remoteBase: string | null;
  pushedBase: string | null;
  remotes: string[];
  lastFetchAt: string | null;
}

export interface RepoSummary {
  files: number;
  additions: number;
  deletions: number;
  byLayer: Record<Layer, number>;
}

export interface RepoState {
  version: number;
  repoRoot: string | null;
  refs: RepoRefs | null;
  files: ChangedFile[];
  summary: RepoSummary;
  computedAt: string;
  error: string | null;
}

export type LineType = 'context' | 'add' | 'del';

export interface DiffLine {
  type: LineType;
  oldNumber: number | null;
  newNumber: number | null;
  content: string;
  html?: string;
  layer?: Layer;
}

export interface Hunk {
  header: string;
  sectionHeading: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

export type Rev = 'WORKTREE' | 'INDEX' | string;

export type Endpoint =
  | { kind: 'head' }
  | { kind: 'index' }
  | { kind: 'worktree' }
  | { kind: 'commit'; oid: string }
  | { kind: 'ref'; name: string }
  | { kind: 'merge-base'; left: string; right: string }
  | { kind: 'pin'; name: 'opened' | 'approved' };

export interface Comparison {
  baseline: Endpoint;
  endpoint: Endpoint;
}

export type ScopePreset = 'session' | 'working' | 'branch' | 'custom';

export interface Pin {
  tree: string;
  head: string;
  at: string;
}

export interface Resolved {
  kind: Endpoint['kind'];
  oid: string;
  short: string;
  label: string;
}

export interface Session {
  openedAt: Pin | null;
  approvedAt: Pin | null;
  scope: ScopePreset;
  custom: Comparison | null;
  endedAt: string | null;
}

export interface FileDiff {
  path: string;
  oldPath: string | null;
  kind: ChangeKind;
  binary: boolean;
  language: string | null;
  additions: number;
  deletions: number;
  hunks: Hunk[];
  newLineCount: number | null;
  rev: Rev;
  oldRev: Rev;
  digest: string;
  truncated: boolean;
}

export interface DiffResponse {
  scope: Scope;
  version: number;
  files: FileDiff[];
}

export interface ContextResponse {
  from: number;
  eof: boolean;
  lines: string[];
  html: string[] | null;
  plain: boolean;
  maxHighlight: number;
}

export interface TreeEntry {
  path: string;
  kind: ChangeKind | 'unchanged';
}

export interface FileViewResponse {
  path: string;
  rev: Rev;
  lines: string[];
  html: string[] | null;
  binary: boolean;
  deleted: boolean;
  inDiff: boolean;
  changedLines: number[];
  plain: boolean;
  maxHighlight: number;
  tree: TreeEntry[];
}

export type CommentSide = 'new' | 'old' | 'file';
export type CommentAuthor = string;
export const USER_ACTOR = 'user';
export type CommentStatus = 'open' | 'resolved';
export type CommentKind = 'suggestion' | 'question' | 'comment';

export interface Comment {
  id: string;
  repoRoot: string;
  parentId: string | null;
  author: CommentAuthor;
  filePath: string;
  side: CommentSide;
  startLine: number;
  endLine: number;
  body: string;
  branch: string | null;
  lineSnapshot: string[];
  status: CommentStatus;
  reviewId: string | null;
  applied: { at: string; lines: string[] } | null;
  createdAt: string;
  updatedAt: string;
}

export interface DecoratedComment extends Comment {
  bodyHtml: string;
  kind: CommentKind;
  suggestion: { lines: string[] } | null;
  applicable: boolean | null;
}

export type ReviewState = 'pending' | 'submitted';
export const VERDICTS = ['comment', 'approve', 'request_changes'] as const;
export type Verdict = (typeof VERDICTS)[number];

export interface Review {
  id: string;
  repoRoot: string;
  author: string;
  branch: string | null;
  state: ReviewState;
  verdict: Verdict | null;
  body: string;
  createdAt: string;
  submittedAt: string | null;
  comparison: Comparison | null;
}

export interface DoneMark {
  actor: string;
  body: string;
  at: string;
}

export interface ReviewsResponse {
  reviews: Review[];
}

export interface SavedReply {
  id: string;
  name: string;
  body: string;
  createdAt: string;
}

export type ServerEvent =
  | { type: 'hello'; version: number }
  | { type: 'state.changed'; version: number }
  | { type: 'diff.changed'; path: string; origin: string | null }
  | {
      type: 'comment.created';
      comment: DecoratedComment;
      origin: string | null;
    }
  | {
      type: 'comment.updated';
      comment: DecoratedComment;
      origin: string | null;
    }
  | { type: 'comment.deleted'; id: string; origin: string | null }
  | { type: 'comments.reset'; origin: string | null }
  | {
      type: 'review.submitted';
      review: Review;
      comments: DecoratedComment[];
      origin: string | null;
    }
  | {
      type: 'comment.replied';
      comment: DecoratedComment;
      origin: string | null;
    }
  | {
      type: 'thread.resolved';
      id: string;
      actor: string;
      origin: string | null;
    }
  | {
      type: 'thread.reopened';
      id: string;
      actor: string;
      origin: string | null;
    }
  | {
      type: 'done.requested';
      actor: string;
      body: string;
      at: string;
      origin: string | null;
    };

export interface BranchesResponse {
  current: string | null;
  local: string[];
  remote: string[];
}

export interface RefSelection {
  base: string | null;
  head: string | null;
}

export interface HealthResponse {
  ok: true;
  app: 'looksee';
  repoRoot: string | null;
  version: number;
  pkgVersion: string;
}

export const MAX_HIGHLIGHT_LINES = 5000;
export const LARGE_DIFF_LINES = 1500;
