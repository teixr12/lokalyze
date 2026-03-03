import React from 'react';
import { cn } from '../primitives';

interface BadgeProps {
    tone?: 'neutral' | 'info' | 'success' | 'warning' | 'error';
    className?: string;
    children: React.ReactNode;
}

const toneClasses: Record<NonNullable<BadgeProps['tone']>, string> = {
    neutral: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300',
    info: 'bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-300',
    success: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300',
    warning: 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300',
    error: 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300',
};

export const Badge: React.FC<BadgeProps> = ({ tone = 'neutral', className, children }) => (
    <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest', toneClasses[tone], className)}>
        {children}
    </span>
);

