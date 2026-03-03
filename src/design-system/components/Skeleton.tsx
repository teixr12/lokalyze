import React from 'react';
import { cn } from '../primitives';

interface SkeletonProps {
    variant?: 'line' | 'card' | 'panel';
    className?: string;
}

const variantClasses: Record<NonNullable<SkeletonProps['variant']>, string> = {
    line: 'h-4 w-full rounded',
    card: 'h-24 w-full rounded-2xl',
    panel: 'h-40 w-full rounded-3xl',
};

export const Skeleton: React.FC<SkeletonProps> = ({ variant = 'line', className }) => (
    <div
        aria-hidden="true"
        className={cn('animate-pulse bg-zinc-200 dark:bg-zinc-800', variantClasses[variant], className)}
    />
);

