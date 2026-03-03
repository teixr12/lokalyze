import type { AnalyticsEventName } from './analyticsTypes';
import type { AnalyticsDeliveryResult } from './apiTypes';

type AnalyticsProps = Record<string, unknown>;

interface AnalyticsProvider {
    track: (event: string, props?: AnalyticsProps) => void | Promise<void>;
    identify: (userId: string, traits?: AnalyticsProps) => void | Promise<void>;
    group: (groupId: string, traits?: AnalyticsProps) => void | Promise<void>;
    page: (route: string, props?: AnalyticsProps) => void | Promise<void>;
}

interface AnalyticsProviderEntry {
    name: AnalyticsDeliveryResult['provider'];
    provider: AnalyticsProvider;
}

interface AnalyticsWindow extends Window {
    __lokalyzeAnalytics?: {
        track?: (event: string, props?: AnalyticsProps) => void;
        identify?: (userId: string, traits?: AnalyticsProps) => void;
        group?: (groupId: string, traits?: AnalyticsProps) => void;
        page?: (route: string, props?: AnalyticsProps) => void;
    };
    __lokalyzeAnalyticsDelivery?: AnalyticsDeliveryResult[];
}

const toBool = (value: string | undefined, fallback = false): boolean => {
    if (value === undefined) return fallback;
    return value === '1' || value.toLowerCase() === 'true';
};

const callSafely = async (fn: () => void | Promise<void>): Promise<boolean> => {
    try {
        await fn();
        return true;
    } catch {
        // Never break app flow due to analytics provider failures.
        return false;
    }
};

const createInternalProvider = (): AnalyticsProvider => ({
    track: (event, props = {}) => {
        const hook = (window as AnalyticsWindow).__lokalyzeAnalytics;
        hook?.track?.(event, props);
    },
    identify: (userId, traits = {}) => {
        const hook = (window as AnalyticsWindow).__lokalyzeAnalytics;
        hook?.identify?.(userId, traits);
    },
    group: (groupId, traits = {}) => {
        const hook = (window as AnalyticsWindow).__lokalyzeAnalytics;
        if (hook?.group) {
            hook.group(groupId, traits);
            return;
        }
        // Fallback for legacy internal hooks without `group`.
        hook?.identify?.(`group:${groupId}`, traits);
    },
    page: (route, props = {}) => {
        const hook = (window as AnalyticsWindow).__lokalyzeAnalytics;
        if (hook?.page) {
            hook.page(route, props);
            return;
        }
        hook?.track?.('page_view', { route, ...props });
    },
});

const createPosthogProvider = (): AnalyticsProvider | null => {
    const enabled = toBool(import.meta.env.VITE_ANALYTICS_EXTERNAL_V1, false);
    const apiKey = import.meta.env.VITE_POSTHOG_KEY || '';
    const apiHost = import.meta.env.VITE_POSTHOG_HOST || '';

    if (!enabled || !apiKey || !apiHost) return null;

    let clientPromise: Promise<any> | null = null;

    const getClient = async () => {
        if (!clientPromise) {
            clientPromise = import('posthog-js')
                .then((module) => {
                    const posthog = module.default;
                    posthog.init(apiKey, {
                        api_host: apiHost,
                        autocapture: true,
                        capture_pageview: false,
                        capture_pageleave: true,
                    });
                    return posthog;
                })
                .catch(() => null);
        }

        return clientPromise;
    };

    return {
        track: async (event, props = {}) => {
            const client = await getClient();
            client?.capture?.(event, props);
        },
        identify: async (userId, traits = {}) => {
            const client = await getClient();
            client?.identify?.(userId, traits);
        },
        group: async (groupId, traits = {}) => {
            const client = await getClient();
            client?.group?.('workspace', groupId, traits);
        },
        page: async (route, props = {}) => {
            const client = await getClient();
            client?.capture?.('$pageview', { route, ...props });
        },
    };
};

const providers: AnalyticsProviderEntry[] = (() => {
    const list: AnalyticsProviderEntry[] = [{ name: 'internal', provider: createInternalProvider() }];
    const posthogProvider = createPosthogProvider();
    if (posthogProvider) list.push({ name: 'posthog', provider: posthogProvider });
    return list;
})();

const recordDeliveryResults = (results: AnalyticsDeliveryResult[]) => {
    const hook = (window as AnalyticsWindow).__lokalyzeAnalyticsDelivery;
    if (Array.isArray(hook)) {
        hook.push(...results);
        if (hook.length > 200) {
            hook.splice(0, hook.length - 200);
        }
        return;
    }

    (window as AnalyticsWindow).__lokalyzeAnalyticsDelivery = [...results];
};

const fanOut = async (
    method: keyof AnalyticsProvider,
    ...args: [string, AnalyticsProps?]
) => {
    const results = await Promise.all(providers.map(async ({ name, provider }) => {
        const ok = await callSafely(() => provider[method](args[0], args[1]));
        return { provider: name, ok, event: args[0] } as AnalyticsDeliveryResult;
    }));
    recordDeliveryResults(results);
};

export const analyticsAdapter = {
    track: (event: AnalyticsEventName | string, props: AnalyticsProps = {}) => {
        void fanOut('track', event, props);
    },
    identify: (userId: string, traits: AnalyticsProps = {}) => {
        if (!userId) return;
        void fanOut('identify', userId, traits);
    },
    group: (groupId: string, traits: AnalyticsProps = {}) => {
        if (!groupId) return;
        void fanOut('group', groupId, traits);
    },
    page: (route: string, props: AnalyticsProps = {}) => {
        if (!route) return;
        void fanOut('page', route, props);
    },
};
