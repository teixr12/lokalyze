export type AnalyticsEventName =
    | 'sign_up'
    | 'login'
    | 'logout'
    | 'asset_updated'
    | 'asset_override_applied'
    | 'iframe_updated'
    | 'job_started'
    | 'job_completed'
    | 'job_failed'
    | 'job_detail_toggled'
    | 'job_detail_open_latency'
    | 'batch_started'
    | 'batch_clicked'
    | 'panel_opened'
    | 'history_action'
    | 'first_value_action'
    | 'time_to_first_action'
    | 'tab_switch_latency'
    | 'api_error'
    | 'latency_bucket'
    | 'projects_shadow_drift'
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
