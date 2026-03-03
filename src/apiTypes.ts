import type { Project } from './types';

export type DataProviderMode = 'client' | 'proxy';

export interface ProjectApiEnvelope<T> {
    data: T;
    requestId: string;
    source: 'proxy' | 'client';
}

export interface TenantContext {
    userId: string;
    tenantId: string;
}

export interface AnalyticsDeliveryResult {
    provider: 'internal' | 'posthog';
    ok: boolean;
    event: string;
}

export interface ProxySaveProjectPayload {
    project: Project;
}

