export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public data?: unknown,
  ) {
    super(message);
  }
}

// Deshacer: a change the server can undo answers with `x-undo-token`. The tokens wait here until
// the confirmation toast picks them up (notifyOk in queries.ts).
type UndoToken = { token: string; at: number };
const undoQueue: UndoToken[] = [];

/** Takes the undo tokens of the last `withinMs` milliseconds off the queue, newest first. */
export function takeUndoTokens(withinMs = 4000): string[] {
  const since = Date.now() - withinMs;
  const taken = undoQueue.filter((t) => t.at >= since).map((t) => t.token);
  undoQueue.length = 0;
  return taken.reverse();
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, credentials: 'same-origin', headers: {} };
  if (body instanceof FormData) {
    init.body = body;
  } else if (body !== undefined) {
    init.body = JSON.stringify(body);
    (init.headers as Record<string, string>)['content-type'] = 'application/json';
  }
  const res = await fetch(`/api${url}`, init);
  const undoToken = res.headers.get('x-undo-token');
  if (res.ok && undoToken) {
    // Old ones no toast took (an action without a confirmation) can't be offered any more.
    while (undoQueue.length && undoQueue[0].at < Date.now() - 10_000) undoQueue.shift();
    undoQueue.push({ token: undoToken, at: Date.now() });
  }
  const isJson = res.headers.get('content-type')?.includes('application/json');
  const data = isJson ? await res.json() : undefined;
  if (!res.ok) {
    if (res.status === 401 && !url.startsWith('/auth/')) window.dispatchEvent(new Event('pfd:unauthorized'));
    throw new ApiError(res.status, (data as { error?: string })?.error ?? `Error ${res.status}`, data);
  }
  return data as T;
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body?: unknown) => request<T>('POST', url, body ?? {}),
  put: <T>(url: string, body?: unknown) => request<T>('PUT', url, body ?? {}),
  patch: <T>(url: string, body?: unknown) => request<T>('PATCH', url, body ?? {}),
  del: <T>(url: string) => request<T>('DELETE', url),
  upload: <T>(url: string, file: File | Blob, name = 'file', fileName?: string) => {
    const fd = new FormData();
    fd.append(name, file, fileName ?? (file as File).name ?? 'archivo');
    return request<T>('POST', url, fd);
  },
};

/** Builds a query string, skipping empty values. */
export function qs(params: Record<string, string | number | boolean | null | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}

/** Triggers a browser download for an API file endpoint. */
export function download(url: string) {
  const a = document.createElement('a');
  a.href = `/api${url}`;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}
