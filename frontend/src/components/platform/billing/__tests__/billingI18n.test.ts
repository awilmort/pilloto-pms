/**
 * Every string the billing console shows exists in both languages with the same placeholders, and
 * every key the source asks for is defined — so a gap never shows up first in front of an operator.
 */
import fs from 'fs';
import path from 'path';
import en from '../../../../locales/en/translation.json';
import es from '../../../../locales/es/translation.json';

type Tree = { [k: string]: string | Tree };
const flatten = (node: Tree, prefix = ''): Record<string, string> =>
  Object.entries(node).reduce<Record<string, string>>((acc, [k, v]) => {
    const key = prefix ? `${prefix}.${k}` : k;
    return typeof v === 'string' ? { ...acc, [key]: v } : { ...acc, ...flatten(v, key) };
  }, {});

const EN = flatten((en as unknown as { platformBilling: Tree }).platformBilling, 'platformBilling');
const ES = flatten((es as unknown as { platformBilling: Tree }).platformBilling, 'platformBilling');
const placeholders = (s: string) => [...s.matchAll(/{{\s*(\w+)\s*}}/g)].map((m) => m[1]).sort();

describe('billing console translations', () => {
  it('define the same keys in English and Spanish', () => {
    expect(Object.keys(ES).sort()).toEqual(Object.keys(EN).sort());
  });

  it('are never empty and use the same placeholders in both languages', () => {
    expect(Object.entries({ ...EN, ...ES }).filter(([, v]) => !v.trim())).toEqual([]);
    expect(Object.keys(EN).filter((k) => placeholders(EN[k]).join() !== placeholders(ES[k]).join())).toEqual([]);
  });

  it('differ between languages, except words that are the same in both', () => {
    const cognates = new Set(['platformBilling.plans.plan', 'platformBilling.charges.total', 'platformBilling.charges.subtotal', 'platformBilling.payments.ecf', 'platformBilling.products.pms', 'platformBilling.products.accounting', 'platformBilling.tax.itbis18', 'platformBilling.tax.itbis16', 'platformBilling.issuer.type', 'platformBilling.guide.variable', 'platformBilling.guide.certificate', 'platformBilling.guide.certification', 'platformBilling.guide.sequences']); // "Variable" is the same word; the last three are BillingSoft's own Spanish menu names, quoted as they appear there
    expect(Object.keys(EN).filter((k) => EN[k] === ES[k] && /[a-z]{4,}/i.test(EN[k]) && !cognates.has(k))).toEqual([]);
  });

  it('cover every key the source asks for', () => {
    const dir = path.join(__dirname, '..');
    const files = [...fs.readdirSync(dir).filter((f) => /\.(ts|tsx)$/.test(f)).map((f) => path.join(dir, f)), path.join(dir, '..', '..', '..', 'pages', 'platform', 'BillingPage.tsx')];
    const used = new Set<string>();
    for (const file of files) {
      const source = fs.readFileSync(file, 'utf8');
      for (const m of source.matchAll(/['"`](platformBilling\.[\w.]+)['"`]/g)) used.add(m[1]);
    }
    const missing = [...used].filter((k) => !(k in EN));
    expect(missing).toEqual([]);
  });

  it('translate every payment method, charge status, product, tab, DGII step and error code the UI can show', () => {
    const need = [
      ...['transfer', 'deposit', 'cash', 'check', 'card', 'other'].map((m) => `platformBilling.methods.${m}`),
      ...['open', 'partial', 'paid', 'void'].map((s) => `platformBilling.charges.status.${s}`),
      ...['pms', 'accounting'].map((p) => `platformBilling.products.${p}`),
      ...['charges', 'payments', 'tenants', 'plans', 'settings', 'ecf'].map((k) => `platformBilling.tabs.${k}`),
      ...['profile', 'certificate', 'sequences', 'directory', 'first_document'].map((s) => `platformBilling.issuer.step.${s}`),
      ...['valid', 'expiring', 'expired', 'not_yet_valid', 'none'].map((s) => `platformBilling.issuer.cert.${s}`),
      ...['need_required', 'need_recommended', 'need_optional', 'envKey', 'envApi', 'envPublic', 'envEncryption', 'envApp'].map((k) => `platformBilling.guide.${k}`),
      ...['BILLING_INVALID', 'BILLING_STATE', 'BILLING_ECF_PENDING', 'BILLING_TENANT_PROFILE', 'FISCAL_NOT_ACTIVATED', 'FISCAL_NOT_CERTIFIED', 'BILLINGSOFT_UNREACHABLE'].map((c) => `platformBilling.errors.${c}`),
    ];
    expect(need.filter((k) => !(k in EN) || !(k in ES))).toEqual([]);
  });

  it('translate every error code the billing endpoints can answer with', () => {
    const backend = path.join(__dirname, '..', '..', '..', '..', '..', '..', 'backend', 'src');
    if (!fs.existsSync(backend)) return; // the frontend can be built on its own
    const files = [
      path.join(backend, 'routes', 'platformBilling.ts'),
      ...fs.readdirSync(path.join(backend, 'services', 'platformBilling')).map((f) => path.join(backend, 'services', 'platformBilling', f)),
    ];
    const codes = new Set<string>();
    for (const file of files) {
      for (const m of fs.readFileSync(file, 'utf8').matchAll(/new FiscalError\(\s*\d+\s*,\s*'([A-Z_]+)'/g)) codes.add(m[1]);
    }
    // The e-CF pipeline's own refusals, which a payment's e-CF can surface from here.
    ['FISCAL_NOT_ACTIVATED', 'FISCAL_NOT_CERTIFIED', 'FISCAL_NOT_CONFIGURED', 'BILLINGSOFT_UNREACHABLE', 'BILLINGSOFT_AUTH', 'EMAIL_FAILED'].forEach((c) => codes.add(c));
    // `FISCAL_REJECTED` carries BillingSoft's own explanation, which is shown as it is.
    const missing = [...codes].filter((c) => c !== 'FISCAL_REJECTED' && !(`platformBilling.errors.${c}` in EN));
    expect(codes.size).toBeGreaterThan(10);
    expect(missing).toEqual([]);
  });

  it('name the Billing page in the console menu in both languages', () => {
    expect((en as any).platform.nav.billing).toBeTruthy();
    expect((es as any).platform.nav.billing).toBeTruthy();
  });
});
