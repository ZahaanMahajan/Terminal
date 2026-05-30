/**
 * persistence/ — Phase 6: the browser client for the Termi API (`services/api`).
 *
 * Auth is cookie-based (the API sets a signed httpOnly session cookie); this module just calls the
 * REST endpoints with credentials. The login flow is a full-page navigation to `loginUrl()`.
 */

export * from './client';
