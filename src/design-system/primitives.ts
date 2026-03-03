import type { ToastVariant } from '../uiTypes';

export const cn = (...parts: Array<string | false | null | undefined>) =>
    parts.filter(Boolean).join(' ');

export const toastVariantStyles: Record<ToastVariant, string> = {
    info: 'bg-sky-600 text-white border-sky-400/40',
    success: 'bg-emerald-600 text-white border-emerald-400/40',
    warning: 'bg-amber-600 text-white border-amber-400/40',
    error: 'bg-red-600 text-white border-red-400/40',
};

export const statusVariantStyles = {
    queued: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
    translating: 'bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300',
    completed: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300',
    error: 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300',
    stopped: 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300',
} as const;

