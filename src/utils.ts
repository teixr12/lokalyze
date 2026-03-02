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
export const Analytics = {
    track: (event: string, props: Record<string, unknown> = {}) => {
        if (import.meta.env.DEV) {
            console.debug(`[Analytics] ${event}`, props);
        }
    },
    identify: (_userId: string) => {
        // posthog.identify(userId)
    }
};
