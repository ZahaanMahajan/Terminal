/**
 * src/cookies.ts — parse the `Cookie` request header, serialize `Set-Cookie` responses.
 *
 * Pure string work — no framework. Knowing exactly what attributes a cookie carries (and *why*
 * — HttpOnly keeps JS from reading it, SameSite governs cross-site sending, Secure requires
 * HTTPS) is half the point of doing auth by hand.
 */

/** Parse a `Cookie` header into a name→value map. First occurrence of a name wins. */
export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const name = part.slice(0, eq).trim();
    if (!name || name in out) continue;
    out[name] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return out;
}

export type CookieOptions = {
  maxAgeSec?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
  path?: string;
};

/** Serialize one `Set-Cookie` value. `Path` defaults to `/`. */
export function serializeCookie(name: string, value: string, opts: CookieOptions = {}): string {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (opts.maxAgeSec !== undefined) parts.push(`Max-Age=${Math.floor(opts.maxAgeSec)}`);
  parts.push(`Path=${opts.path ?? '/'}`);
  if (opts.sameSite) parts.push(`SameSite=${opts.sameSite}`);
  if (opts.httpOnly) parts.push('HttpOnly');
  if (opts.secure) parts.push('Secure');
  return parts.join('; ');
}

/** A `Set-Cookie` that deletes a cookie (empty value, `Max-Age=0`). Match path/attrs to the set. */
export function clearCookie(name: string, opts: CookieOptions = {}): string {
  return serializeCookie(name, '', { ...opts, maxAgeSec: 0 });
}
