import { AxiosResponse } from 'axios';
import apiClient from './api';

interface Ok<T> { success: true; data: T }

export interface BankAccountView {
  _id: string;
  name: string;
  bankName?: string;
  accountNumberLast4?: string;
  currency: 'DOP' | 'USD' | 'EUR';
  glAccount: { _id: string; code: string; name: string };
  isDefault: boolean;
  isActive: boolean;
  balance: number;
  unmatched: number;
  lastReconciled: string | null;
}

export interface BookLine { entry: string; entryNumber: string; line: string; date: string; memo: string; amount: number; cleared: boolean }

export interface StatementLine {
  _id: string;
  date: string;
  description: string;
  reference?: string;
  amount: number;
  source: 'import' | 'manual';
  status: 'unmatched' | 'matched' | 'ignored';
  matches: { entry: string; line: string; amount: number }[];
  reconciliation?: string;
  suggestions: BookLine[];
}

export interface ReconciliationView {
  reconciliation: { _id: string; statementDate: string; statementEndingBalance: number; beginningBalance: number; status: 'open' | 'closed'; closedAt?: string };
  beginningBalance: number;
  statementTotal: number;
  clearedBalance: number;
  difference: number;
  pendingLines: number;
  bookBalance: number;
  canClose: boolean;
}

const base = '/accounting/bank-accounts';

/** Bank accounts & reconciliation — backend routes/accounting/bankAccounts.routes.ts. */
export const bankService = {
  list: (): Promise<AxiosResponse<Ok<BankAccountView[]>>> => apiClient.get(base),
  create: (data: { name: string; bankName?: string; accountNumberLast4?: string; currency?: string; isDefault?: boolean }) => apiClient.post(base, data),
  update: (id: string, data: Partial<{ name: string; bankName: string; accountNumberLast4: string; isDefault: boolean; isActive: boolean }>) => apiClient.put(`${base}/${id}`, data),
  lines: (id: string, params?: { status?: string }): Promise<AxiosResponse<Ok<StatementLine[]>>> => apiClient.get(`${base}/${id}/statement-lines`, { params }),
  addLine: (id: string, row: { date: string; description: string; amount: number; reference?: string }) => apiClient.post(`${base}/${id}/statement-lines`, row),
  importLines: (id: string, rows: { date: string; description: string; amount: number; reference?: string }[]): Promise<AxiosResponse<Ok<{ added: number; duplicates: number; invalid: number }>>> =>
    apiClient.post(`${base}/${id}/statement-lines/import`, { rows }),
  deleteLine: (id: string, lineId: string) => apiClient.delete(`${base}/${id}/statement-lines/${lineId}`),
  match: (id: string, lineId: string, lines: string[]) => apiClient.post(`${base}/${id}/statement-lines/${lineId}/match`, { lines }),
  unmatch: (id: string, lineId: string) => apiClient.post(`${base}/${id}/statement-lines/${lineId}/unmatch`),
  ignore: (id: string, lineId: string, ignore: boolean) => apiClient.post(`${base}/${id}/statement-lines/${lineId}/ignore`, { ignore }),
  createEntry: (id: string, lineId: string, account: string, memo?: string) => apiClient.post(`${base}/${id}/statement-lines/${lineId}/entry`, { account, memo }),
  bookLines: (id: string, params?: { uncleared?: boolean }): Promise<AxiosResponse<Ok<BookLine[]>>> =>
    apiClient.get(`${base}/${id}/book-lines`, { params: { uncleared: params?.uncleared ? 'true' : undefined } }),
  reconciliation: (id: string): Promise<AxiosResponse<Ok<{ open: ReconciliationView | null; lastClosed: ReconciliationView['reconciliation'] | null }>>> =>
    apiClient.get(`${base}/${id}/reconciliation`),
  startReconciliation: (id: string, data: { statementDate: string; statementEndingBalance: number; openingBalance?: number }): Promise<AxiosResponse<Ok<ReconciliationView>>> =>
    apiClient.post(`${base}/${id}/reconciliation`, data),
  closeReconciliation: (id: string, recId: string): Promise<AxiosResponse<Ok<ReconciliationView>>> => apiClient.post(`${base}/${id}/reconciliation/${recId}/close`),
};
