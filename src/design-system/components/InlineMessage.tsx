import React from 'react';
import { cn } from '../primitives';

interface InlineMessageProps {
    tone?: 'info' | 'success' | 'warning' | 'error';
    children: React.ReactNode;
    className?: string;
}

const toneClasses: Record<NonNullable<InlineMessageProps['tone']>, string> = {
    info: 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-300',
    success: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300',
    warning: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300',
    error: 'border-red-200 bg-red-50 text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300',
};

export const InlineMessage: React.FC<InlineMessageProps> = ({ tone = 'info', className, children }) => (
    <div className={cn('rounded-xl border px-3 py-2 text-[11px]', toneClasses[tone], className)}>
        {children}
    </div>
);

