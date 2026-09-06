/**
 * Single source of truth for build-time configuration. Nothing else in the app
 * reads `import.meta.env`, and no host or port is hardcoded outside this file.
 */
interface AppEnv {
  apiUrl: string;
  isDev: boolean;
  isProd: boolean;
}

function readApiUrl(): string {
  const value = import.meta.env.VITE_API_URL;
  if (typeof value === 'string' && value.trim()) return value.replace(/\/+$/, '');
  // Falls back to the same-origin path that the dev server proxies.
  return '/api';
}

export const env: AppEnv = {
  apiUrl: readApiUrl(),
  isDev: import.meta.env.DEV,
  isProd: import.meta.env.PROD,
};
