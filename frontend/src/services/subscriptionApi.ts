import { AxiosResponse } from 'axios';
import apiClient from './api';
import type {
  ChargeStatusFilter, SubscriptionCharge, SubscriptionChargesPage, SubscriptionOverview, SubscriptionProduct, TenantCatalog,
} from '../types/subscription';

interface Ok<T> { success: true; data: T }

/** The tenant's own Pilloto subscription — backend routes/subscription.ts. */
export const subscriptionService = {
  overview: (): Promise<AxiosResponse<Ok<SubscriptionOverview>>> => apiClient.get('/subscription'),
  catalog: (): Promise<AxiosResponse<Ok<TenantCatalog>>> => apiClient.get('/subscription/catalog'),
  changePlan: (product: SubscriptionProduct, plan: string): Promise<AxiosResponse<Ok<{ outcome: 'upgraded' | 'changed' | 'scheduled' | 'unscheduled'; overview: SubscriptionOverview }>>> =>
    apiClient.post('/subscription/change', { product, plan }),
  addProduct: (product: SubscriptionProduct, plan: string): Promise<AxiosResponse<Ok<SubscriptionOverview>>> =>
    apiClient.post('/subscription/products', { product, plan }),
  cancelProduct: (product: SubscriptionProduct): Promise<AxiosResponse<Ok<SubscriptionOverview>>> =>
    apiClient.delete(`/subscription/products/${product}`),
  keepProduct: (product: SubscriptionProduct): Promise<AxiosResponse<Ok<SubscriptionOverview>>> =>
    apiClient.post(`/subscription/products/${product}/keep`),
  setBillingEmail: (billingEmail: string): Promise<AxiosResponse<Ok<SubscriptionOverview>>> =>
    apiClient.put('/subscription/billing-email', { billingEmail }),
  charges: (params: { page?: number; limit?: number; status?: ChargeStatusFilter; search?: string } = {}): Promise<AxiosResponse<SubscriptionChargesPage>> =>
    apiClient.get('/subscription/charges', { params }),
  charge: (id: string): Promise<AxiosResponse<Ok<SubscriptionCharge>>> => apiClient.get(`/subscription/charges/${id}`),
  pay: (id: string, returnUrl: string): Promise<AxiosResponse<Ok<{ url: string; sessionId: string }>>> =>
    apiClient.post(`/subscription/charges/${id}/pay`, { returnUrl }),
  confirm: (sessionId: string): Promise<AxiosResponse<Ok<{ outcome: string }>>> =>
    apiClient.post(`/subscription/online-payments/${encodeURIComponent(sessionId)}/confirm`),
  ecfPdf: (paymentId: string): Promise<AxiosResponse<Blob>> => apiClient.get(`/subscription/payments/${paymentId}/ecf/pdf`, { responseType: 'blob' }),
};
