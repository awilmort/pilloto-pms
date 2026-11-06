/**
 * Where the app lives, for links that leave the system (emails, redirects).
 *
 * Production: every property is `https://<slug>.<APP_BASE_DOMAIN>` (default `pilloto.com`).
 * `FRONTEND_URL` is a CORS/origin setting that may hold several comma-separated origins
 * (the Vercel URL, previews, …), so it is never used as a link base in production.
 * Development / test: the first `FRONTEND_URL` origin (default `http://localhost:3000`),
 * with the slug as a subdomain (`slug.localhost:3000`).
 */

const DEFAULT_PROD_DOMAIN = 'pilloto.com';

/** First origin in `FRONTEND_URL` (it may be a comma-separated list); no trailing slash. */
function firstFrontendOrigin(): string {
  const first = (process.env.FRONTEND_URL || '').split(',').map(s => s.trim()).find(Boolean);
  return (first || 'http://localhost:3000').replace(/\/+$/, '');
}

/** The production base domain, or `undefined` outside production when `APP_BASE_DOMAIN` is not set. */
function appBaseDomain(): string | undefined {
  const configured = (process.env.APP_BASE_DOMAIN || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (configured) return configured;
  return process.env.NODE_ENV === 'production' ? DEFAULT_PROD_DOMAIN : undefined;
}

/** The product's own origin (marketing site, shared static assets such as the email logo). */
export function platformBaseUrl(): string {
  const domain = appBaseDomain();
  return domain ? `https://${domain}` : firstFrontendOrigin();
}

/** A property's own app origin, e.g. `https://test-property.pilloto.com`. Without a slug, the platform origin. */
export function tenantBaseUrl(slug?: string): string {
  if (!slug) return platformBaseUrl();
  const domain = appBaseDomain();
  if (domain) return `https://${slug}.${domain}`;
  try {
    const parsed = new URL(firstFrontendOrigin());
    if (!parsed.hostname.startsWith(`${slug}.`)) parsed.hostname = `${slug}.${parsed.hostname}`;
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return firstFrontendOrigin();
  }
}
