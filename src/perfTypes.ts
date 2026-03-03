export interface PerfBudgetSnapshot {
    bundleBytes: number;
    initialRenderMs: number;
    tabSwitchMs: number;
}

export type UiInteractionEventName =
    | 'panel_opened'
    | 'batch_clicked'
    | 'job_detail_toggled'
    | 'asset_override_applied'
    | 'history_action';
