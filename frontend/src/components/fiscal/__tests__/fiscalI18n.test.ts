/**
 * Every string the e-CF screens show exists in both languages, with the same placeholders — and
 * every key the source uses is defined. A missing translation would otherwise show up only in
 * production, in Spanish, in front of a hotel owner.
 */
import fs from 'fs';
import path from 'path';
import en from '../../../locales/en/translation.json';
import es from '../../../locales/es/translation.json';
import { ESTADO_META, estadoKey } from '../fiscalUi';

type Tree = { [k: string]: string | Tree };
const flatten = (node: Tree, prefix = ''): Record<string, string> =>
  Object.entries(node).reduce<Record<string, string>>((acc, [k, v]) => {
    const key = prefix ? `${prefix}.${k}` : k;
    return typeof v === 'string' ? { ...acc, [key]: v } : { ...acc, ...flatten(v, key) };
  }, {});

const EN = flatten((en as unknown as { fiscal: Tree }).fiscal, 'fiscal');
const ES = flatten((es as unknown as { fiscal: Tree }).fiscal, 'fiscal');
const placeholders = (s: string) => [...s.matchAll(/{{\s*(\w+)\s*}}/g)].map((m) => m[1]).sort();
const PLURAL = /_(zero|one|two|few|many|other)$/;
const defined = (map: Record<string, string>, key: string) => key in map || `${key}_other` in map;

const walk = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === '__tests__' ? [] : walk(p);
    return /\.(ts|tsx)$/.test(e.name) ? [p] : [];
  });

describe('fiscal translations', () => {
  it('define the same keys in English and Spanish', () => {
    expect(Object.keys(ES).sort()).toEqual(Object.keys(EN).sort());
  });

  it('are never empty (except the one state that needs no message)', () => {
    const empty = Object.entries({ ...EN, ...ES }).filter(([, v]) => !v.trim()).map(([k]) => k);
    expect([...new Set(empty)]).toEqual(['fiscal.cannotIssue.ready']);
  });

  it('use the same placeholders in both languages', () => {
    const mismatched = Object.keys(EN).filter((k) => placeholders(EN[k]).join() !== placeholders(ES[k]).join());
    expect(mismatched).toEqual([]);
  });

  it('differ between languages, except words that are the same in both', () => {
    const cognates = new Set([
      'fiscal.activation.plan', 'fiscal.planCard.title', 'fiscal.statements.plan', 'fiscal.statements.planCharge', 'fiscal.usage.planCharge', // "Plan"
      'fiscal.documents.total', 'fiscal.statements.total', // "Total"
      'fiscal.estado.Error', 'fiscal.received.target.dgii', 'fiscal.statements.overage', // "Error", "DGII", "Extra"
      'fiscal.statements.extraDetail', // "{{count}} × {{unit}}"
    ]);
    const same = Object.keys(EN).filter((k) => EN[k] === ES[k] && /[a-z]{4,}/i.test(EN[k]) && !cognates.has(k));
    expect(same).toEqual([]);
  });

  it('cover every key the source asks for', () => {
    const root = path.join(__dirname, '..', '..', '..');
    const used = new Set<string>();
    for (const file of walk(root)) {
      const src = fs.readFileSync(file, 'utf8');
      for (const m of src.matchAll(/\bt\(\s*(['"])(fiscal\.[A-Za-z0-9_.]+)\1/g)) used.add(m[2]);
    }
    expect(used.size).toBeGreaterThan(150);
    const missing = [...used].filter((k) => !defined(EN, k) || !defined(ES, k));
    expect(missing).toEqual([]);
  });

  it('cover the dynamic families: every state, document type, plan, lifecycle state, alert and API error', () => {
    const need: string[] = [];
    for (const s of Object.keys(ESTADO_META)) need.push(estadoKey(s));
    for (const x of ['31', '32', '33', '34', '41', '43', '44', '45', '46', '47']) need.push(`fiscal.tipo.E${x}`);
    for (const p of ['essential', 'pro', 'max']) need.push(`fiscal.plan.${p}`);
    for (const s of ['inactive', 'suspended', 'not_started', 'in_progress', 'ready']) need.push(`fiscal.state.${s}`, `fiscal.cannotIssue.${s}`);
    for (const e of ['testecf', 'certecf', 'ecf']) need.push(`fiscal.environment.${e}`);
    for (const s of ['open', 'closed', 'paid', 'void']) need.push(`fiscal.statements.state.${s}`);
    for (const s of ['done', 'todo', 'working']) need.push(`fiscal.progress.state.${s}`);
    for (const k of ['documents', 'received', 'sequences', 'report']) need.push(`fiscal.center.tab.${k}`);
    for (const x of ['41', '43', '44', '45', '46', '47']) need.push(`fiscal.other.help.${x}`);
    for (const x of ['01', '02', '03', '04', '05', '06']) need.push(`fiscal.other.income.${x}`);
    for (const x of ['itbis18', 'itbis16', 'itbis0', 'exempt']) need.push(`fiscal.other.tax.${x}`);
    for (const a of ['suspended', 'rejected', 'failed', 'queued', 'stale', 'certificate_expired', 'certificate_expiring', 'certificate_missing', 'no_sequences']) need.push(`fiscal.alerts.${a}`);
    const missing = need.filter((k) => !defined(EN, k) || !defined(ES, k));
    expect(missing).toEqual([]);
  });

  it('translate every error code the backend can answer with (a refusal keeps BillingSoft\'s own words)', () => {
    const dir = path.join(__dirname, '..', '..', '..', '..', '..', 'backend', 'src');
    if (!fs.existsSync(dir)) return; // the frontend can be built on its own
    const codes = new Set<string>();
    for (const file of walk(dir)) {
      // Pilloto's own billing answers in the platform console, in its own namespace (see billingI18n.test.ts).
      if (/platformBilling/.test(file)) continue;
      for (const m of fs.readFileSync(file, 'utf8').matchAll(/new FiscalError\(\s*\d+\s*,\s*'([A-Z_]+)'/g)) codes.add(m[1]);
    }
    // codes whose message is the specific, already-translated-by-the-server explanation
    const explained = new Set(['FISCAL_REJECTED', 'INVALID_ID', 'NOT_FOUND', 'TENANT_NOT_FOUND']);
    const missing = [...codes].filter((c) => !explained.has(c) && !defined(EN, `fiscal.errors.${c}`));
    expect(codes.size).toBeGreaterThan(8);
    expect(missing).toEqual([]);
    expect(Object.keys(EN).filter((k) => PLURAL.test(k)).every((k) => `${k.replace(PLURAL, '')}_one` in EN || `${k.replace(PLURAL, '')}_other` in EN)).toBe(true);
  });
});
