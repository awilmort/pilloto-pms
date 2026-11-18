import { AxiosResponse } from 'axios';
import apiClient from './api';

interface Ok<T> { success: true; data: T }
export interface ExchangeRateRow { _id: string; currency: 'USD' | 'EUR'; date: string; rate: number }

/** Exchange rates — backend routes/accounting/exchangeRates.routes.ts (multi-currency module). */
export const fxService = {
  list: (currency?: string): Promise<AxiosResponse<Ok<ExchangeRateRow[]>>> => apiClient.get('/accounting/exchange-rates', { params: { currency } }),
  latest: (currency: string, date?: string): Promise<AxiosResponse<Ok<{ currency: string; rate: number | null }>>> =>
    apiClient.get('/accounting/exchange-rates/latest', { params: { currency, date } }),
  set: (currency: string, date: string, rate: number) => apiClient.post('/accounting/exchange-rates', { currency, date, rate }),
};
