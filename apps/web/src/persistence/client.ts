/**
 * persistence/client.ts — the typed browser client for the Phase 6 API (`services/api`).
 *
 * Every call sends `credentials: 'include'` so the signed httpOnly session cookie rides along —
 * the browser never handles a token. `getMe()` maps a 401 to `null` (not signed in); everything
 * else throws `ApiError` on a non-2xx so callers can show the message.
 *
 * The API base is `VITE_API_BASE` or `http://localhost:7683`. Use `localhost` (not 127.0.0.1) for
 * both the web app and the API so the session cookie is same-site across the two ports — see
 * services/api/README.md.
 */

const API_BASE =
  (import.meta.env.VITE_API_BASE as string | undefined) ?? 'http://localhost:7683';

export type Me = {
  id: string;
  github_id: number;
  login: string;
  name: string | null;
  avatar_url: string | null;
};
export type SetupSummary = { id: string; name: string; created_at: string; updated_at: string };
export type Setup = SetupSummary & { ast: unknown };
export type PublishedVersion = { id: string; setup_id: string; version: number; created_at: string };

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

const apiUrl = (path: string): string => `${API_BASE}${path}`;

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(apiUrl(path), { credentials: 'include', ...init });
  if (res.status === 204) return undefined as T;
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new ApiError(res.status, (body.error as string) ?? res.statusText);
  return body as T;
}

/** The URL to navigate to (full-page) to begin the GitHub login redirect flow. */
export const loginUrl = (): string => apiUrl('/auth/github/login');

/** The current user, or `null` when not signed in (401). Throws on network/other errors. */
export async function getMe(): Promise<Me | null> {
  try {
    return await req<Me>('/me');
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) return null;
    throw e;
  }
}

export const logout = (): Promise<{ ok: true }> => req('/auth/logout', { method: 'POST' });

export async function listSetups(): Promise<SetupSummary[]> {
  return (await req<{ setups: SetupSummary[] }>('/setups')).setups;
}

export const getSetup = (id: string): Promise<Setup> => req(`/setups/${id}`);

const jsonInit = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

export const createSetup = (name: string, ast: unknown): Promise<Setup> =>
  req('/setups', jsonInit('POST', { name, ast }));

export const updateSetup = (
  id: string,
  fields: { name?: string; ast?: unknown },
): Promise<Setup> => req(`/setups/${id}`, jsonInit('PATCH', fields));

export const deleteSetup = (id: string): Promise<void> => req(`/setups/${id}`, { method: 'DELETE' });

export const publishSetup = (id: string): Promise<PublishedVersion> =>
  req(`/setups/${id}/publish`, { method: 'POST' });
