import { DB_CONFIG } from './constants';
import type { Project } from './types';
import { cloudHelper, isSupabaseConfigured } from './supabase';
import { auth } from './firebase';
import { Analytics } from './utils';
import {
    canFallbackToClientProvider,
    getDataProviderMode,
    getProxyProjectsUrl,
    isProxyShadowReadEnabled,
} from './dataProvider';
import type { ProjectApiEnvelope, ProxySaveProjectPayload } from './apiTypes';

const mergeProjectsByLatest = (local: Project[], cloud: Project[]): Project[] => {
    const byId = new Map<string, Project>();
    [...local, ...cloud].forEach(project => {
        const existing = byId.get(project.id);
        if (!existing || project.lastModified > existing.lastModified) {
            byId.set(project.id, project);
        }
    });
    return Array.from(byId.values()).sort((a, b) => b.createdAt - a.createdAt);
};

const syncLocalToCloudInBackground = async (
    localProjects: Project[],
    cloudProjects: Project[],
    userId: string,
    cloudSave: (project: Project, userId: string) => Promise<void>
): Promise<void> => {
    const cloudById = new Map(cloudProjects.map(project => [project.id, project]));
    const syncTasks = localProjects
        .filter(local => {
            const cloud = cloudById.get(local.id);
            return !cloud || local.lastModified > cloud.lastModified;
        })
        .map(local => cloudSave(local, userId));

    if (syncTasks.length === 0) return;

    await Promise.all(syncTasks);
};

const requestTimeoutMs = 8000;

const withTimeout = async <T>(promise: Promise<T>, timeoutMs = requestTimeoutMs): Promise<T> => {
    let timeoutId: number | undefined;
    const timeoutPromise = new Promise<T>((_, reject) => {
        timeoutId = window.setTimeout(() => reject(new Error(`Request timeout after ${timeoutMs}ms`)), timeoutMs);
    });

    try {
        return await Promise.race([promise, timeoutPromise]);
    } finally {
        if (timeoutId) window.clearTimeout(timeoutId);
    }
};

const getCurrentIdToken = async (): Promise<string> => {
    const currentUser = auth?.currentUser;
    if (!currentUser) throw new Error('No authenticated user available for proxy request');
    return currentUser.getIdToken();
};

const parseProxyEnvelope = async <T>(response: Response): Promise<ProjectApiEnvelope<T>> => {
    let payload: unknown = null;
    try {
        payload = await response.json();
    } catch {
        // no-op
    }

    if (!response.ok) {
        const errorMessage = (payload as { error?: string } | null)?.error || `Proxy request failed (${response.status})`;
        throw new Error(errorMessage);
    }

    if (!payload || typeof payload !== 'object' || !('data' in payload)) {
        throw new Error('Invalid proxy response envelope');
    }

    return payload as ProjectApiEnvelope<T>;
};

const proxyHelper = {
    getAll: async (userId: string): Promise<Project[]> => {
        if (!userId) return [];
        const token = await getCurrentIdToken();
        const response = await withTimeout(fetch(getProxyProjectsUrl(), {
            headers: {
                Authorization: `Bearer ${token}`,
            },
        }));
        const envelope = await parseProxyEnvelope<Project[]>(response);
        return envelope.data || [];
    },
    save: async (project: Project, userId: string): Promise<void> => {
        if (!userId) return;
        const token = await getCurrentIdToken();
        const payload: ProxySaveProjectPayload = { project };
        const response = await withTimeout(fetch(`${getProxyProjectsUrl()}/${project.id}`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(payload),
        }));
        await parseProxyEnvelope<Project>(response);
    },
    delete: async (id: string, userId: string): Promise<void> => {
        if (!userId) return;
        const token = await getCurrentIdToken();
        const response = await withTimeout(fetch(`${getProxyProjectsUrl()}/${id}`, {
            method: 'DELETE',
            headers: {
                Authorization: `Bearer ${token}`,
            },
        }));
        await parseProxyEnvelope<{ deleted: boolean }>(response);
    },
};

const trackProxyError = (action: string, error: unknown) => {
    Analytics.track('api_error', {
        source: `proxy_projects_${action}`,
        error: error instanceof Error ? error.message : String(error),
    });
};

const shouldUseProxyProvider = (): boolean => getDataProviderMode() === 'proxy';

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
        const localProjects = await dbHelper.getAll();

        if (isSupabaseConfigured && userId) {
            if (shouldUseProxyProvider()) {
                try {
                    const proxyProjects = await proxyHelper.getAll(userId);
                    const mergedProjects = mergeProjectsByLatest(localProjects, proxyProjects);

                    void syncLocalToCloudInBackground(localProjects, proxyProjects, userId, proxyHelper.save);

                    if (isProxyShadowReadEnabled()) {
                        void cloudHelper.getAll(userId)
                            .then((clientProjects) => {
                                const drift = Math.abs(clientProjects.length - proxyProjects.length);
                                if (drift > 0) {
                                    Analytics.track('projects_shadow_drift', {
                                        provider: 'proxy',
                                        shadow: 'client',
                                        drift,
                                        proxyCount: proxyProjects.length,
                                        clientCount: clientProjects.length,
                                    });
                                }
                            })
                            .catch(() => {
                                // Shadow read must never block primary path.
                            });
                    }

                    return mergedProjects;
                } catch (error) {
                    trackProxyError('getAll', error);
                    if (!canFallbackToClientProvider()) {
                        return localProjects;
                    }
                }
            }

            const cloudProjects = await cloudHelper.getAll(userId);
            const mergedProjects = mergeProjectsByLatest(localProjects, cloudProjects);
            void syncLocalToCloudInBackground(localProjects, cloudProjects, userId, cloudHelper.save);
            return mergedProjects;
        }

        return localProjects;
    },
    save: async (project: Project, userId?: string | null): Promise<void> => {
        // Always save to IndexedDB for offline support
        await dbHelper.save(project);
        // Also save to cloud if logged in
        if (isSupabaseConfigured && userId) {
            if (shouldUseProxyProvider()) {
                try {
                    await proxyHelper.save(project, userId);
                    return;
                } catch (error) {
                    trackProxyError('save', error);
                    if (!canFallbackToClientProvider()) return;
                }
            }
            await cloudHelper.save(project, userId);
        }
    },
    delete: async (id: string, userId?: string | null): Promise<void> => {
        await dbHelper.delete(id);
        if (isSupabaseConfigured && userId) {
            if (shouldUseProxyProvider()) {
                try {
                    await proxyHelper.delete(id, userId);
                    return;
                } catch (error) {
                    trackProxyError('delete', error);
                    if (!canFallbackToClientProvider()) return;
                }
            }
            await cloudHelper.delete(id, userId);
        }
    },
};
