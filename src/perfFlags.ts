const toBool = (value: string | undefined, fallback = false): boolean => {
    if (value === undefined) return fallback;
    return value === '1' || value.toLowerCase() === 'true';
};

export const isPerfV1Enabled = (): boolean => toBool(import.meta.env.VITE_UI_PERF_V1, true);

export const isVirtualListsEnabled = (): boolean => toBool(import.meta.env.VITE_UI_V2_VIRTUAL_LISTS, false);
