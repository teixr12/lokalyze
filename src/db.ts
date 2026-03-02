import { DB_CONFIG } from './constants';
import type { Project } from './types';
import { cloudHelper, isSupabaseConfigured } from './supabase';

// --- DATABASE ADAPTER (INDEXED DB) ---
export const dbHelper = {
    open: () => {
        return new Promise<IDBDatabase>((resolve, reject) => {
            const request = indexedDB.open(DB_CONFIG.NAME, DB_CONFIG.VERSION);
            request.onupgradeneeded = (event) => {
                const db = (event.target as IDBOpenDBRequest).result;
                if (!db.objectStoreNames.contains(DB_CONFIG.STORE)) {
                    db.createObjectStore(DB_CONFIG.STORE, { keyPath: 'id' });
                }
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    },
    save: async (project: Project) => {
        try {
            const db = await dbHelper.open();
            return new Promise<void>((resolve, reject) => {
                const tx = db.transaction(DB_CONFIG.STORE, 'readwrite');
                const store = tx.objectStore(DB_CONFIG.STORE);
                store.put(project);
                tx.oncomplete = () => { db.close(); resolve(); };
                tx.onerror = () => { db.close(); reject(tx.error); };
            });
        } catch (e) {
            console.error("DB Save Failed", e);
        }
    },
    getAll: async () => {
        try {
            const db = await dbHelper.open();
            return new Promise<Project[]>((resolve, reject) => {
                const tx = db.transaction(DB_CONFIG.STORE, 'readonly');
                const store = tx.objectStore(DB_CONFIG.STORE);
                const request = store.getAll();
                request.onsuccess = () => {
                    db.close();
                    const res = request.result as Project[];
                    resolve(res.sort((a, b) => b.createdAt - a.createdAt));
                };
                request.onerror = () => { db.close(); reject(request.error); };
            });
        } catch (e) {
            console.error("DB Load Failed", e);
            return [];
        }
    },
    delete: async (id: string) => {
        const db = await dbHelper.open();
        return new Promise<void>((resolve, reject) => {
            const tx = db.transaction(DB_CONFIG.STORE, 'readwrite');
            const store = tx.objectStore(DB_CONFIG.STORE);
            store.delete(id);
            tx.oncomplete = () => { db.close(); resolve(); };
            tx.onerror = () => { db.close(); reject(tx.error); };
        });
    }
};

// --- HYBRID DB ADAPTER ---
// When user is logged in + Supabase is configured → use cloud storage
// Otherwise → fall back to IndexedDB (local only)
export const hybridDb = {
    getAll: async (userId?: string | null): Promise<Project[]> => {
        if (isSupabaseConfigured && userId) {
            return cloudHelper.getAll(userId);
        }
        return dbHelper.getAll();
    },
    save: async (project: Project, userId?: string | null): Promise<void> => {
        // Always save to IndexedDB for offline support
        await dbHelper.save(project);
        // Also save to cloud if logged in
        if (isSupabaseConfigured && userId) {
            await cloudHelper.save(project, userId);
        }
    },
    delete: async (id: string, userId?: string | null): Promise<void> => {
        await dbHelper.delete(id);
        if (isSupabaseConfigured && userId) {
            await cloudHelper.delete(id, userId);
        }
    },
};
