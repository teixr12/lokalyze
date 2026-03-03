import type { DataProviderMode } from './apiTypes';

const toBool = (value: string | undefined, fallback = false): boolean => {
    if (value === undefined) return fallback;
    return value === '1' || value.toLowerCase() === 'true';
};

const normalizeMode = (value: string | undefined): DataProviderMode => {
    if (!value) return 'client';
    return value.toLowerCase() === 'proxy' ? 'proxy' : 'client';
};

export const getDataProviderMode = (): DataProviderMode =>
    normalizeMode(import.meta.env.VITE_DATA_PROVIDER);

export const isProxyShadowReadEnabled = (): boolean =>
    toBool(import.meta.env.VITE_DATA_PROVIDER_SHADOW_READ, true);

export const canFallbackToClientProvider = (): boolean =>
    toBool(import.meta.env.VITE_DATA_PROVIDER_FALLBACK_CLIENT, false);

export const getProxyProjectsUrl = (): string =>
    (import.meta.env.VITE_PROXY_PROJECTS_URL || '/api/projects').replace(/\/+$/, '');

