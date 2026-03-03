export type AnalyticsEventName =
    | 'asset_updated'
    | 'iframe_updated'
    | 'job_started'
    | 'job_completed'
    | 'job_failed'
    | 'batch_started'
    | 'asset_download_failed'
    | 'history_delete_failed'
    | 'client_error'
    | 'release_smoke_passed'
    | 'release_smoke_failed';

export interface ReleaseHealthSnapshot {
    timestamp: string;
    url: string;
    httpStatus: number;
    mode: 'auth_gate' | 'workspace' | 'unknown';
    checks: {
        hasMonitor: boolean;
        hasAssets: boolean;
        hasHistory: boolean;
        hasFatalFallback: boolean;
    };
    passed: boolean;
    notes?: string[];
}
