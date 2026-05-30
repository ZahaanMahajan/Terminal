/**
 * src/config.ts — auth configuration from the environment.
 *
 * Returns `null` when GitHub credentials are absent, so the server still boots and `/health`
 * works; the `/auth/*` and `/me` routes then answer 503 with a hint. This keeps the common
 * "just run it" path friendly while making the real flow opt-in via env.
 *
 * Required to enable auth:
 *   GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET   — from a GitHub OAuth App
 * Optional (sensible local defaults):
 *   TERMI_API_BASE     default http://localhost:7683   (must match the OAuth App's callback host)
 *   TERMI_WEB_ORIGIN   default http://localhost:5173   (Vite dev server; CORS + post-login redirect)
 *   TERMI_COOKIE_SECRET                                 (HMAC key for signed cookies)
 *
 * Use `localhost` (not 127.0.0.1) for both so the session cookie is same-site across the two
 * ports — see services/api/README.md.
 */

export type AuthConfig = {
  clientId: string;
  clientSecret: string;
  cookieSecret: string;
  apiBase: string;
  webOrigin: string;
  callbackUrl: string;
  secureCookies: boolean;
};

const DEV_COOKIE_SECRET = 'termi-dev-insecure-cookie-secret';

export function loadAuthConfig(env: NodeJS.ProcessEnv = process.env): AuthConfig | null {
  const clientId = env.GITHUB_CLIENT_ID;
  const clientSecret = env.GITHUB_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  const apiBase = env.TERMI_API_BASE ?? 'http://localhost:7683';
  const cookieSecret = env.TERMI_COOKIE_SECRET ?? DEV_COOKIE_SECRET;
  if (cookieSecret === DEV_COOKIE_SECRET) {
    console.warn('⚠ using the insecure dev cookie secret — set TERMI_COOKIE_SECRET in production');
  }

  return {
    clientId,
    clientSecret,
    cookieSecret,
    apiBase,
    webOrigin: env.TERMI_WEB_ORIGIN ?? 'http://localhost:5173',
    callbackUrl: `${apiBase}/auth/github/callback`,
    secureCookies: apiBase.startsWith('https://'),
  };
}
