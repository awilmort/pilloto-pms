import i18n from '../../../i18n';
import {
  dayLabel, estadoKey, estadoMeta, ESTADO_META, fiscalErrorMessage, formatDop, formatTaxId, hasOfficialFiles, isTaxId, isTestDocument, isValidDocument,
  periodLabel, usageRatio,
} from '../fiscalUi';

const t = i18n.getFixedT('en');

describe('e-CF states', () => {
  it('knows which states are still moving (so the UI offers a refresh) and which need a person', () => {
    for (const s of ['Pendiente', 'Firmado', 'En Proceso', 'Sin Resolver'] as const) expect(estadoMeta(s).busy).toBe(true);
    for (const s of ['Aceptado', 'Aceptado Condicional', 'Rechazado', 'Anulado', 'Error'] as const) expect(estadoMeta(s).busy).toBe(false);
    const attention = Object.entries(ESTADO_META).filter(([, m]) => m.needsAttention).map(([s]) => s).sort();
    expect(attention).toEqual(['Aceptado Condicional', 'Error', 'Rechazado', 'Sin Resolver']);
  });

  it('colours success, failure and in-between distinctly', () => {
    expect(estadoMeta('Aceptado').tone).toBe('success');
    expect(estadoMeta('Rechazado').tone).toBe('error');
    expect(estadoMeta('En Proceso').tone).toBe('info');
    expect(estadoMeta('Aceptado Condicional').tone).toBe('warning');
  });

  it('only an accepted document can be modified by a note', () => {
    expect(isValidDocument('Aceptado')).toBe(true);
    expect(isValidDocument('Aceptado Condicional')).toBe(true);
    for (const s of ['Pendiente', 'Firmado', 'En Proceso', 'Rechazado', 'Anulado', 'Error', 'Sin Resolver'] as const) expect(isValidDocument(s)).toBe(false);
  });

  it('builds the translation key of a state', () => {
    expect(estadoKey('En Proceso')).toBe('fiscal.estado.En_Proceso');
    expect(estadoKey('Aceptado Condicional')).toBe('fiscal.estado.Aceptado_Condicional');
  });

  it('files exist only once BillingSoft has the document; test-environment documents are flagged', () => {
    expect(hasOfficialFiles({ billingsoftDocumentId: 'd1' })).toBe(true);
    expect(hasOfficialFiles({})).toBe(false);
    expect(isTestDocument({ environment: 'testecf' })).toBe(true);
    expect(isTestDocument({ environment: 'certecf' })).toBe(true);
    expect(isTestDocument({ environment: 'ecf' })).toBe(false);
    expect(isTestDocument({})).toBe(false); // unknown is not claimed to be a test
  });
});

describe('fiscalErrorMessage', () => {
  const err = (data: object) => ({ response: { data } });

  it('translates a known code', () => {
    expect(fiscalErrorMessage(err({ code: 'FISCAL_NOT_CERTIFIED', message: 'raw' }), t)).toMatch(/DGII has not certified/);
  });

  it('shows BillingSoft\'s own explanation of a refusal rather than hiding it', () => {
    expect(fiscalErrorMessage(err({ code: 'FISCAL_REJECTED', message: 'El RNC del comprador no existe' }), t)).toBe('El RNC del comprador no existe');
  });

  it('falls back to the server message, then to a generic line', () => {
    expect(fiscalErrorMessage(err({ message: 'Folio not found' }), t)).toBe('Folio not found');
    expect(fiscalErrorMessage({}, t)).toBe('Something went wrong with electronic invoicing.');
    expect(fiscalErrorMessage(null, t)).toBe('Something went wrong with electronic invoicing.');
  });

  it('speaks Spanish when asked to', () => {
    expect(fiscalErrorMessage(err({ code: 'FISCAL_SUSPENDED' }), i18n.getFixedT('es'))).toMatch(/suspendida/);
  });
});

describe('formatting', () => {
  it('shows pesos with centavos', () => {
    expect(formatDop(1234.5, 'en')).toBe('RD$1,234.50');
    expect(formatDop('99.99', 'en')).toBe('RD$99.99');
    expect(formatDop(undefined, 'en')).toBe('RD$0.00');
    expect(formatDop('abc', 'en')).toBe('RD$0.00');
  });

  it('names months and days in the reader\'s language', () => {
    expect(periodLabel('2026-11', 'en')).toBe('November 2026');
    expect(periodLabel('2026-11', 'es').toLowerCase()).toContain('noviembre');
    expect(dayLabel('2026-12-01', 'en')).toBe('December 1');
    expect(periodLabel('nonsense', 'en')).toBe('nonsense');
  });

  it('formats tax ids with their separators and leaves anything else alone', () => {
    expect(formatTaxId('131880681')).toBe('1-31-88068-1');
    expect(formatTaxId('00112345678')).toBe('001-1234567-8');
    expect(formatTaxId('1234')).toBe('1234');
    expect(formatTaxId(undefined)).toBe('');
  });

  it('accepts only 9- and 11-digit tax ids, however they are typed', () => {
    expect(isTaxId('1-31-88068-1')).toBe(true);
    expect(isTaxId('001-1234567-8')).toBe(true);
    expect(isTaxId('12345')).toBe(false);
    expect(isTaxId('')).toBe(false);
  });

  it('measures usage against the allowance', () => {
    expect(usageRatio(150, 300)).toBe(0.5);
    expect(usageRatio(450, 300)).toBe(1.5);
    expect(usageRatio(10, 0)).toBe(0);
  });
});
