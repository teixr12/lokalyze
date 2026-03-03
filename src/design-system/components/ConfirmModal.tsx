import React from 'react';
import { Button } from './Button';
import Icons from '../../components/Icons';

interface ConfirmModalProps {
    isOpen: boolean;
    title: string;
    description: string;
    confirmLabel?: string;
    cancelLabel?: string;
    loading?: boolean;
    onConfirm: () => void;
    onCancel: () => void;
}

export const ConfirmModal: React.FC<ConfirmModalProps> = ({
    isOpen,
    title,
    description,
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    loading = false,
    onConfirm,
    onCancel,
}) => {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 p-6 backdrop-blur-sm" role="dialog" aria-modal="true">
            <div className="w-full max-w-md overflow-hidden rounded-3xl border border-zinc-200 bg-white shadow-2xl dark:border-white/10 dark:bg-[#121212]">
                <div className="flex items-center justify-between border-b border-zinc-100 p-5 dark:border-white/5">
                    <h2 className="text-sm font-black uppercase tracking-widest text-zinc-900 dark:text-white">{title}</h2>
                    <button aria-label="Close confirmation modal" onClick={onCancel} className="lk-focus-visible text-zinc-400 hover:text-zinc-900 dark:hover:text-white">
                        <Icons.Close />
                    </button>
                </div>
                <div className="space-y-3 p-5">
                    <p className="text-sm text-zinc-600 dark:text-zinc-300">{description}</p>
                    <p className="text-[11px] text-zinc-500">This action only removes the selected project record.</p>
                </div>
                <div className="flex items-center justify-end gap-3 border-t border-zinc-100 bg-zinc-50/70 p-5 dark:border-white/5 dark:bg-black/20">
                    <Button variant="ghost" onClick={onCancel} disabled={loading}>{cancelLabel}</Button>
                    <Button variant="danger" onClick={onConfirm} loading={loading}>{confirmLabel}</Button>
                </div>
            </div>
        </div>
    );
};
