/**
 * Link bases for emails: production properties live on <slug>.pilloto.com no matter what
 * FRONTEND_URL (a CORS list that may hold several origins) says; dev keeps the local origin.
 */
import { tenantBaseUrl, platformBaseUrl } from '../utils/appUrls';
import { renderInvitation } from '../utils/emailTemplates/invitation';

const saved = { ...process.env };
afterEach(() => { process.env = { ...saved }; });

describe('tenantBaseUrl', () => {
  it('production: slug.pilloto.com even when FRONTEND_URL is a comma-separated Vercel list', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.APP_BASE_DOMAIN;
    process.env.FRONTEND_URL = 'https://pilloto-pms.vercel.app,https://pilloto.com';
    expect(tenantBaseUrl('test-property')).toBe('https://test-property.pilloto.com');
    expect(platformBaseUrl()).toBe('https://pilloto.com');
  });

  it('production: APP_BASE_DOMAIN overrides the default domain (scheme and path are ignored)', () => {
    process.env.NODE_ENV = 'production';
    process.env.APP_BASE_DOMAIN = 'https://Staging.Pilloto.com/';
    expect(tenantBaseUrl('acme')).toBe('https://acme.staging.pilloto.com');
  });

  it('dev: first FRONTEND_URL origin with the slug as subdomain, keeping the port', () => {
    process.env.NODE_ENV = 'test';
    delete process.env.APP_BASE_DOMAIN;
    process.env.FRONTEND_URL = 'http://localhost:3000, http://other:3000';
    expect(tenantBaseUrl('acme')).toBe('http://acme.localhost:3000');
    expect(tenantBaseUrl()).toBe('http://localhost:3000');
  });
});

describe('invitation email', () => {
  it('carries the clean link and the Pilloto wordmark', () => {
    process.env.NODE_ENV = 'production';
    const url = `${tenantBaseUrl('test-property')}/set-password?token=abc`;
    const { html, text } = renderInvitation({ firstName: 'Ana', setPasswordUrl: url, tenantName: 'Test Property - Pilloto', isOwner: true, expiresInHours: 72 });
    expect(url).toBe('https://test-property.pilloto.com/set-password?token=abc');
    expect(html).toContain('href="https://test-property.pilloto.com/set-password?token=abc"');
    expect(html).toContain('https://pilloto.com/email/pilloto-wordmark.png');
    expect(html).not.toContain('vercel.app');
    expect(text).toContain(url);
  });
});
