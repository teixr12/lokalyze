// --- TYPES (DOMAIN ENTITIES) ---

export interface TranslationJob {
    id: string;
    lang: string;
    translatedHtml: string;
    status: 'queued' | 'translating' | 'completed' | 'error' | 'stopped';
    progress: number;
    error?: string;
    startTime: number;
    endTime?: number;
    tokenCount: number;
    viewMode: 'code' | 'preview';
}

export interface ImageAsset {
    originalUrl: string;
    replacementUrl: string;
    id: string;
    index: number;
}

export interface IframeAsset {
    originalUrl: string;
    replacementUrl: string;
    htmlContent: string;
    id: string;
    index: number;
}

export interface Project {
    id: string;
    name: string;
    createdAt: number;
    lastModified: number;
    sourceHtml: string;
    globalCss: string;
    detectedImages: ImageAsset[];
    detectedIframes?: IframeAsset[];
    jobs: Record<string, TranslationJob>;
    selectedLangs: string[];
    userId?: string; // Set when synced to Supabase cloud storage
}
