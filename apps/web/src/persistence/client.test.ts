/**
 * client.test.ts — the API client's logic (URL/credentials/parsing/error mapping), with a stubbed
 * global fetch. We don't test the network; we test that we *call* it right and interpret responses.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { getMe, listSetups, createSetup, deleteSetup, ApiError } from './client';

type FetchArgs = { url: string; init: RequestInit };
let calls: FetchArgs[] = [];

function stubFetch(status: number, body: unknown) {
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init: RequestInit = {}) => {
      calls.push({ url, init });
      return Promise.resolve({
        ok: status >= 200 && status < 300,
        status,
        json: () => Promise.resolve(body),
      } as Response);
    }),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('persistence client', () => {
  it('getMe returns the user on 200 and sends credentials', async () => {
    stubFetch(200, { id: 'u1', github_id: 1, login: 'octocat', name: null, avatar_url: null });
    const me = await getMe();
    expect(me?.login).toBe('octocat');
    expect(calls[0].url).toMatch(/\/me$/);
    expect(calls[0].init.credentials).toBe('include');
  });

  it('getMe maps 401 to null (not signed in)', async () => {
    stubFetch(401, { error: 'unauthenticated' });
    expect(await getMe()).toBeNull();
  });

  it('listSetups unwraps the { setups } envelope', async () => {
    stubFetch(200, { setups: [{ id: 's1', name: 'a', created_at: 't', updated_at: 't' }] });
    const list = await listSetups();
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('a');
  });

  it('createSetup POSTs JSON to /setups', async () => {
    stubFetch(201, { id: 's2', name: 'x', ast: {}, created_at: 't', updated_at: 't' });
    await createSetup('x', { version: 2 });
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].url).toMatch(/\/setups$/);
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ name: 'x', ast: { version: 2 } });
  });

  it('deleteSetup tolerates a 204 (no body)', async () => {
    stubFetch(204, null);
    await expect(deleteSetup('s1')).resolves.toBeUndefined();
    expect(calls[0].init.method).toBe('DELETE');
  });

  it('throws ApiError with the server message on a non-2xx', async () => {
    stubFetch(400, { error: 'name is required' });
    await expect(createSetup('', {})).rejects.toMatchObject({
      name: 'ApiError',
      status: 400,
      message: 'name is required',
    });
    expect(ApiError).toBeTruthy();
  });
});
