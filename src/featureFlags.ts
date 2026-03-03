const ROLLOUT_ID_KEY = 'lokalyze_rollout_id';

const toBool = (value: string | undefined, fallback: boolean): boolean => {
    if (value === undefined) return fallback;
    return value === '1' || value.toLowerCase() === 'true';
};

const toPercent = (value: string | undefined, fallback: number): number => {
    if (!value) return fallback;
    const parsed = Number(value);
    if (Number.isNaN(parsed)) return fallback;
    return Math.max(0, Math.min(100, parsed));
};

const hashToBucket = (input: string): number => {
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
        hash = ((hash << 5) - hash) + input.charCodeAt(i);
        hash |= 0;
    }
    return Math.abs(hash) % 100;
};

const getStableClientId = (): string => {
    if (typeof window === 'undefined') return 'server';
    const existing = localStorage.getItem(ROLLOUT_ID_KEY);
    if (existing) return existing;
    const value = `local_${Math.random().toString(36).substring(2, 10)}`;
    localStorage.setItem(ROLLOUT_ID_KEY, value);
    return value;
};

export interface UiFlags {
    base: boolean;
    auth: boolean;
    shell: boolean;
    editor: boolean;
    selector: boolean;
    monitor: boolean;
    jobDetail: boolean;
    assets: boolean;
    history: boolean;
    settings: boolean;
    onboarding: boolean;
    canaryBucket: number;
    canaryPassed: boolean;
}

export const resolveUiFlags = (userId?: string | null): UiFlags => {
    const enabled = toBool(import.meta.env.VITE_UI_V2_ENABLED, false);
    const canaryPercent = toPercent(import.meta.env.VITE_UI_V2_CANARY_PERCENT, 0);
    const canarySeed = userId || getStableClientId();
    const canaryBucket = hashToBucket(canarySeed);
    const canaryPassed = enabled && canaryBucket < canaryPercent;

    if (!enabled || !canaryPassed) {
        return {
            base: false,
            auth: false,
            shell: false,
            editor: false,
            selector: false,
            monitor: false,
            jobDetail: false,
            assets: false,
            history: false,
            settings: false,
            onboarding: false,
            canaryBucket,
            canaryPassed,
        };
    }

    return {
        base: true,
        auth: true,
        shell: true,
        editor: true,
        selector: true,
        monitor: toBool(import.meta.env.VITE_UI_V2_MONITOR, true),
        jobDetail: toBool(import.meta.env.VITE_UI_V2_MONITOR, true),
        assets: toBool(import.meta.env.VITE_UI_V2_ASSETS, true),
        history: toBool(import.meta.env.VITE_UI_V2_HISTORY, true),
        settings: true,
        onboarding: toBool(import.meta.env.VITE_UI_V2_ONBOARDING, true),
        canaryBucket,
        canaryPassed,
    };
};

