export type ToastVariant = 'info' | 'success' | 'warning' | 'error';

export interface ToastMessage {
    id: string;
    message: string;
    type: ToastVariant;
}

export interface EmptyStateConfig {
    title: string;
    body: string;
    ctaLabel?: string;
}

export interface LoadingState {
    ariaBusy: boolean;
    skeletonVariant: 'line' | 'card' | 'panel';
}

