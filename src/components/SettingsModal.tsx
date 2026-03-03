import React, { useEffect, useMemo, useState } from 'react';
import Icons from './Icons';
import { User } from 'firebase/auth';
import { InlineMessage } from '../design-system/components/InlineMessage';

interface SettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
    userApiKey: string;
    onApiKeyChange: (key: string) => void;
    onSave: (key: string) => void;
    user: User | null;
    onLogout: () => void;
    v2Enabled?: boolean;
}

const SettingsModal: React.FC<SettingsModalProps> = ({
    isOpen,
    onClose,
    userApiKey,
    onApiKeyChange,
    onSave,
    user,
    onLogout,
    v2Enabled = false,
}) => {
    const [saveState, setSaveState] = useState<'idle' | 'saved'>('idle');

    useEffect(() => {
        if (!isOpen) setSaveState('idle');
    }, [isOpen]);

    const isApiKeyValid = useMemo(() => {
        if (!v2Enabled) return true;
        if (!userApiKey.trim()) return true;
        return userApiKey.trim().startsWith('AIza') && userApiKey.trim().length >= 20;
    }, [userApiKey, v2Enabled]);

    const keyModeLabel = userApiKey.trim() ? 'Using personal API key' : 'Using environment default API key';

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/60 backdrop-blur-sm" aria-modal="true" role="dialog">
            <div className="bg-white dark:bg-[#121212] w-full max-w-md rounded-3xl border border-zinc-200 dark:border-white/10 shadow-2xl overflow-hidden flex flex-col">
                <div className="p-6 border-b border-zinc-100 dark:border-white/5 flex items-center justify-between">
                    <h2 className="text-sm font-black uppercase tracking-widest text-zinc-900 dark:text-white flex items-center gap-2">
                        <Icons.Settings /> Settings
                    </h2>
                    <button aria-label="Close settings" onClick={onClose} className="lk-focus-visible text-zinc-400 hover:text-zinc-900 dark:hover:text-white transition-colors">
                        <Icons.Close />
                    </button>
                </div>
                <div className="p-6 flex flex-col gap-6">
                    <div className="flex flex-col gap-2">
                        <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Gemini API Key</label>
                        <input
                            type="password"
                            value={userApiKey}
                            onChange={(e) => onApiKeyChange(e.target.value)}
                            placeholder="AIzaSy..."
                            className={`w-full bg-zinc-50 dark:bg-black px-4 py-3 rounded-xl text-sm border transition-all font-mono ${isApiKeyValid ? 'border-zinc-200 dark:border-zinc-800 focus:border-violet-500' : 'border-red-400 dark:border-red-500/60'}`}
                        />
                        {v2Enabled ? <p className="text-[10px] text-zinc-400 mt-1">{keyModeLabel}</p> : null}
                        {v2Enabled && !isApiKeyValid ? (
                            <InlineMessage tone="error">
                                Invalid Gemini API key format. Expected key prefix <code>AIza</code>.
                            </InlineMessage>
                        ) : null}
                        {v2Enabled && saveState === 'saved' ? (
                            <InlineMessage tone="success">
                                Settings saved successfully.
                            </InlineMessage>
                        ) : null}
                    </div>

                    {user && (
                        <div className="flex flex-col gap-2 pt-4 border-t border-zinc-100 dark:border-white/5">
                            <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Account</label>
                            <div className="flex items-center justify-between bg-zinc-50 dark:bg-black p-3 rounded-xl border border-zinc-200 dark:border-zinc-800">
                                <div className="flex items-center gap-3">
                                    {user.photoURL ? (
                                        <img src={user.photoURL} alt="Avatar" className="w-8 h-8 rounded-full" referrerPolicy="no-referrer" />
                                    ) : (
                                        <div className="w-8 h-8 rounded-full bg-violet-500/20 text-violet-500 flex items-center justify-center"><Icons.User /></div>
                                    )}
                                    <div className="flex flex-col">
                                        <span className="text-xs font-bold text-zinc-900 dark:text-white">{user.displayName || 'User'}</span>
                                        <span className="text-[10px] text-zinc-500">{user.email}</span>
                                    </div>
                                </div>
                                <button onClick={onLogout} className="text-[10px] font-bold uppercase tracking-widest text-red-500 hover:text-red-600 px-3 py-1.5 bg-red-500/10 rounded-lg transition-colors">
                                    Sign Out
                                </button>
                            </div>
                        </div>
                    )}
                </div>
                <div className="p-6 border-t border-zinc-100 dark:border-white/5 flex justify-end gap-3 bg-zinc-50/50 dark:bg-black/20">
                    <button onClick={onClose} className="lk-focus-visible px-5 py-2.5 rounded-xl text-[11px] font-bold uppercase tracking-widest text-zinc-500 hover:text-zinc-900 dark:hover:text-white transition-colors">
                        Cancel
                    </button>
                    <button
                        onClick={() => {
                            onSave(userApiKey);
                            setSaveState('saved');
                        }}
                        disabled={v2Enabled && !isApiKeyValid}
                        className="lk-focus-visible px-5 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-[11px] font-bold uppercase tracking-widest transition-colors shadow-lg shadow-violet-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        Save Changes
                    </button>
                </div>
            </div>
        </div>
    );
};

export default SettingsModal;
