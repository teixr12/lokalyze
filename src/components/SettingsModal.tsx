import React from 'react';
import Icons from './Icons';
import { User } from 'firebase/auth';

interface SettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
    userApiKey: string;
    onApiKeyChange: (key: string) => void;
    onSave: (key: string) => void;
    user: User | null;
    onLogout: () => void;
}

const SettingsModal: React.FC<SettingsModalProps> = ({
    isOpen,
    onClose,
    userApiKey,
    onApiKeyChange,
    onSave,
    user,
    onLogout,
}) => {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/60 backdrop-blur-sm">
            <div className="bg-white dark:bg-[#121212] w-full max-w-md rounded-3xl border border-zinc-200 dark:border-white/10 shadow-2xl overflow-hidden flex flex-col">
                <div className="p-6 border-b border-zinc-100 dark:border-white/5 flex items-center justify-between">
                    <h2 className="text-sm font-black uppercase tracking-widest text-zinc-900 dark:text-white flex items-center gap-2">
                        <Icons.Settings /> Settings
                    </h2>
                    <button onClick={onClose} className="text-zinc-400 hover:text-zinc-900 dark:hover:text-white transition-colors">
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
                            className="w-full bg-zinc-50 dark:bg-black px-4 py-3 rounded-xl text-sm border border-zinc-200 dark:border-zinc-800 focus:border-violet-500 outline-none transition-all font-mono"
                        />
                        <p className="text-[10px] text-zinc-400 mt-1">Leave blank to use the default environment API key.</p>
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
                    <button onClick={onClose} className="px-5 py-2.5 rounded-xl text-[11px] font-bold uppercase tracking-widest text-zinc-500 hover:text-zinc-900 dark:hover:text-white transition-colors">
                        Cancel
                    </button>
                    <button onClick={() => onSave(userApiKey)} className="px-5 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-[11px] font-bold uppercase tracking-widest transition-colors shadow-lg shadow-violet-500/20">
                        Save Changes
                    </button>
                </div>
            </div>
        </div>
    );
};

export default SettingsModal;
