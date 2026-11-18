import { guessMapping, mapRows, parseAmount, parseCsv, parseDate } from '../statementCsv';

describe('bank statement CSV', () => {
  it('splits quoted cells and detects ; or , as the separator', () => {
    expect(parseCsv('Fecha;Descripción;Monto\r\n01/10/2026;"PAGO ""EDENORTE""";-1.180,00\r\n')).toEqual([
      ['Fecha', 'Descripción', 'Monto'],
      ['01/10/2026', 'PAGO "EDENORTE"', '-1.180,00'],
    ]);
    expect(parseCsv('a,b\n"1,5",x\n')).toEqual([['a', 'b'], ['1,5', 'x']]);
  });

  it('reads Dominican dates and amounts in either convention', () => {
    expect(parseDate('09/10/2026', 'DD/MM/YYYY')).toBe('2026-10-09');
    expect(parseDate('10/09/26', 'MM/DD/YYYY')).toBe('2026-10-09');
    expect(parseDate('31/31/2026', 'DD/MM/YYYY')).toBeNull();
    expect(parseAmount('RD$ 1,234.56', '.')).toBe(1234.56);
    expect(parseAmount('1.234,56', ',')).toBe(1234.56);
    expect(parseAmount('(500.00)', '.')).toBe(-500);
    expect(parseAmount('', '.')).toBeNull();
  });

  it('maps debit/credit columns to signed amounts and skips lines it cannot read', () => {
    const rows = parseCsv('Fecha,Descripción,Referencia,Débito,Crédito\n09/10/2026,TRANSF EDENORTE,T-1,1180.00,\n10/10/2026,DEPOSITO,,,500.00\nTotal,,,,\n');
    const mapping = guessMapping(rows[0]);
    expect(mapping).toMatchObject({ date: 0, description: 1, reference: 2, amountMode: 'split', debit: 3, credit: 4 });
    expect(mapRows(rows, mapping)).toEqual({
      rows: [
        { date: '2026-10-09', description: 'TRANSF EDENORTE', amount: -1180, reference: 'T-1' },
        { date: '2026-10-10', description: 'DEPOSITO', amount: 500 },
      ],
      skipped: 1,
    });
  });
});
