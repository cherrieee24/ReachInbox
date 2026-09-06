import axios, { type AxiosInstance, type AxiosRequestConfig } from 'axios';
import { env } from '../config/env';
import type { ApiResponse } from '../types/api';
import { toApiError } from './errors';

/** Called when a request comes back 401 so the app can clear its session. */
type UnauthorizedHandler = () => void;

let onUnauthorized: UnauthorizedHandler | null = null;

export function setUnauthorizedHandler(handler: UnauthorizedHandler | null): void {
  onUnauthorized = handler;
}

/**
 * Optional bearer token, held in memory only — never localStorage, so an XSS
 * payload cannot read it. Unused by the browser app, which authenticates with
 * the httpOnly session cookie.
 */
let authToken: string | null = null;

export function setAuthToken(token: string | null): void {
  authToken = token;
}

/**
 * The session travels as an httpOnly cookie set by the backend, so the browser
 * never holds a token in JavaScript-readable storage. `withCredentials` is what
 * makes that cookie ride along with every request.
 */
export const apiClient: AxiosInstance = axios.create({
  baseURL: env.apiUrl,
  timeout: 20_000,
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
});

/**
 * Request: failures here are client-side (a bad config, a serialisation error,
 * an aborted request) — normalise them so callers only ever catch an ApiError.
 *
 * No Authorization header is attached: the session is an httpOnly cookie the
 * browser sends automatically, and a token in JS-readable storage would be
 * strictly less secure. `setAuthToken` exists for future non-cookie callers
 * (a CLI or server-to-server key) without changing this contract.
 */
apiClient.interceptors.request.use(
  (config) => {
    if (authToken) config.headers.set('Authorization', `Bearer ${authToken}`);
    return config;
  },
  (error: unknown) => Promise.reject(toApiError(error)),
);

// Normalise every failure into an ApiError, and surface 401s to the app once.
apiClient.interceptors.response.use(
  (response) => response,
  (error: unknown) => {
    const apiError = toApiError(error);
    if (apiError.kind === 'unauthorized') onUnauthorized?.();
    return Promise.reject(apiError);
  },
);

/**
 * Thin typed helpers over the axios instance. Services call these rather than
 * axios directly so the `ApiResponse` envelope is unwrapped in exactly one place.
 */
export const http = {
  async get<TData>(url: string, config?: AxiosRequestConfig): Promise<ApiResponse<TData>> {
    const { data } = await apiClient.get<ApiResponse<TData>>(url, config);
    return data;
  },

  async post<TData, TBody = unknown>(
    url: string,
    body?: TBody,
    config?: AxiosRequestConfig,
  ): Promise<ApiResponse<TData>> {
    const { data } = await apiClient.post<ApiResponse<TData>>(url, body, config);
    return data;
  },

  async patch<TData, TBody = unknown>(
    url: string,
    body?: TBody,
    config?: AxiosRequestConfig,
  ): Promise<ApiResponse<TData>> {
    const { data } = await apiClient.patch<ApiResponse<TData>>(url, body, config);
    return data;
  },

  async delete<TData>(url: string, config?: AxiosRequestConfig): Promise<ApiResponse<TData>> {
    const { data } = await apiClient.delete<ApiResponse<TData>>(url, config);
    return data;
  },
};
