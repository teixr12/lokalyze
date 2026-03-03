import React from 'react';
import { cn } from '../primitives';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: ButtonVariant;
    loading?: boolean;
}

const variantClasses: Record<ButtonVariant, string> = {
    primary: 'bg-violet-600 hover:bg-violet-700 text-white shadow-lg shadow-violet-500/20',
    secondary: 'bg-zinc-100 hover:bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:hover:bg-zinc-700 dark:text-zinc-200',
    ghost: 'bg-transparent hover:bg-zinc-100 text-zinc-600 dark:hover:bg-zinc-800 dark:text-zinc-300',
    danger: 'bg-red-600 hover:bg-red-700 text-white shadow-lg shadow-red-500/20',
};

export const Button: React.FC<ButtonProps> = ({
    variant = 'secondary',
    loading = false,
    className,
    disabled,
    children,
    ...props
}) => (
    <button
        {...props}
        disabled={disabled || loading}
        className={cn(
            'lk-focus-visible inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-[11px] font-bold uppercase tracking-widest transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
            variantClasses[variant],
            className
        )}
    >
        {loading ? <span className="animate-spin">⏳</span> : null}
        {children}
    </button>
);

