import type { AnalyticsEventName } from './analyticsTypes';

type AnalyticsProps = Record<string, unknown>;

interface AnalyticsProvider {
    track: (event: string, props?: AnalyticsProps) => void | Promise<void>;
    identify: (userId: string, traits?: AnalyticsProps) => void | Promise<void>;
    group: (groupId: string, traits?: AnalyticsProps) => void | Promise<void>;
    page: (route: string, props?: AnalyticsProps) => void | Promise<void>;
}

interface AnalyticsWindow extends Window {
    __lokalyzeAnalytics?: {
        track?: (event: string, props?: AnalyticsProps) => void;
        identify?: (userId: string, traits?: AnalyticsProps) => void;
        group?: (groupId: string, traits?: AnalyticsProps) => void;
        page?: (route: string, props?: AnalyticsProps) => void;
    };
}

const toBool = (value: string | undefined, fallback = false): boolean => {
    if (value === undefined) return fallback;
    return value === '1' || value.toLowerCase() === 'true';
};

const callSafely = async (fn: () => void | Promise<void>) => {
    try {
        await fn();
    } catch {
        // Never break app flow due to analytics provider failures.
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

const providers: AnalyticsProvider[] = (() => {
    const list: AnalyticsProvider[] = [createInternalProvider()];
    const posthogProvider = createPosthogProvider();
    if (posthogProvider) list.push(posthogProvider);
    return list;
})();

const fanOut = async (
    method: keyof AnalyticsProvider,
    ...args: [string, AnalyticsProps?]
) => {
    await Promise.all(providers.map((provider) => callSafely(() => provider[method](args[0], args[1]))));
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
