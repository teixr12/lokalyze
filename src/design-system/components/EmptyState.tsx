import React from 'react';
import type { EmptyStateConfig } from '../../uiTypes';
import { Button } from './Button';

interface EmptyStateProps extends EmptyStateConfig {
    icon?: React.ReactNode;
    onCta?: () => void;
}

export const EmptyState: React.FC<EmptyStateProps> = ({ title, body, ctaLabel, onCta, icon }) => (
    <div className="flex h-full min-h-[220px] flex-col items-center justify-center rounded-3xl border-2 border-dashed border-zinc-200 p-8 text-center dark:border-zinc-800">
        <div className="mb-4 text-zinc-400">{icon}</div>
        <p className="text-xs font-bold uppercase tracking-widest text-zinc-500">{title}</p>
        <p className="mt-2 max-w-sm text-[11px] text-zinc-500">{body}</p>
        {ctaLabel && onCta ? (
            <Button className="mt-4" variant="secondary" onClick={onCta}>
                {ctaLabel}
            </Button>
        ) : null}
    </div>
);

