/**
 * src/respond.ts — the one place we write an HTTP response. JSON body (or none for 204), plus any
 * extra headers (CORS, Set-Cookie). Headers passed here win over content-type for 204/no-body.
 */

import type { ServerResponse } from 'node:http';

export function json(
  res: ServerResponse,
  code: number,
  body: unknown,
  headers: Record<string, string | string[]> = {},
): void {
  const payload = body === null || body === undefined ? '' : JSON.stringify(body);
  res.writeHead(code, {
    ...(payload ? { 'content-type': 'application/json' } : {}),
    ...headers,
  });
  res.end(payload);
}
