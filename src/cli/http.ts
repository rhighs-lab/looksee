export class HttpError extends Error {
  status: number;
  constructor(status: number, msg: string) {
    super(msg);
    this.name = 'HttpError';
    this.status = status;
  }
}

export interface Client {
  get: <T>(path: string) => Promise<T>;
  post: <T>(path: string, body?: unknown) => Promise<T>;
  patch: <T>(path: string, body?: unknown) => Promise<T>;
  del: <T>(path: string) => Promise<T>;
}

const parse = async (res: Response): Promise<unknown> => {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

const errMsg = (status: number, body: unknown): string => {
  if (body && typeof body === 'object' && 'error' in body) {
    const e = (body as { error: unknown }).error;
    if (typeof e === 'string') return e;
  }
  return typeof body === 'string' && body ? body : `http ${status}`;
};

export const client = (baseUrl: string, actor: string): Client => {
  const headers = {
    'x-looksee-actor': actor,
    'x-looksee-client': `cli-${process.pid}`,
    'content-type': 'application/json',
  };
  const send = async <T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> => {
    const init: RequestInit = { method, headers };
    if (body !== undefined) init.body = JSON.stringify(body);
    const res = await fetch(`${baseUrl}${path}`, init);
    const data = await parse(res);
    if (!res.ok) throw new HttpError(res.status, errMsg(res.status, data));
    return data as T;
  };
  return {
    get: (path) => send('GET', path),
    post: (path, body) => send('POST', path, body),
    patch: (path, body) => send('PATCH', path, body),
    del: (path) => send('DELETE', path),
  };
};
