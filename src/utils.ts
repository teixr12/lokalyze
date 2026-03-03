import type { AnalyticsEventName } from './analyticsTypes';
import { analyticsAdapter } from './analyticsAdapter';

// --- UTILS ---

export const generateId = () => Math.random().toString(36).substring(2, 11);

export const cleanStreamedHtml = (text: string) => text.replace(/```html\n?|```/g, '').trim();

export const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
};

export const formatDate = (ms: number) => new Date(ms).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
});

// Safe Asset ID Generation (Handles Unicode URLs)
export const safeAssetId = (url: string) => {
    let hash = 0;
    for (let i = 0; i < url.length; i++) {
        const char = url.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32bit integer
    }
    const safeSuffix = url.slice(-15).replace(/[^a-zA-Z0-9]/g, '');
    return `asset_${Math.abs(hash)}_${safeSuffix}`;
};

// Helper to fetch image and convert to base64
export const urlToBase64 = async (url: string): Promise<{ data: string, mimeType: string }> => {
    const response = await fetch(url, { mode: 'cors' });
    if (!response.ok) throw new Error(`Failed to fetch image: ${response.statusText}`);
    const blob = await response.blob();
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            const base64String = reader.result as string;
            const base64Data = base64String.split(',')[1];
            resolve({ data: base64Data, mimeType: blob.type });
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
};

// --- ANALYTICS ADAPTER ---
const EVENT_REQUIRED_KEYS: Partial<Record<AnalyticsEventName, string[]>> = {
    asset_updated: ['assetId'],
    asset_override_applied: ['assetId', 'assetType'],
    iframe_updated: ['iframeId', 'type'],
    job_started: ['jobId', 'lang'],
    job_completed: ['jobId', 'lang'],
    job_failed: ['jobId', 'lang', 'error'],
    job_detail_toggled: ['jobId', 'action'],
    job_detail_open_latency: ['jobId', 'ms'],
    batch_started: ['projectId'],
    batch_clicked: ['selectedCount'],
    panel_opened: ['panel'],
    history_action: ['action'],
    first_value_action: ['projectId', 'jobId'],
    time_to_first_action: ['action', 'ms'],
    tab_switch_latency: ['panel', 'ms'],
    api_error: ['source', 'error'],
    latency_bucket: ['source', 'bucket'],
    asset_download_failed: ['source', 'error'],
    history_delete_failed: ['projectId', 'error'],
    client_error: ['source', 'message'],
    release_smoke_passed: ['url'],
    release_smoke_failed: ['url', 'error'],
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

const validateEventProps = (event: string, props: Record<string, unknown>): string[] => {
    const required = EVENT_REQUIRED_KEYS[event as AnalyticsEventName] || [];
    return required.filter(key => props[key] === undefined || props[key] === null || props[key] === '');
};

export const Analytics = {
    track: (event: string, props: Record<string, unknown> = {}) => {
        const eventName = typeof event === 'string' && event.trim().length > 0 ? event.trim() : 'unknown_event';
        const safeProps = isRecord(props) ? props : {};
        const missingKeys = validateEventProps(eventName, safeProps);

        if (import.meta.env.DEV && missingKeys.length > 0) {
            console.warn(`[Analytics] ${eventName} missing props`, missingKeys);
        }

        try {
            analyticsAdapter.track(eventName, safeProps);
        } catch {
            // Fail-safe analytics: never break UI flow.
        }

        if (import.meta.env.DEV) {
            console.debug(`[Analytics] ${eventName}`, safeProps);
        }
    },
    identify: (userId: string, traits: Record<string, unknown> = {}) => {
        if (!userId) return;
        try {
            analyticsAdapter.identify(userId, traits);
        } catch {
            // Fail-safe analytics: never break UI flow.
        }

        if (import.meta.env.DEV) {
            console.debug('[Analytics] identify', { userId, ...traits });
        }
    },
    group: (groupId: string, traits: Record<string, unknown> = {}) => {
        if (!groupId) return;
        try {
            analyticsAdapter.group(groupId, traits);
        } catch {
            // Fail-safe analytics: never break UI flow.
        }
    },
    page: (route: string, props: Record<string, unknown> = {}) => {
        if (!route) return;
        try {
            analyticsAdapter.page(route, props);
        } catch {
            // Fail-safe analytics: never break UI flow.
        }
    },
};
