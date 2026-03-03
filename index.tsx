import React, { useState, useRef, useEffect, useMemo, useCallback, lazy, Suspense, Component } from 'react';
import { createRoot } from 'react-dom/client';
import type { GenerateContentResponse } from "@google/genai";
const Editor = lazy(() => import('@monaco-editor/react'));
import { User } from 'firebase/auth';
import { auth, signInWithPopup, googleProvider, signOut, onAuthStateChanged, isConfigured as isFirebaseConfigured } from './src/firebase';

// Modular Imports
import { LANGUAGES, MAX_CONCURRENT_JOBS, KEYS } from './src/constants';
import { hybridDb } from './src/db';
import type { TranslationJob, ImageAsset, IframeAsset, Project } from './src/types';
import type { ToastMessage, ToastVariant } from './src/uiTypes';
import { Analytics, generateId, cleanStreamedHtml, formatDuration, formatDate, safeAssetId, urlToBase64 } from './src/utils';
import { useDebounce } from './src/hooks';
import { resolveUiFlags } from './src/featureFlags';
import { isPerfV1Enabled, isVirtualListsEnabled } from './src/perfFlags';
import type { PerfBudgetSnapshot, UiInteractionEventName } from './src/perfTypes';

import Icons from './src/components/Icons';
import { LokalyzeLogo, ApxlbsLogo } from './src/components/Logo';
import Tooltip from './src/components/Tooltip';
import SettingsModal from './src/components/SettingsModal';
import { toastVariantStyles, cn, statusVariantStyles } from './src/design-system/primitives';
import { Badge } from './src/design-system/components/Badge';
import { EmptyState } from './src/design-system/components/EmptyState';
import { InlineMessage } from './src/design-system/components/InlineMessage';
import { Button } from './src/design-system/components/Button';
import { Skeleton } from './src/design-system/components/Skeleton';
import { ConfirmModal } from './src/design-system/components/ConfirmModal';

// --- ERROR BOUNDARY ---
interface ErrorBoundaryState { hasError: boolean; error: Error | null; }
class ErrorBoundary extends Component<{ children: React.ReactNode }, ErrorBoundaryState> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error: Error) { return { hasError: true, error }; }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    Analytics.track('client_error', {
      source: 'error_boundary',
      message: error.message,
      stack: error.stack,
      componentStack: info.componentStack,
    });
    console.error('[Lokalyze] Uncaught error:', error, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ minHeight: '100vh', background: '#050505', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem' }}>
          <div style={{ maxWidth: 480, textAlign: 'center', color: '#fff', fontFamily: 'system-ui' }}>
            <div style={{ fontSize: '2rem', marginBottom: '1rem' }}>⚠️</div>
            <h1 style={{ fontSize: '1.2rem', fontWeight: 700, marginBottom: '0.5rem' }}>Something went wrong</h1>
            <p style={{ color: '#888', fontSize: '0.85rem', marginBottom: '1.5rem' }}>{this.state.error?.message}</p>
            <button onClick={() => window.location.reload()} style={{ background: '#7c3aed', color: '#fff', border: 'none', borderRadius: 8, padding: '0.75rem 1.5rem', cursor: 'pointer', fontWeight: 700 }}>Reload App</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

let aiClientByKey = new Map<string, Promise<any>>();
let fileSaverModulePromise: Promise<any> | null = null;
let jsZipModulePromise: Promise<any> | null = null;

const getAiClient = async (apiKey: string) => {
  if (!apiKey) return null;
  const existing = aiClientByKey.get(apiKey);
  if (existing) return existing;

  const created = import('@google/genai').then(({ GoogleGenAI }) => new GoogleGenAI({ apiKey }));
  aiClientByKey.set(apiKey, created);
  return created;
};

const saveBlobAsFile = async (blob: Blob, filename: string) => {
  if (!fileSaverModulePromise) {
    fileSaverModulePromise = import('file-saver');
  }
  const fileSaver = await fileSaverModulePromise;
  const saveAsFn = fileSaver?.saveAs || fileSaver?.default;
  if (!saveAsFn) throw new Error('FileSaver module unavailable');
  saveAsFn(blob, filename);
};

const createZip = async () => {
  if (!jsZipModulePromise) {
    jsZipModulePromise = import('jszip');
  }
  const zipModule = await jsZipModulePromise;
  const JSZipCtor = zipModule?.default || zipModule;
  return new JSZipCtor();
};

const LOCAL_TENANT_KEY = 'lokalyze_local_tenant_id';

const getLocalTenantId = (): string => {
  if (typeof window === 'undefined') return 'local_anon';
  try {
    const existing = localStorage.getItem(LOCAL_TENANT_KEY);
    if (existing) return existing;
    const generated = `local_${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(LOCAL_TENANT_KEY, generated);
    return generated;
  } catch {
    return 'local_anon';
  }
};

const toLatencyBucket = (ms: number): string => {
  if (ms < 100) return 'lt_100ms';
  if (ms < 250) return '100_249ms';
  if (ms < 500) return '250_499ms';
  if (ms < 1000) return '500_999ms';
  return 'gte_1000ms';
};

// --- APP COMPONENT ---
const App: React.FC = () => {
  // -- STATE: PERSISTENCE LAYER (PHASE A) --
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [soundEnabled, setSoundEnabled] = useState<boolean>(() =>
    localStorage.getItem(KEYS.SOUND) !== 'false'
  );

  // Settings & Auth
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [userApiKey, setUserApiKey] = useState(() => localStorage.getItem('lokalyze_api_key') || '');
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const uiFlags = useMemo(() => resolveUiFlags(user?.uid), [user?.uid]);
  const perfV1Enabled = useMemo(() => isPerfV1Enabled(), []);
  const virtualListsEnabled = useMemo(() => isVirtualListsEnabled(), []);
  const appBootRef = useRef(typeof performance !== 'undefined' ? performance.now() : 0);
  const firstActionTrackedRef = useRef(false);
  const tabSwitchStartRef = useRef<number | null>(null);
  const jobDetailOpenStartRef = useRef<Record<string, number>>({});
  const [perfSnapshot, setPerfSnapshot] = useState<PerfBudgetSnapshot>({
    bundleBytes: 0,
    initialRenderMs: 0,
    tabSwitchMs: 0,
  });

  // API key can come from local settings or env fallback.
  const effectiveApiKey = userApiKey || import.meta.env.VITE_GEMINI_API_KEY || '';

  useEffect(() => {
    if (isFirebaseConfigured && auth) {
      const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
        const previousUserId = authUserRef.current;
        const nextUserId = currentUser?.uid || null;
        if (!previousUserId && nextUserId) {
          Analytics.track('login', { method: 'google', userId: nextUserId });
        }
        if (previousUserId && !nextUserId) {
          Analytics.track('logout', { method: 'google', userId: previousUserId });
        }
        authUserRef.current = nextUserId;
        setUser(currentUser);
        setAuthLoading(false);
      });
      return () => unsubscribe();
    } else {
      setAuthLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!user?.uid) return;
    Analytics.identify(user.uid, {
      email: user.email || '',
      source: 'firebase_auth',
    });
  }, [user?.uid, user?.email]);

  useEffect(() => {
    const onGlobalError = (event: ErrorEvent) => {
      Analytics.track('client_error', {
        source: 'window.onerror',
        message: event.message || 'Unknown global error',
        filename: event.filename || '',
        lineno: event.lineno || 0,
        colno: event.colno || 0,
      });
    };

    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason instanceof Error
        ? event.reason.message
        : typeof event.reason === 'string'
          ? event.reason
          : JSON.stringify(event.reason || {});

      Analytics.track('client_error', {
        source: 'unhandledrejection',
        message: reason,
      });
    };

    window.addEventListener('error', onGlobalError);
    window.addEventListener('unhandledrejection', onUnhandledRejection);

    return () => {
      window.removeEventListener('error', onGlobalError);
      window.removeEventListener('unhandledrejection', onUnhandledRejection);
    };
  }, []);

  const handleLogin = async () => {
    if (!auth) return triggerToast("Firebase is not configured. Check .env.example", 'warning');
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error: any) {
      Analytics.track('api_error', {
        source: 'auth_login',
        error: error?.message || 'unknown_login_error',
      });
      triggerToast(`Login failed: ${error.message}`, 'error');
    }
  };

  const handleLogout = async () => {
    if (!auth) return;
    try {
      await signOut(auth);
    } catch (error: any) {
      Analytics.track('api_error', {
        source: 'auth_logout',
        error: error?.message || 'unknown_logout_error',
      });
      triggerToast('Logout failed. Try again.', 'error');
    }
  };

  const saveSettings = (key: string) => {
    setUserApiKey(key);
    localStorage.setItem('lokalyze_api_key', key);
    setIsSettingsOpen(false);
    triggerToast("Settings saved successfully", 'success');
  };

  // Source Code
  const [sourceHtml, setSourceHtml] = useState<string>(() =>
    localStorage.getItem(KEYS.HTML) || '<!-- Paste your HTML here -->\n<div class="hero" style="text-align: center;">\n  <h1>Global Expansion</h1>\n  <img src="https://via.placeholder.com/400" alt="Dashboard" />\n  <iframe src="https://example.com/widget" width="100%" height="200"></iframe>\n</div>'
  );
  const debouncedSourceHtml = useDebounce(sourceHtml, 600);

  const [globalCss, setGlobalCss] = useState<string>(() =>
    localStorage.getItem(KEYS.CSS) || 'body { font-family: sans-serif; }'
  );

  // Job Queue (The Mainframe State)
  const [jobs, setJobs] = useState<Record<string, TranslationJob>>({});
  const jobControllers = useRef<Record<string, AbortController>>({});

  // History / Projects - Initialized as empty, loaded async
  const [history, setHistory] = useState<Project[]>([]);
  const [isHistoryLoading, setIsHistoryLoading] = useState<boolean>(true);

  // Current Task Context
  const [taskName, setTaskName] = useState<string>('');
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);

  // Asset Management (Phase C)
  const [detectedImages, setDetectedImages] = useState<ImageAsset[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(KEYS.ASSETS) || '[]');
    } catch { return []; }
  });

  const [detectedIframes, setDetectedIframes] = useState<IframeAsset[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(KEYS.IFRAMES) || '[]');
    } catch { return []; }
  });

  // UI State
  const [inputTab, setInputTab] = useState<'html' | 'css'>('html');
  const [activeTab, setActiveTab] = useState<'monitor' | 'assets' | 'history'>('monitor');
  const [selectedLangs, setSelectedLangs] = useState<string[]>(['Spanish', 'German']);
  const [focusedJobId, setFocusedJobId] = useState<string | null>(null);
  const [isBatchRunning, setIsBatchRunning] = useState<boolean>(false);
  const [isDownloadingAssets, setIsDownloadingAssets] = useState<boolean>(false);
  const [notification, setNotification] = useState<ToastMessage | null>(null);
  const [translatingImages, setTranslatingImages] = useState<Record<string, boolean>>({});
  const [langFilter, setLangFilter] = useState<'all' | 'popular' | 'recent'>('all');
  const [recentLangs, setRecentLangs] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('lokalyze_recent_langs') || '[]');
    } catch {
      return [];
    }
  });
  const [historySort, setHistorySort] = useState<'recent' | 'oldest' | 'completion'>('recent');
  const [monitorDensity, setMonitorDensity] = useState<'comfortable' | 'compact'>('comfortable');
  const [onboardingDismissed, setOnboardingDismissed] = useState<boolean>(() =>
    localStorage.getItem('lokalyze_onboarding_dismissed') === 'true'
  );
  const [jobRenderLimit, setJobRenderLimit] = useState(80);
  const [historyRenderLimit, setHistoryRenderLimit] = useState(80);
  const [imageRenderLimit, setImageRenderLimit] = useState(60);
  const [iframeRenderLimit, setIframeRenderLimit] = useState(40);
  const [pendingHistoryDelete, setPendingHistoryDelete] = useState<{ id: string; name: string } | null>(null);
  const [isDeletingProject, setIsDeletingProject] = useState(false);
  const [historyDeleteError, setHistoryDeleteError] = useState<{ id: string; name: string; message: string } | null>(null);
  const [assetInlineError, setAssetInlineError] = useState<string | null>(null);
  const [assetRetryContext, setAssetRetryContext] = useState<
    | { type: 'download_all' }
    | { type: 'translate_image'; imageId: string; targetLang: string }
    | null
  >(null);

  // References for processing loop
  const processingRefs = useRef<Set<string>>(new Set());
  const authUserRef = useRef<string | null>(null);
  const firstValueProjectRef = useRef<Set<string>>(new Set());
  const lastPageRouteRef = useRef<string>('');
  const localTenantId = useMemo(() => getLocalTenantId(), []);

  useEffect(() => {
    if (authLoading) return;
    Analytics.group(user?.uid || localTenantId, {
      mode: user?.uid ? 'authenticated' : 'anonymous',
      source: user?.uid ? 'firebase_auth' : 'local_only',
    });
  }, [authLoading, user?.uid, localTenantId]);

  useEffect(() => {
    if (authLoading) return;
    const route = isFirebaseConfigured && !user ? '/auth' : `/workspace/${activeTab}`;
    if (lastPageRouteRef.current === route) return;
    lastPageRouteRef.current = route;
    Analytics.page(route, {
      tab: activeTab,
      authenticated: Boolean(user?.uid),
    });
  }, [authLoading, activeTab, user?.uid]);

  const trackFirstAction = useCallback((action: string) => {
    if (!perfV1Enabled || firstActionTrackedRef.current) return;
    firstActionTrackedRef.current = true;
    const elapsed = Math.max(0, Math.round(performance.now() - appBootRef.current));
    Analytics.track('time_to_first_action', { action, ms: elapsed });
    setPerfSnapshot(prev => ({ ...prev, initialRenderMs: elapsed }));
  }, [perfV1Enabled]);

  const trackUiInteraction = useCallback((event: UiInteractionEventName, props: Record<string, unknown> = {}) => {
    Analytics.track(event, props);
  }, []);

  const openTab = useCallback((tab: 'monitor' | 'assets' | 'history') => {
    tabSwitchStartRef.current = performance.now();
    setActiveTab(tab);
    trackFirstAction('tab_switch');
    trackUiInteraction('panel_opened', { panel: tab });
  }, [trackFirstAction, trackUiInteraction]);

  const openJobDetail = useCallback((jobId: string) => {
    jobDetailOpenStartRef.current[jobId] = performance.now();
    setFocusedJobId(jobId);
    trackFirstAction('open_job_detail');
    trackUiInteraction('job_detail_toggled', { jobId, action: 'open' });
  }, [trackFirstAction, trackUiInteraction]);

  const closeJobDetail = useCallback(() => {
    if (focusedJobId) {
      trackUiInteraction('job_detail_toggled', { jobId: focusedJobId, action: 'close' });
    }
    setFocusedJobId(null);
  }, [focusedJobId, trackUiInteraction]);

  // -- EFFECTS: PERSISTENCE & INTEGRITY --
  useEffect(() => { document.documentElement.className = theme; }, [theme]);

  useEffect(() => localStorage.setItem(KEYS.HTML, sourceHtml), [sourceHtml]);
  useEffect(() => localStorage.setItem(KEYS.CSS, globalCss), [globalCss]);
  useEffect(() => localStorage.setItem(KEYS.ASSETS, JSON.stringify(detectedImages)), [detectedImages]);
  useEffect(() => localStorage.setItem(KEYS.IFRAMES, JSON.stringify(detectedIframes)), [detectedIframes]);
  useEffect(() => localStorage.setItem(KEYS.SOUND, String(soundEnabled)), [soundEnabled]);
  useEffect(() => localStorage.setItem('lokalyze_recent_langs', JSON.stringify(recentLangs.slice(0, 8))), [recentLangs]);
  useEffect(() => localStorage.setItem('lokalyze_onboarding_dismissed', String(onboardingDismissed)), [onboardingDismissed]);

  useEffect(() => {
    if (!perfV1Enabled) return;
    try {
      const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
      const jsResources = resources.filter(item => item.name.includes('.js'));
      const bundleBytesEstimate = Math.max(0, ...jsResources.map(item => item.transferSize || 0));
      if (bundleBytesEstimate > 0) {
        setPerfSnapshot(prev => ({ ...prev, bundleBytes: bundleBytesEstimate }));
      }
    } catch {
      // Perf APIs can be unavailable depending on browser settings.
    }
  }, [perfV1Enabled]);

  useEffect(() => {
    if (selectedLangs.length === 0) return;
    setRecentLangs(prev => {
      const merged = [...selectedLangs, ...prev];
      return Array.from(new Set(merged)).slice(0, 8);
    });
  }, [selectedLangs]);

  // CLEANUP CRASH CAUSING LOCALSTORAGE KEY
  useEffect(() => {
    try {
      localStorage.removeItem('lokalyze_project_history');
    } catch (e) { }
  }, []);

  // LOAD HISTORY ON MOUNT (cloud if logged in, local otherwise)
  useEffect(() => {
    if (!authLoading) {
      setIsHistoryLoading(true);
      hybridDb.getAll(user?.uid)
        .then(setHistory)
        .finally(() => setIsHistoryLoading(false));
    }
  }, [authLoading, user]);

  useEffect(() => {
    if (!perfV1Enabled || tabSwitchStartRef.current === null) return;
    const startedAt = tabSwitchStartRef.current;
    let frame2 = 0;
    const frame = requestAnimationFrame(() => {
      frame2 = requestAnimationFrame(() => {
        const elapsed = Math.max(0, Math.round(performance.now() - startedAt));
        Analytics.track('tab_switch_latency', { panel: activeTab, ms: elapsed });
        Analytics.track('latency_bucket', { source: 'tab_switch', bucket: toLatencyBucket(elapsed), ms: elapsed });
        setPerfSnapshot(prev => ({ ...prev, tabSwitchMs: elapsed }));
        tabSwitchStartRef.current = null;
      });
    });
    return () => {
      cancelAnimationFrame(frame);
      if (frame2) cancelAnimationFrame(frame2);
    };
  }, [activeTab, perfV1Enabled]);

  useEffect(() => {
    if (!perfV1Enabled || !focusedJobId) return;
    const startedAt = jobDetailOpenStartRef.current[focusedJobId];
    if (!startedAt) return;

    const frame = requestAnimationFrame(() => {
      const elapsed = Math.max(0, Math.round(performance.now() - startedAt));
      Analytics.track('job_detail_open_latency', { jobId: focusedJobId, ms: elapsed });
      Analytics.track('latency_bucket', { source: 'job_detail_open', bucket: toLatencyBucket(elapsed), ms: elapsed });
      delete jobDetailOpenStartRef.current[focusedJobId];
    });
    return () => cancelAnimationFrame(frame);
  }, [focusedJobId, perfV1Enabled]);

  useEffect(() => {
    if (!activeProjectId) return;
    if (firstValueProjectRef.current.has(activeProjectId)) return;
    const firstCompletedJob = (Object.values(jobs) as TranslationJob[]).find(job => job.status === 'completed');
    if (!firstCompletedJob) return;
    firstValueProjectRef.current.add(activeProjectId);
    Analytics.track('first_value_action', {
      projectId: activeProjectId,
      jobId: firstCompletedJob.id,
      lang: firstCompletedJob.lang,
    });
  }, [jobs, activeProjectId]);

  // SAVE ACTIVE PROJECT GRANULARLY (Debounced — avoids writing on every streaming progress tick)
  useEffect(() => {
    if (!activeProjectId) return;
    const timer = setTimeout(() => {
      const projectToSave = history.find(h => h.id === activeProjectId);
      if (projectToSave) {
        hybridDb.save(projectToSave, user?.uid);
      }
    }, 2000);
    return () => clearTimeout(timer);
  }, [history, activeProjectId, user]);

  // Sync Active Jobs to History in real-time
  useEffect(() => {
    if (activeProjectId) {
      setHistory(prev => prev.map(p =>
        p.id === activeProjectId
          ? { ...p, jobs: jobs, lastModified: Date.now() }
          : p
      ));
    }
  }, [jobs, activeProjectId]);

  // Image & Iframe Scanner Logic - OPTIMIZED: Uses debouncedSourceHtml
  useEffect(() => {
    // Scan Images
    const imgRegex = /<img[^>]+src=["']([^"']+)["']/g;
    const imgMatches = Array.from(debouncedSourceHtml.matchAll(imgRegex));
    const currentImages = imgMatches.map((m, index) => ({
      url: m[1],
      index: index
    }));

    setDetectedImages(prev => {
      const existingById = new Map(prev.map(p => [p.id, p.replacementUrl]));
      const existingByUrl = new Map(prev.map(p => [p.originalUrl, p.replacementUrl]));

      return currentImages.map(img => {
        const id = safeAssetId(`${img.url}_${img.index}`);
        let repl = existingById.get(id);
        if (repl === undefined) {
          repl = existingByUrl.get(img.url) || '';
        }
        return {
          id,
          originalUrl: img.url,
          replacementUrl: repl,
          index: img.index
        };
      });
    });

    // Scan Iframes (src only for scanning, but we handle srcdoc in prompt)
    const iframeRegex = /<iframe[^>]+src=["']([^"']+)["']/g;
    const iframeMatches = Array.from(debouncedSourceHtml.matchAll(iframeRegex));
    const currentIframes = iframeMatches.map((m, index) => ({
      url: m[1],
      index: index
    }));

    setDetectedIframes(prev => {
      const existingById = new Map<string, { repl: string, html: string }>(
        prev.map(p => [p.id, { repl: p.replacementUrl, html: p.htmlContent }])
      );
      const existingByUrl = new Map<string, { repl: string, html: string }>(
        prev.map(p => [p.originalUrl, { repl: p.replacementUrl, html: p.htmlContent }])
      );

      return currentIframes.map(ifr => {
        const id = safeAssetId(`${ifr.url}_${ifr.index}`);
        let existing = existingById.get(id);
        if (existing === undefined) {
          existing = existingByUrl.get(ifr.url);
        }
        return {
          id,
          originalUrl: ifr.url,
          replacementUrl: existing?.repl || '',
          htmlContent: existing?.html || '',
          index: ifr.index
        };
      });
    });

  }, [debouncedSourceHtml]);

  // -- BUSINESS LOGIC: CORE ACTIONS --

  const triggerToast = (message: string, type: ToastVariant = 'info') => {
    const nextToast: ToastMessage = { id: generateId(), message, type };
    setNotification(nextToast);
    setTimeout(() => {
      setNotification(prev => prev?.id === nextToast.id ? null : prev);
    }, 3200);
  };

  const popularLanguages = useMemo(() => ['English', 'Spanish', 'French', 'German', 'Portuguese'], []);
  const displayedLanguages = useMemo(() => {
    if (!uiFlags.selector) return LANGUAGES;
    if (langFilter === 'popular') return LANGUAGES.filter(lang => popularLanguages.includes(lang));
    if (langFilter === 'recent') return LANGUAGES.filter(lang => recentLangs.includes(lang));
    return LANGUAGES;
  }, [langFilter, popularLanguages, recentLangs, uiFlags.selector]);

  const sortedHistory = useMemo(() => {
    const list = [...history];
    if (historySort === 'oldest') {
      return list.sort((a, b) => a.createdAt - b.createdAt);
    }
    if (historySort === 'completion') {
      return list.sort((a, b) => {
        const aTotal = Math.max(Object.keys(a.jobs || {}).length, 1);
        const bTotal = Math.max(Object.keys(b.jobs || {}).length, 1);
        const aDone = (Object.values(a.jobs || {}) as TranslationJob[]).filter(j => j.status === 'completed').length / aTotal;
        const bDone = (Object.values(b.jobs || {}) as TranslationJob[]).filter(j => j.status === 'completed').length / bTotal;
        return bDone - aDone;
      });
    }
    return list.sort((a, b) => b.createdAt - a.createdAt);
  }, [history, historySort]);

  const syncModeLabel = useMemo(() => {
    if (!user) return 'Local Mode';
    return import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY ? 'Cloud Sync' : 'Local + Auth';
  }, [user]);
  const jobsList = useMemo(() => Object.values(jobs) as TranslationJob[], [jobs]);
  const visibleJobs = useMemo(() => {
    if (!virtualListsEnabled) return jobsList;
    return jobsList.slice(0, jobRenderLimit);
  }, [jobsList, virtualListsEnabled, jobRenderLimit]);
  const activeProject = useMemo(
    () => (activeProjectId ? history.find(h => h.id === activeProjectId) || null : null),
    [history, activeProjectId]
  );
  const historyList = useMemo(
    () => (uiFlags.history ? sortedHistory : history),
    [uiFlags.history, sortedHistory, history]
  );
  const visibleHistory = useMemo(() => {
    if (!virtualListsEnabled) return historyList;
    return historyList.slice(0, historyRenderLimit);
  }, [historyList, virtualListsEnabled, historyRenderLimit]);
  const visibleDetectedImages = useMemo(() => {
    if (!virtualListsEnabled) return detectedImages;
    return detectedImages.slice(0, imageRenderLimit);
  }, [detectedImages, virtualListsEnabled, imageRenderLimit]);
  const visibleDetectedIframes = useMemo(() => {
    if (!virtualListsEnabled) return detectedIframes;
    return detectedIframes.slice(0, iframeRenderLimit);
  }, [detectedIframes, virtualListsEnabled, iframeRenderLimit]);
  const imageOverrideCount = useMemo(
    () => detectedImages.filter(i => i.replacementUrl.trim().length > 0).length,
    [detectedImages]
  );
  const totalAssetsDetected = useMemo(
    () => detectedImages.length + detectedIframes.length,
    [detectedImages.length, detectedIframes.length]
  );

  useEffect(() => {
    if (activeTab === 'monitor') setJobRenderLimit(80);
    if (activeTab === 'history') setHistoryRenderLimit(80);
    if (activeTab === 'assets') {
      setImageRenderLimit(60);
      setIframeRenderLimit(40);
    }
  }, [activeTab]);

  const playNotificationSound = useCallback((type: 'success' | 'click') => {
    if (!soundEnabled) return;

    // Safely get AudioContext
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;

    const ctx = new AudioContextClass();
    if (type === 'success') {
      // Pleasant rising arpeggio (C Major: C5, E5, G5, C6)
      const now = ctx.currentTime;
      const playTone = (freq: number, startTime: number, duration: number, vol: number) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = 'sine';
        o.frequency.value = freq;
        g.gain.setValueAtTime(vol, startTime);
        g.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
        o.connect(g);
        g.connect(ctx.destination);
        o.start(startTime);
        o.stop(startTime + duration);
      };

      playTone(523.25, now, 0.4, 0.1);       // C5
      playTone(659.25, now + 0.1, 0.4, 0.1); // E5
      playTone(783.99, now + 0.2, 0.4, 0.1); // G5
      playTone(1046.50, now + 0.35, 0.6, 0.1); // C6
    }
  }, [soundEnabled]);

  const toggleLanguage = useCallback((lang: string) => {
    trackFirstAction('select_language');
    setSelectedLangs(prev => prev.includes(lang) ? prev.filter(l => l !== lang) : [...prev, lang]);
  }, [trackFirstAction]);

  const updateAsset = useCallback((id: string, newUrl: string) => {
    setDetectedImages(prev => prev.map(img =>
      img.id === id ? { ...img, replacementUrl: newUrl } : img
    ));
    Analytics.track('asset_updated', { assetId: id });
    Analytics.track('asset_override_applied', { assetId: id, assetType: 'image' });
  }, []);

  const updateIframeUrl = useCallback((id: string, newUrl: string) => {
    setDetectedIframes(prev => prev.map(iframe =>
      iframe.id === id ? { ...iframe, replacementUrl: newUrl } : iframe
    ));
    Analytics.track('iframe_updated', { iframeId: id, type: 'url' });
    Analytics.track('asset_override_applied', { assetId: id, assetType: 'iframe_url' });
  }, []);

  const updateIframeHtml = useCallback((id: string, newHtml: string) => {
    setDetectedIframes(prev => prev.map(iframe =>
      iframe.id === id ? { ...iframe, htmlContent: newHtml } : iframe
    ));
    Analytics.track('iframe_updated', { iframeId: id, type: 'html' });
    Analytics.track('asset_override_applied', { assetId: id, assetType: 'iframe_html' });
  }, []);

  const translateImage = async (img: ImageAsset, targetLang: string) => {
    try {
      setTranslatingImages(prev => ({ ...prev, [img.id]: true }));
      setAssetInlineError(null);
      setAssetRetryContext(null);
      trackFirstAction('translate_image');

      const client = await getAiClient(effectiveApiKey);
      if (!client) {
        triggerToast('No API key set. Open Settings to add your Gemini API key.', 'warning');
        return;
      }

      triggerToast(`Translating image text to ${targetLang}...`);

      const { data: base64Data, mimeType } = await urlToBase64(img.originalUrl);

      const response = await client.models.generateContent({
        model: 'gemini-2.0-flash',
        contents: {
          parts: [
            {
              inlineData: {
                data: base64Data,
                mimeType: mimeType,
              },
            },
            {
              text: `Translate any text found in this image to ${targetLang}. 
                     - Maintain the exact original background, visual style, colors, and layout. 
                     - If no text is found, return the image exactly as is.
                     - Output strictly the image.`,
            },
          ],
        },
      });

      let generatedBase64 = '';
      for (const part of response.candidates?.[0]?.content?.parts || []) {
        if (part.inlineData) {
          generatedBase64 = part.inlineData.data || '';
          break;
        }
      }

      if (generatedBase64) {
        const imageUrl = `data:image/png;base64,${generatedBase64}`;
        updateAsset(img.id, imageUrl);
        triggerToast("Image translated & override set!", 'success');
        playNotificationSound('success');
      } else {
        throw new Error("No image data returned from model");
      }

    } catch (e: any) {
      console.error(e);
      const message = e?.message || "Image translation failed (CORS or Model Error)";
      setAssetInlineError(`Image translation failed for ${img.originalUrl}: ${message}`);
      setAssetRetryContext({ type: 'translate_image', imageId: img.id, targetLang });
      triggerToast(message, 'error');
    } finally {
      setTranslatingImages(prev => ({ ...prev, [img.id]: false }));
    }
  };

  const downloadHtml = (lang: string, html: string) => {
    const blob = new Blob([html], { type: 'text/html' });
    saveBlobAsFile(blob, `index-${lang.toLowerCase()}.html`)
      .then(() => triggerToast(`Downloaded ${lang} file`, 'success'))
      .catch((error) => {
        Analytics.track('asset_download_failed', {
          source: 'downloadHtml',
          lang,
          error: error instanceof Error ? error.message : String(error),
        });
        triggerToast('Failed to download file', 'error');
      });
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
      .then(() => triggerToast("Copied to clipboard", 'success'))
      .catch((error) => {
        Analytics.track('api_error', {
          source: 'clipboard_write',
          error: error instanceof Error ? error.message : String(error),
        });
        triggerToast('Copy failed', 'error');
      });
  };

  const loadProject = (project: Project) => {
    if (isBatchRunning) {
      triggerToast("Cannot load while batch is running", 'warning');
      return;
    }

    // Restore state from project
    setSourceHtml(project.sourceHtml);
    setGlobalCss(project.globalCss);
    setDetectedImages(project.detectedImages || []); // Safe default
    setDetectedIframes(project.detectedIframes || []); // Safe default
    setJobs(project.jobs || {}); // Safe default
    setSelectedLangs(project.selectedLangs || []); // Safe default
    setTaskName(project.name);
    setActiveProjectId(project.id);

    openTab('monitor');
    Analytics.track('history_action', { action: 'load', projectId: project.id });
    triggerToast(`Loaded "${project.name}"`);
  };

  const requestDeleteProject = (e: React.MouseEvent, id: string, name: string) => {
    e.stopPropagation();
    setHistoryDeleteError(null);
    setPendingHistoryDelete({ id, name });
  };

  const confirmDeleteProject = async () => {
    if (!pendingHistoryDelete) return;
    setIsDeletingProject(true);
    setHistoryDeleteError(null);

    const targetProjectId = pendingHistoryDelete.id;
    const targetProjectName = pendingHistoryDelete.name;

    try {
      await hybridDb.delete(targetProjectId, user?.uid);
      setHistory(prev => prev.filter(p => p.id !== targetProjectId));
      if (activeProjectId === targetProjectId) {
        setActiveProjectId(null);
      }
      Analytics.track('history_action', { action: 'delete', projectId: targetProjectId });
      triggerToast("Project deleted", 'success');
      setPendingHistoryDelete(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      Analytics.track('history_delete_failed', {
        projectId: targetProjectId,
        error: message,
      });
      setHistoryDeleteError({ id: targetProjectId, name: targetProjectName, message });
      triggerToast("Failed to delete project", 'error');
    } finally {
      setIsDeletingProject(false);
    }
  };

  // -- ASSET DOWNLOAD LOGIC --

  const downloadAsset = async (url: string, filename?: string) => {
    try {
      triggerToast("Downloading asset...");
      // Handle Data URLs directly
      if (url.startsWith('data:')) {
        const fetchRes = await fetch(url);
        const blob = await fetchRes.blob();
        await saveBlobAsFile(blob, filename || 'translated-image.png');
        triggerToast("Download complete", 'success');
        return;
      }

      const response = await fetch(url, { mode: 'cors' });
      if (!response.ok) throw new Error('Network block');
      const blob = await response.blob();
      const name = filename || url.split('/').pop()?.split('?')[0] || 'image.png';
      await saveBlobAsFile(blob, name);
      triggerToast("Download complete", 'success');
    } catch (e) {
      console.warn("Direct download failed, opening in new tab", e);
      Analytics.track('asset_download_failed', {
        source: 'downloadAsset',
        url,
        error: e instanceof Error ? e.message : String(e),
      });
      // Fallback: Open in new tab
      window.open(url, '_blank');
      triggerToast("Opened in new tab (CORS restricted)", 'warning');
    }
  };

  const downloadAllAssets = async () => {
    if (detectedImages.length === 0) return triggerToast("No assets to download", 'warning');
    setIsDownloadingAssets(true);
    setAssetInlineError(null);
    setAssetRetryContext(null);
    triggerToast("Packaging assets... this may take a moment");

    try {
      const zip = await createZip();
      const folder = zip.folder("assets");
      let successCount = 0;

      // Parallel fetching
      await Promise.all(detectedImages.map(async (img) => {
        try {
          // Prioritize replacement URL (e.g., the AI translated image)
          const targetUrl = img.replacementUrl && img.replacementUrl.trim() !== '' ? img.replacementUrl : img.originalUrl;

          let blob: Blob;
          if (targetUrl.startsWith('data:')) {
            const res = await fetch(targetUrl);
            blob = await res.blob();
          } else {
            const response = await fetch(targetUrl, { mode: 'cors' });
            if (!response.ok) throw new Error('Network error');
            blob = await response.blob();
          }

          let filename = img.originalUrl.split('/').pop()?.split('?')[0];
          if (!filename || filename.length > 50 || !filename.includes('.')) {
            filename = `image-${img.id}.png`; // Fallback
          } else {
            // Ensure uniqueness by appending ID before extension
            const parts = filename.split('.');
            const ext = parts.pop();
            filename = `${parts.join('.')}-${img.id}.${ext}`;
          }

          // If it's a replacement, maybe append suffix to indicate it
          if (img.replacementUrl) {
            const parts = filename.split('.');
            const ext = parts.pop();
            filename = `${parts.join('.')}-localized.${ext || 'png'}`;
          }

          folder?.file(filename, blob);
          successCount++;
        } catch (e) {
          console.warn(`Failed to fetch ${img.originalUrl}`, e);
        }
      }));

      if (successCount === 0) {
        throw new Error("No assets could be accessed (CORS blocked)");
      }

      const content = await zip.generateAsync({ type: "blob" });
      await saveBlobAsFile(content, "lokalyze-assets.zip");
      triggerToast(`Downloaded ${successCount} assets`, 'success');
      setAssetInlineError(null);
      setAssetRetryContext(null);

    } catch (e: any) {
      console.error(e);
      Analytics.track('asset_download_failed', {
        source: 'downloadAllAssets',
        error: e?.message || String(e),
      });
      const message = e?.message || "Batch download failed";
      setAssetInlineError(`Asset package failed: ${message}`);
      setAssetRetryContext({ type: 'download_all' });
      triggerToast(message, 'error');
    } finally {
      setIsDownloadingAssets(false);
    }
  };

  const retryLastAssetAction = () => {
    if (!assetRetryContext) return;
    if (assetRetryContext.type === 'download_all') {
      void downloadAllAssets();
      return;
    }

    const image = detectedImages.find(item => item.id === assetRetryContext.imageId);
    if (!image) {
      setAssetInlineError('Unable to retry image translation because the asset was removed.');
      setAssetRetryContext(null);
      return;
    }
    void translateImage(image, assetRetryContext.targetLang);
  };

  const stopJob = (jobId: string) => {
    if (jobControllers.current[jobId]) {
      jobControllers.current[jobId].abort();
      delete jobControllers.current[jobId];

      setJobs(prev => ({
        ...prev,
        [jobId]: { ...prev[jobId], status: 'stopped' }
      }));
      triggerToast('Job stopped manually', 'warning');
    }
  };

  const retryJob = (jobId: string) => {
    setJobs(prev => {
      const current = prev[jobId];
      if (!current) return prev;
      return {
        ...prev,
        [jobId]: {
          ...current,
          status: 'queued',
          error: undefined,
          progress: 0,
          translatedHtml: '',
          tokenCount: 0,
          startTime: 0,
          endTime: undefined,
        }
      };
    });
    triggerToast('Job queued for retry', 'info');
  };

  // The Engine
  const executeTranslation = async (jobId: string, lang: string, source: string, projectId: string) => {
    if (processingRefs.current.has(jobId)) return;
    processingRefs.current.add(jobId);

    const abortController = new AbortController();
    jobControllers.current[jobId] = abortController;

    const startTime = Date.now();
    setJobs(prev => ({
      ...prev,
      [jobId]: { ...prev[jobId], status: 'translating', startTime, progress: 1 }
    }));

    Analytics.track('job_started', { lang, jobId });

    // Pre-process source to replace image URLs individually
    let preprocessedSource = source;
    let imgIndex = 0;
    preprocessedSource = preprocessedSource.replace(/<img[^>]+src=["']([^"']+)["']/g, (match, url) => {
      const img = detectedImages.find(i => i.index === imgIndex);
      imgIndex++;
      if (img && img.replacementUrl.trim().length > 0) {
        return match.replace(url, img.replacementUrl);
      }
      return match;
    });

    // Pre-process iframes individually
    let iframeIndex = 0;
    preprocessedSource = preprocessedSource.replace(/<iframe([^>]+)src=["']([^"']+)["']/g, (match, beforeSrc, url) => {
      const ifr = detectedIframes.find(i => i.index === iframeIndex);
      iframeIndex++;
      if (ifr) {
        if (ifr.htmlContent && ifr.htmlContent.trim().length > 5) {
          // Deep Translation: Add srcdoc and remove src
          // Escape the HTML content for the srcdoc attribute
          const escapedHtml = ifr.htmlContent.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
          return `<iframe${beforeSrc}srcdoc="${escapedHtml}"`;
        } else if (ifr.replacementUrl.trim().length > 0) {
          // Replace URL
          return match.replace(url, ifr.replacementUrl);
        }
      }
      return match;
    });

    try {
      const client = await getAiClient(effectiveApiKey);
      if (!client) {
        throw new Error('No API key. Please open Settings and add your Gemini API key.');
      }
      const stream = await client.models.generateContentStream({
        model: 'gemini-2.0-flash',
        contents: `SYSTEM: You are a strict HTML Localization Engine and Elite Copywriter.
TASK: Translate the text content of the provided HTML into ${lang}.

LOCALIZATION & COPYWRITING INSTRUCTIONS:
- Native Adaptation: The translation must sound 100% natural to a native speaker.
- Cultural Localization: Adapt examples (names, locations, currencies) for the target audience.
- Persuasion Preservation: CRITICAL. Do NOT alter the psychological triggers, persuasive structure, or the intent of calls-to-action (CTAs).
- Structural Integrity: Keep the exact flow of the copy.

TECHNICAL RULES (NON-NEGOTIABLE):
1. PRESERVE strict DOM structure. Do not add, remove, or reorder tags.
2. PRESERVE all classes, IDs, data-attributes, and inline styles exactly.
3. TRANSLATE only human-readable text nodes and 'alt'/'title'/'placeholder' attributes.
4. IFRAME SRCDOC: If an <iframe> has a 'srcdoc' attribute containing HTML, translate text content inside it.
5. OUTPUT: Return ONLY valid raw HTML code.

INPUT HTML:
${preprocessedSource}`,
      });

      let fullText = '';
      for await (const chunk of stream) {
        if (abortController.signal.aborted) throw new Error('AbortedByUser');

        const c = chunk as GenerateContentResponse;
        fullText += c.text;
        const currentLength = fullText.length;
        const ratio = currentLength / source.length;
        const progress = Math.min(95, Math.round(ratio * 100));

        setJobs(prev => ({
          ...prev,
          [jobId]: {
            ...prev[jobId],
            translatedHtml: cleanStreamedHtml(fullText),
            progress,
            tokenCount: Math.round(currentLength / 4)
          }
        }));
      }

      setJobs(prev => {
        const completedJob = { ...prev[jobId], status: 'completed' as const, progress: 100, endTime: Date.now() };
        return { ...prev, [jobId]: completedJob };
      });

      Analytics.track('job_completed', { lang, jobId, duration: Date.now() - startTime });

    } catch (err: any) {
      if (err.message === 'AbortedByUser' || err.name === 'AbortError') {
        // Already handled by stopJob UI update usually, but ensure state consistency
        console.log('Job aborted');
      } else {
        console.error(err);
        setJobs(prev => {
          const failedJob = { ...prev[jobId], status: 'error' as const, error: err.message };
          return { ...prev, [jobId]: failedJob };
        });
        Analytics.track('job_failed', { lang, jobId, error: err.message });
      }
    } finally {
      processingRefs.current.delete(jobId);
      delete jobControllers.current[jobId];
    }
  };

  // Queue Manager (Polling Effect)
  useEffect(() => {
    const jobList = Object.values(jobs) as TranslationJob[];
    const active = jobList.filter(j => j.status === 'translating');
    const queued = jobList.filter(j => j.status === 'queued');

    if (active.length < MAX_CONCURRENT_JOBS && queued.length > 0) {
      const nextJob = queued[0];
      // PASS activeProjectId to the executor
      if (activeProjectId) {
        executeTranslation(nextJob.id, nextJob.lang, sourceHtml, activeProjectId);
      }
    }

    if (isBatchRunning && active.length === 0 && queued.length === 0 && jobList.length > 0) {
      setIsBatchRunning(false);
      triggerToast("All jobs completed", 'success');
      playNotificationSound('success');
    }
  }, [jobs, isBatchRunning, sourceHtml, activeProjectId, playNotificationSound]);

  const startBatch = () => {
    trackFirstAction('start_batch');
    Analytics.track('batch_clicked', { selectedCount: selectedLangs.length });
    if (selectedLangs.length === 0) return triggerToast("Select at least one language", 'warning');
    if (!sourceHtml.trim() || sourceHtml.length < 10) return triggerToast("Source HTML looks empty", 'warning');

    setIsBatchRunning(true);
    openTab('monitor');

    const newProjectId = generateId();
    const finalTaskName = taskName.trim() || `Batch #${Date.now().toString().slice(-6)}`;

    const newJobs: Record<string, TranslationJob> = {};
    selectedLangs.forEach(lang => {
      const id = generateId();
      newJobs[id] = {
        id,
        lang,
        translatedHtml: '',
        status: 'queued',
        progress: 0,
        startTime: 0,
        tokenCount: 0,
        viewMode: 'preview'
      };
    });

    const newProject: Project = {
      id: newProjectId,
      name: finalTaskName,
      createdAt: Date.now(),
      lastModified: Date.now(),
      sourceHtml,
      globalCss,
      detectedImages,
      detectedIframes,
      jobs: newJobs,
      selectedLangs
    };

    setHistory(prev => [newProject, ...prev]);
    setActiveProjectId(newProjectId);
    setJobs(newJobs);

    // Explicit save of new project (hybrid: local + cloud)
    hybridDb.save(newProject, user?.uid);
    Analytics.track('batch_started', { count: selectedLangs.length, projectId: newProjectId });
  };

  // -- UI COMPONENTS (Sub-components for performance/organization) --

  const renderLivePreview = (html: string) => {
    const srcDoc = `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            ${globalCss}
            body { margin: 0; padding: 16px; background: transparent; color: inherit; font-family: system-ui, sans-serif; }
            img { max-width: 100%; height: auto; display: block; }
          </style>
        </head>
        <body>${html || '<div style="opacity:0.5; text-align:center; padding-top:20px;">Buffer Empty</div>'}</body>
      </html>
    `;
    return (
      <iframe
        srcDoc={srcDoc}
        className="w-full h-full border-0 bg-white dark:bg-zinc-900/50"
        sandbox="allow-scripts"
        title="preview"
      />
    );
  };

  // -- MAIN RENDER --
  if (authLoading) {
    return (
      <div className="min-h-screen bg-zinc-50 dark:bg-[#050505] flex items-center justify-center">
        {uiFlags.base ? (
          <div className="w-full max-w-sm space-y-3 p-6">
            <Skeleton variant="line" />
            <Skeleton variant="card" />
            <Skeleton variant="line" />
          </div>
        ) : (
          <div className="animate-pulse text-zinc-400 font-mono text-xs uppercase tracking-widest">Loading...</div>
        )}
      </div>
    );
  }

  if (isFirebaseConfigured && !user) {
    return (
      <div className="min-h-screen bg-zinc-50 dark:bg-[#050505] flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white dark:bg-[#121212] p-8 rounded-3xl border border-zinc-200 dark:border-white/5 shadow-2xl flex flex-col items-center text-center gap-6">
          <LokalyzeLogo />
          <h1 className="text-2xl font-black tracking-tight text-zinc-900 dark:text-white mt-4">Welcome to Lokalyze</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">Please sign in to access your workspace and translation history.</p>
          {uiFlags.auth ? (
            <div className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-left text-[11px] text-zinc-600 dark:border-white/10 dark:bg-black/30 dark:text-zinc-300">
              <p className="font-bold uppercase tracking-wider text-[10px]">What happens next</p>
              <p className="mt-1">Your projects stay available locally and can sync to cloud when configured.</p>
            </div>
          ) : null}
          <button
            onClick={handleLogin}
            aria-label="Sign in with Google"
            className="lk-focus-visible w-full h-12 bg-violet-600 hover:bg-violet-700 text-white rounded-xl font-bold uppercase tracking-widest text-[11px] transition-colors flex items-center justify-center gap-3 mt-4"
          >
            <Icons.User /> Sign in with Google
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-[#050505] text-zinc-900 dark:text-[#eee] font-sans selection:bg-violet-500/30 overflow-x-hidden transition-colors duration-300 flex flex-col">

      {/* Settings Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        userApiKey={userApiKey}
        onApiKeyChange={setUserApiKey}
        onSave={saveSettings}
        user={user}
        onLogout={handleLogout}
        v2Enabled={uiFlags.settings}
      />

      <ConfirmModal
        isOpen={Boolean(pendingHistoryDelete)}
        title="Delete Project History"
        description={pendingHistoryDelete
          ? `Delete "${pendingHistoryDelete.name}" from history? This cannot be undone.`
          : 'Delete this project from history?'}
        confirmLabel="Delete Project"
        cancelLabel="Keep Project"
        loading={isDeletingProject}
        onConfirm={() => { void confirmDeleteProject(); }}
        onCancel={() => {
          if (isDeletingProject) return;
          setPendingHistoryDelete(null);
        }}
      />

      {/* Toast Notification */}
      {notification && (
        <div className={cn("fixed top-6 right-6 z-50 animate-[slideIn_0.3s_ease-out] flex items-center gap-3 px-5 py-3 rounded-xl shadow-2xl shadow-black/20 border", toastVariantStyles[notification.type])}>
          <div className={cn("w-2 h-2 rounded-full animate-pulse", notification.type === 'success' ? 'bg-emerald-300' : notification.type === 'error' ? 'bg-red-300' : notification.type === 'warning' ? 'bg-amber-300' : 'bg-sky-300')} />
          <span className="text-xs font-bold uppercase tracking-wider">{notification.message}</span>
        </div>
      )}

      {/* Navigation */}
      <nav className="border-b border-zinc-200 dark:border-white/5 bg-white/50 dark:bg-black/50 backdrop-blur-xl sticky top-0 z-40 shrink-0">
        <div className="max-w-[1800px] mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <LokalyzeLogo />
            <div className="h-4 w-px bg-zinc-300 dark:bg-white/10 mx-2 hidden md:block"></div>
            <span className="hidden md:inline-block text-[10px] font-bold uppercase tracking-widest text-zinc-400">Workspace / Local</span>
          </div>
          <div className="flex items-center gap-4">
            <div className="hidden md:flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-zinc-400 bg-zinc-100 dark:bg-white/5 px-3 py-1.5 rounded-full">
              <span>Status:</span>
              <span className={`flex items-center gap-1.5 ${isBatchRunning ? 'text-emerald-500' : 'text-zinc-500'}`}>
                <span className={`w-1.5 h-1.5 rounded-full bg-current ${isBatchRunning ? 'animate-pulse' : ''}`} />
                {isBatchRunning ? 'Processing' : 'Ready'}
              </span>
            </div>
            {uiFlags.shell ? (
              <Badge tone={syncModeLabel === 'Cloud Sync' ? 'info' : 'neutral'}>{syncModeLabel}</Badge>
            ) : null}
            {perfV1Enabled ? (
              <div className="hidden lg:flex items-center gap-2 rounded-full border border-zinc-200 bg-zinc-100 px-3 py-1 text-[9px] font-mono text-zinc-500 dark:border-zinc-800 dark:bg-black/40 dark:text-zinc-300">
                <span>JS {perfSnapshot.bundleBytes > 0 ? `${Math.round(perfSnapshot.bundleBytes / 1024)}kb` : '--'}</span>
                <span>•</span>
                <span>TTFA {perfSnapshot.initialRenderMs || 0}ms</span>
                <span>•</span>
                <span>Tab {perfSnapshot.tabSwitchMs || 0}ms</span>
              </div>
            ) : null}

            <Tooltip content={soundEnabled ? "Mute Sounds" : "Enable Sounds"}>
              <button aria-label={soundEnabled ? "Mute sounds" : "Enable sounds"} onClick={() => setSoundEnabled(!soundEnabled)} className={`lk-focus-visible w-8 h-8 rounded-lg border flex items-center justify-center transition-colors ${soundEnabled ? 'border-zinc-200 dark:border-zinc-800 text-violet-500 bg-violet-50 dark:bg-violet-500/10' : 'border-zinc-200 dark:border-zinc-800 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'}`}>
                {soundEnabled ? <Icons.Volume2 /> : <Icons.VolumeX />}
              </button>
            </Tooltip>

            <Tooltip content="Settings">
              <button aria-label="Open settings" onClick={() => setIsSettingsOpen(true)} className="lk-focus-visible w-8 h-8 rounded-lg border border-zinc-200 dark:border-zinc-800 flex items-center justify-center hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors text-zinc-500">
                <Icons.Settings />
              </button>
            </Tooltip>
            <Tooltip content="Toggle Theme">
              <button aria-label="Toggle theme" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} className="lk-focus-visible w-8 h-8 rounded-lg border border-zinc-200 dark:border-zinc-800 flex items-center justify-center hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors">
                {theme === 'dark' ? '☼' : '☾'}
              </button>
            </Tooltip>
          </div>
        </div>
      </nav>

      {/* MAIN CONTENT AREA */}
      <main className="flex-1 w-full max-w-[1800px] mx-auto p-4 md:p-6 grid grid-cols-1 xl:grid-cols-12 gap-6 h-auto xl:h-[calc(100vh-64px)] pb-24">
        {uiFlags.onboarding && !onboardingDismissed && history.length === 0 ? (
          <section className="xl:col-span-12 rounded-2xl border border-violet-200 bg-violet-50 px-4 py-3 dark:border-violet-500/30 dark:bg-violet-500/10">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-violet-700 dark:text-violet-300">Quick Start</p>
                <p className="mt-1 text-xs text-violet-800 dark:text-violet-200">1) Paste HTML 2) Select languages 3) Run batch. Your first translation usually completes in under a minute.</p>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="secondary" onClick={() => setOnboardingDismissed(true)}>Dismiss</Button>
              </div>
            </div>
          </section>
        ) : null}

        {/* COLUMN 1: INPUT BUFFER */}
        <div className="xl:col-span-4 flex flex-col gap-6 h-[600px] xl:h-full overflow-hidden">

          {/* EDITOR PANEL */}
          <section className="flex-1 bg-white dark:bg-[#0e0e0e] rounded-[24px] border border-zinc-200 dark:border-white/5 shadow-xl flex flex-col overflow-hidden relative group transition-all hover:border-zinc-300 dark:hover:border-white/10">
            <div className="p-3 border-b border-zinc-100 dark:border-white/5 flex items-center justify-between bg-zinc-50/50 dark:bg-zinc-900/20 backdrop-blur-sm">
              <div className="flex bg-zinc-200/50 dark:bg-black/50 p-1 rounded-lg">
                <button onClick={() => setInputTab('html')} className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-[10px] font-bold uppercase tracking-widest transition-all ${inputTab === 'html' ? 'bg-white dark:bg-zinc-800 shadow-sm text-violet-600' : 'text-zinc-500 hover:text-zinc-400'}`}>
                  <Icons.Code /> HTML
                </button>
                <button onClick={() => setInputTab('css')} className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-[10px] font-bold uppercase tracking-widest transition-all ${inputTab === 'css' ? 'bg-white dark:bg-zinc-800 shadow-sm text-violet-600' : 'text-zinc-500 hover:text-zinc-400'}`}>
                  <Icons.Code /> CSS
                </button>
              </div>
              <div className="text-[9px] font-mono text-zinc-400 bg-zinc-100 dark:bg-white/5 px-2 py-1 rounded">
                {inputTab === 'html' ? `${sourceHtml.length}` : `${globalCss.length}`} chars
              </div>
            </div>
            {uiFlags.editor && inputTab === 'html' && sourceHtml.trim().length < 10 ? (
              <div className="px-3 py-2 border-b border-zinc-100 dark:border-white/5">
                <InlineMessage tone="warning">Source HTML looks short. Paste a complete snippet for best results.</InlineMessage>
              </div>
            ) : null}
            <div className="flex-1 w-full overflow-hidden">
              <Suspense fallback={<div className="flex items-center justify-center h-full text-zinc-400 text-xs font-mono">Loading editor...</div>}>
                <Editor
                  height="100%"
                  language={inputTab === 'html' ? 'html' : 'css'}
                  theme={theme === 'dark' ? 'vs-dark' : 'light'}
                  value={inputTab === 'html' ? sourceHtml : globalCss}
                  onChange={(value) => {
                    if (inputTab === 'html') setSourceHtml(value || '');
                    else setGlobalCss(value || '');
                  }}
                  options={{
                    minimap: { enabled: false },
                    fontSize: 12,
                    lineNumbers: 'on',
                    scrollBeyondLastLine: false,
                    automaticLayout: true,
                    padding: { top: 16, bottom: 16 },
                    wordWrap: 'on',
                    suggestOnTriggerCharacters: true,
                    quickSuggestions: true,
                    fontFamily: 'JetBrains Mono, monospace',
                  }}
                />
              </Suspense>
            </div>
          </section>

          {/* CONTROL PANEL */}
          <section className="h-[40%] min-h-[300px] bg-white dark:bg-[#0e0e0e] rounded-[24px] border border-zinc-200 dark:border-white/5 shadow-xl flex flex-col overflow-hidden relative group transition-all hover:border-zinc-300 dark:hover:border-white/10">

            {/* Header */}
            <div className="p-4 border-b border-zinc-100 dark:border-white/5 flex items-center justify-between shrink-0 bg-white dark:bg-[#0e0e0e] z-10">
              <span className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Target Selector</span>
              <span className="text-[9px] font-bold text-violet-500 bg-violet-500/10 px-2 py-0.5 rounded-full">{selectedLangs.length} Selected</span>
            </div>

            {/* Scrollable Language List */}
            <div className="flex-1 overflow-y-auto custom-scrollbar p-4">
              {uiFlags.selector ? (
                <div className="mb-3 flex items-center gap-2">
                  <button onClick={() => setLangFilter('all')} className={`lk-focus-visible rounded-lg px-2 py-1 text-[9px] font-bold uppercase tracking-widest ${langFilter === 'all' ? 'bg-violet-600 text-white' : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-900 dark:text-zinc-300'}`}>All</button>
                  <button onClick={() => setLangFilter('popular')} className={`lk-focus-visible rounded-lg px-2 py-1 text-[9px] font-bold uppercase tracking-widest ${langFilter === 'popular' ? 'bg-violet-600 text-white' : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-900 dark:text-zinc-300'}`}>Popular</button>
                  <button onClick={() => setLangFilter('recent')} className={`lk-focus-visible rounded-lg px-2 py-1 text-[9px] font-bold uppercase tracking-widest ${langFilter === 'recent' ? 'bg-violet-600 text-white' : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-900 dark:text-zinc-300'}`}>Recent</button>
                  <button onClick={() => setSelectedLangs([])} className="lk-focus-visible ml-auto rounded-lg px-2 py-1 text-[9px] font-bold uppercase tracking-widest text-zinc-500 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-white">Clear</button>
                </div>
              ) : null}
              <div className="grid grid-cols-2 gap-2">
                {displayedLanguages.length === 0 ? (
                  <div className="col-span-2 rounded-xl border border-dashed border-zinc-300 px-3 py-4 text-center text-[10px] text-zinc-500 dark:border-zinc-700 dark:text-zinc-300">
                    No languages in this filter yet.
                  </div>
                ) : null}
                {displayedLanguages.map(lang => (
                  <button
                    key={lang}
                    onClick={() => toggleLanguage(lang)}
                    className={`px-3 py-2.5 rounded-xl text-[10px] font-bold uppercase tracking-wider text-left border transition-all ${selectedLangs.includes(lang) ? 'bg-violet-600 border-violet-500 text-white shadow-lg shadow-violet-500/20' : 'bg-zinc-50 dark:bg-zinc-900/50 border-zinc-200 dark:border-zinc-800 text-zinc-500 hover:border-zinc-300 dark:hover:border-zinc-700'}`}
                  >
                    <div className="flex items-center justify-between w-full">
                      <span>{lang}</span>
                      {selectedLangs.includes(lang) && <Icons.Check />}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Sticky Footer CTA */}
            <div className="p-4 bg-white/80 dark:bg-[#0e0e0e]/80 backdrop-blur-md border-t border-zinc-100 dark:border-white/5 shrink-0 z-10 space-y-3">

              {/* Task Naming Input */}
              <div className="flex items-center gap-2 bg-zinc-50 dark:bg-black/50 border border-zinc-200 dark:border-white/10 rounded-lg px-3 py-2">
                <span className="text-zinc-400"><Icons.Edit /></span>
                <input
                  type="text"
                  value={taskName}
                  onChange={(e) => setTaskName(e.target.value)}
                  placeholder="Task Name (e.g. Landing Page V1)"
                  className="flex-1 bg-transparent text-[10px] font-bold text-zinc-700 dark:text-zinc-300 placeholder:text-zinc-500 outline-none"
                />
              </div>

              <div className="flex items-center justify-between px-1">
                <div className="flex items-center gap-2 text-[9px] font-bold uppercase tracking-widest text-zinc-500">
                  <Icons.Image />
                  <span>Assets Detected: {detectedImages.length}</span>
                </div>
                {imageOverrideCount > 0 && (
                  <span className="text-[9px] font-bold text-emerald-500 bg-emerald-500/10 px-2 py-0.5 rounded-full">
                    {imageOverrideCount} Overrides
                  </span>
                )}
              </div>
              <button
                onClick={startBatch}
                disabled={isBatchRunning}
                className="w-full py-4 bg-zinc-900 dark:bg-white text-white dark:text-black rounded-xl text-[10px] font-black uppercase tracking-[0.2em] hover:scale-[1.01] active:scale-[0.99] transition-all disabled:opacity-50 disabled:scale-100 shadow-xl flex items-center justify-center gap-3"
              >
                {isBatchRunning ? <span className="animate-spin">⏳</span> : <Icons.Cpu />}
                {isBatchRunning ? 'Processing Batch...' : 'Initialize Batch'}
              </button>
            </div>
          </section>
        </div>

        {/* COLUMN 2: MAINFRAME MONITOR & ASSETS */}
        <div className="xl:col-span-8 flex flex-col gap-6 h-[800px] xl:h-full overflow-hidden">

          {/* Dashboard Header / Tabs */}
          <div className="flex items-center gap-2 shrink-0 overflow-x-auto no-scrollbar pb-1">
            <button onClick={() => openTab('monitor')} className={`px-6 py-2.5 rounded-full text-[10px] font-black uppercase tracking-widest border transition-all flex items-center gap-2 whitespace-nowrap ${activeTab === 'monitor' ? 'bg-white dark:bg-[#0e0e0e] border-zinc-200 dark:border-white/10 text-violet-500 shadow-xl' : 'border-transparent text-zinc-400 hover:text-zinc-600 hover:bg-white/50 dark:hover:bg-white/5'}`}>
              <Icons.Cpu /> Live Monitor
            </button>
            <button onClick={() => openTab('assets')} className={`px-6 py-2.5 rounded-full text-[10px] font-black uppercase tracking-widest border transition-all flex items-center gap-2 whitespace-nowrap ${activeTab === 'assets' ? 'bg-white dark:bg-[#0e0e0e] border-zinc-200 dark:border-white/10 text-violet-500 shadow-xl' : 'border-transparent text-zinc-400 hover:text-zinc-600 hover:bg-white/50 dark:hover:bg-white/5'}`}>
              <Icons.Image /> Asset Manager <span className="ml-1 bg-zinc-200 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 px-1.5 py-0.5 rounded-md text-[9px]">{totalAssetsDetected}</span>
            </button>
            <button onClick={() => openTab('history')} className={`px-6 py-2.5 rounded-full text-[10px] font-black uppercase tracking-widest border transition-all flex items-center gap-2 whitespace-nowrap ${activeTab === 'history' ? 'bg-white dark:bg-[#0e0e0e] border-zinc-200 dark:border-white/10 text-violet-500 shadow-xl' : 'border-transparent text-zinc-400 hover:text-zinc-600 hover:bg-white/50 dark:hover:bg-white/5'}`}>
              <Icons.History /> History <span className="ml-1 bg-zinc-200 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 px-1.5 py-0.5 rounded-md text-[9px]">{history.length}</span>
            </button>
          </div>

          <div className="flex-1 bg-white dark:bg-[#0e0e0e] rounded-[32px] border border-zinc-200 dark:border-white/5 shadow-2xl overflow-hidden relative transition-all hover:border-zinc-300 dark:hover:border-white/10">

            {activeTab === 'monitor' ? (
              <div className="flex h-full flex-col lg:flex-row">
                {/* LIST VIEW - FIXED: Use w-96 fixed width on desktop to prevent shrinking, hidden on mobile when detailed view active */}
                <div className={`${focusedJobId ? 'hidden lg:flex' : 'flex'} w-full lg:w-96 shrink-0 flex-col border-r border-zinc-100 dark:border-white/5 transition-all duration-300 h-full`}>
                  <div className="p-4 border-b border-zinc-100 dark:border-white/5 flex justify-between items-start bg-zinc-50/50 dark:bg-black/20 shrink-0">
                    <div className="flex flex-col gap-2">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Process Queue</span>
                        {uiFlags.monitor ? (
                          <Badge tone="info">{monitorDensity === 'compact' ? 'Compact' : 'Comfortable'}</Badge>
                        ) : null}
                      </div>
                      {activeProjectId && <span className="text-[9px] font-bold text-violet-500 mt-0.5 truncate max-w-[200px]">{activeProject?.name}</span>}
                      {uiFlags.monitor ? (
                        <div className="flex flex-wrap gap-1 pt-1">
                          <span className={cn("rounded-md px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider", statusVariantStyles.queued)}>Queued</span>
                          <span className={cn("rounded-md px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider", statusVariantStyles.translating)}>Running</span>
                          <span className={cn("rounded-md px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider", statusVariantStyles.completed)}>Done</span>
                          <span className={cn("rounded-md px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider", statusVariantStyles.error)}>Error</span>
                          <span className={cn("rounded-md px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider", statusVariantStyles.stopped)}>Stopped</span>
                        </div>
                      ) : null}
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <span className="text-[9px] font-mono text-zinc-500">{jobsList.length} Threads</span>
                      {uiFlags.monitor ? (
                        <button
                          onClick={() => setMonitorDensity(prev => prev === 'comfortable' ? 'compact' : 'comfortable')}
                          className="lk-focus-visible rounded-lg border border-zinc-200 px-2 py-1 text-[9px] font-bold uppercase tracking-widest text-zinc-500 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
                        >
                          {monitorDensity === 'comfortable' ? 'Compact' : 'Comfort'}
                        </button>
                      ) : null}
                    </div>
                  </div>
                  <div className={cn("flex-1 overflow-y-auto custom-scrollbar bg-zinc-50/30 dark:bg-black/10", monitorDensity === 'compact' ? 'p-2 space-y-2' : 'p-4 space-y-3')}>
                    {jobsList.length === 0 && (
                      uiFlags.monitor ? (
                        <EmptyState
                          icon={<span className="text-3xl">⚡</span>}
                          title="System Ready"
                          body="Paste HTML source, select languages, and initialize a batch to start the queue."
                        />
                      ) : (
                        <div className="h-full flex flex-col items-center justify-center opacity-40 gap-6 p-6">
                          <div className="w-20 h-20 rounded-3xl bg-zinc-100 dark:bg-white/5 flex items-center justify-center text-3xl grayscale">⚡</div>
                          <div className="text-center space-y-4 max-w-[200px]">
                            <p className="text-xs font-bold uppercase tracking-widest text-zinc-400">System Ready</p>
                            <div className="text-left space-y-3">
                              <div className="flex items-center gap-3">
                                <span className="w-5 h-5 rounded-full bg-zinc-200 dark:bg-white/10 flex items-center justify-center text-[9px] font-bold">1</span>
                                <span className="text-[10px] text-zinc-500">Paste HTML source</span>
                              </div>
                              <div className="flex items-center gap-3">
                                <span className="w-5 h-5 rounded-full bg-zinc-200 dark:bg-white/10 flex items-center justify-center text-[9px] font-bold">2</span>
                                <span className="text-[10px] text-zinc-500">Select Languages</span>
                              </div>
                              <div className="flex items-center gap-3">
                                <span className="w-5 h-5 rounded-full bg-zinc-200 dark:bg-white/10 flex items-center justify-center text-[9px] font-bold">3</span>
                                <span className="text-[10px] text-zinc-500">Initialize Batch</span>
                              </div>
                            </div>
                          </div>
                        </div>
                      )
                    )}
                    {visibleJobs.map(job => (
                      <div
                        key={job.id}
                        onClick={() => openJobDetail(job.id)}
                        style={virtualListsEnabled ? { contentVisibility: 'auto', containIntrinsicSize: monitorDensity === 'compact' ? '84px' : '102px' } : undefined}
                        className={`group cursor-pointer rounded-2xl border transition-all hover:bg-white dark:hover:bg-white/5 hover:shadow-lg relative overflow-hidden ${monitorDensity === 'compact' ? 'p-2.5' : 'p-4'} ${focusedJobId === job.id ? 'bg-white dark:bg-violet-900/10 border-violet-500/50 ring-1 ring-violet-500/20 shadow-xl' : 'bg-white dark:bg-[#121212] border-zinc-200 dark:border-white/5'}`}
                      >
                        <div className={cn("flex justify-between items-center relative z-10", monitorDensity === 'compact' ? 'mb-2' : 'mb-3')}>
                          <div className="flex items-center gap-3">
                            <div className={`w-2 h-8 rounded-full ${job.status === 'completed' ? 'bg-emerald-500' : job.status === 'error' ? 'bg-red-500' : job.status === 'stopped' ? 'bg-orange-400' : job.status === 'translating' ? 'bg-violet-500 animate-pulse' : 'bg-zinc-300'}`}></div>
                            <div>
                              <span className={cn("font-black uppercase tracking-tight block", monitorDensity === 'compact' ? 'text-[11px]' : 'text-xs')}>{job.lang}</span>
                              {job.endTime && <span className="text-[9px] text-zinc-400 font-mono">{formatDuration(job.endTime - job.startTime)}</span>}
                            </div>
                          </div>
                          <span className={cn("px-2 py-0.5 rounded-full font-bold uppercase tracking-widest", statusVariantStyles[job.status], monitorDensity === 'compact' ? 'text-[8px]' : 'text-[10px]')}>
                            {job.status === 'completed' ? 'Done' : job.status === 'error' ? 'Error' : job.status === 'stopped' ? 'Stopped' : job.status === 'translating' ? 'Running' : 'Queued'}
                          </span>
                        </div>
                        <div className="h-1.5 w-full bg-zinc-100 dark:bg-black rounded-full overflow-hidden relative z-10">
                          <div className={`h-full transition-all duration-300 ${job.status === 'error' ? 'bg-red-500' : job.status === 'completed' ? 'bg-emerald-500' : job.status === 'stopped' ? 'bg-orange-400' : 'bg-violet-500'}`} style={{ width: `${job.progress}%` }} />
                        </div>
                        <div className={cn("flex justify-between items-center text-[9px] font-mono text-zinc-400 relative z-10 opacity-60 group-hover:opacity-100 transition-opacity", monitorDensity === 'compact' ? 'mt-1' : 'mt-2')}>
                          <span>{job.tokenCount > 0 ? `${(job.tokenCount / 1000).toFixed(1)}k tokens` : '0 tokens'}</span>
                          <span>{job.progress}%</span>
                        </div>

                        {/* STOP BUTTON OVERLAY */}
                        {job.status === 'translating' && (
                          <button
                            onClick={(e) => { e.stopPropagation(); stopJob(job.id); }}
                            className="absolute right-4 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-all bg-white dark:bg-zinc-800 p-1.5 rounded-lg shadow-lg hover:text-red-500 z-50 border border-zinc-200 dark:border-white/10"
                            title="Stop Generation"
                          >
                            <Icons.Close />
                          </button>
                        )}

                        {(job.status === 'error' || job.status === 'stopped') && (
                          <button
                            onClick={(e) => { e.stopPropagation(); retryJob(job.id); }}
                            className="absolute right-4 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-all bg-white dark:bg-zinc-800 px-2 py-1 rounded-lg shadow-lg hover:text-violet-500 z-50 border border-zinc-200 dark:border-white/10 text-[9px] font-bold uppercase tracking-widest"
                            title="Retry Job"
                          >
                            Retry
                          </button>
                        )}

                        <div className="absolute right-4 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity text-zinc-400 lg:hidden pointer-events-none">
                          <Icons.ChevronRight />
                        </div>
                      </div>
                    ))}
                    {virtualListsEnabled && visibleJobs.length < jobsList.length ? (
                      <button
                        onClick={() => setJobRenderLimit(prev => prev + 80)}
                        className="lk-focus-visible w-full rounded-xl border border-dashed border-zinc-300 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-zinc-500 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
                      >
                        Load more jobs ({jobsList.length - visibleJobs.length} remaining)
                      </button>
                    ) : null}
                  </div>
                </div>

                {/* DRILL DOWN VIEW - FIXED: Flex-1 ensures it takes remaining space, min-w-0 prevents overflow */}
                {focusedJobId && jobs[focusedJobId] ? (
                  <div className="flex-1 flex flex-col h-full bg-zinc-50 dark:bg-[#0a0a0a] min-w-0">
                    <div className="p-4 border-b border-zinc-200 dark:border-white/5 flex justify-between items-center bg-white dark:bg-[#0e0e0e] shrink-0">
                      <div className="flex items-center gap-3">
                        <button onClick={closeJobDetail} className="lg:hidden w-8 h-8 rounded-lg border border-zinc-200 dark:border-white/10 flex items-center justify-center text-zinc-500">←</button>
                        <div>
                          <h2 className="text-xl font-black tracking-tighter flex items-center gap-3">
                            {jobs[focusedJobId].lang}
                            <span className={cn("px-2 py-0.5 rounded-md text-[9px] uppercase tracking-widest", statusVariantStyles[jobs[focusedJobId].status])}>{jobs[focusedJobId].status}</span>
                          </h2>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        {jobs[focusedJobId].status === 'completed' && (
                          <>
                            <Tooltip content="Download File">
                              <button onClick={() => downloadHtml(jobs[focusedJobId].lang, jobs[focusedJobId].translatedHtml)} className="h-9 px-3 rounded-lg bg-zinc-100 dark:bg-zinc-800 flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors">
                                <Icons.Download /> <span className="hidden sm:inline">Save</span>
                              </button>
                            </Tooltip>
                            <Tooltip content="Copy HTML">
                              <button aria-label="Copy translated HTML" onClick={() => copyToClipboard(jobs[focusedJobId].translatedHtml)} className="h-9 px-3 rounded-lg bg-zinc-100 dark:bg-zinc-800 flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors">
                                <Icons.Copy /> <span className="hidden sm:inline">Copy</span>
                              </button>
                            </Tooltip>
                          </>
                        )}
                        <div className="w-px h-9 bg-zinc-200 dark:bg-white/10 mx-1"></div>
                        <Tooltip content="Toggle View">
                          <button onClick={() => setJobs(prev => ({ ...prev, [focusedJobId]: { ...prev[focusedJobId], viewMode: prev[focusedJobId].viewMode === 'preview' ? 'code' : 'preview' } }))} className="h-9 px-3 rounded-lg bg-violet-50 dark:bg-violet-500/10 text-violet-600 dark:text-violet-400 border border-violet-200 dark:border-violet-500/20 flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest hover:bg-violet-100 dark:hover:bg-violet-500/20 transition-colors">
                            {jobs[focusedJobId].viewMode === 'preview' ? <><Icons.Code /> Code</> : <><Icons.Eye /> Preview</>}
                          </button>
                        </Tooltip>
                        <Tooltip content="Close Detail">
                          <button onClick={closeJobDetail} className="hidden lg:flex w-9 h-9 rounded-lg border border-zinc-200 dark:border-white/10 items-center justify-center text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors">
                            <Icons.Close />
                          </button>
                        </Tooltip>
                      </div>
                    </div>
                    <div className="flex-1 overflow-hidden relative">
                      {(jobs[focusedJobId].status === 'error' || jobs[focusedJobId].status === 'stopped') && uiFlags.monitor ? (
                        <div className="p-4 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#0e0e0e]">
                          <InlineMessage tone={jobs[focusedJobId].status === 'error' ? 'error' : 'warning'}>
                            <div className="flex flex-wrap items-center gap-3">
                              <span>{jobs[focusedJobId].error || 'This job was interrupted before completion.'}</span>
                              <Button variant="secondary" onClick={() => retryJob(focusedJobId)}>Retry Job</Button>
                            </div>
                          </InlineMessage>
                        </div>
                      ) : null}
                      {jobs[focusedJobId].viewMode === 'preview' ? (
                        renderLivePreview(jobs[focusedJobId].translatedHtml)
                      ) : (
                        <Suspense fallback={<div className="flex items-center justify-center h-full text-zinc-400 text-xs font-mono">Loading editor...</div>}>
                          <Editor
                            height="100%"
                            language="html"
                            theme={theme === 'dark' ? 'vs-dark' : 'light'}
                            value={jobs[focusedJobId].translatedHtml}
                            options={{
                              readOnly: true,
                              minimap: { enabled: false },
                              fontSize: 12,
                              lineNumbers: 'on',
                              scrollBeyondLastLine: false,
                              automaticLayout: true,
                              padding: { top: 16, bottom: 16 },
                              wordWrap: 'on',
                              fontFamily: 'JetBrains Mono, monospace',
                            }}
                          />
                        </Suspense>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="flex-1 hidden lg:flex flex-col items-center justify-center text-zinc-300 dark:text-zinc-700 bg-zinc-50/50 dark:bg-black/20 p-8">
                    {uiFlags.monitor ? (
                      <EmptyState
                        icon={<span className="text-5xl opacity-50">⚡</span>}
                        title="Mainframe Output"
                        body="Select a queue item to inspect preview, code, copy output, or download assets."
                      />
                    ) : (
                      <>
                        <div className="w-32 h-32 rounded-[2rem] bg-white dark:bg-white/5 shadow-2xl flex items-center justify-center mb-8 rotate-3">
                          <span className="text-5xl opacity-50">⚡</span>
                        </div>
                        <p className="text-xs font-black uppercase tracking-[0.2em] mb-2">Mainframe Output</p>
                        <p className="text-[10px] text-zinc-400 max-w-xs text-center leading-relaxed">Select a completed job from the queue to inspect the code, preview the render, or download the assets.</p>
                      </>
                    )}
                  </div>
                )}
              </div>
            ) : activeTab === 'history' ? (
              // HISTORY TAB
              <div className="h-full flex flex-col">
                <div className="p-6 border-b border-zinc-100 dark:border-white/5 bg-zinc-50/50 dark:bg-black/20 flex items-center justify-between shrink-0">
                  <div>
                    <h3 className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Project History</h3>
                    <p className="text-xs text-zinc-400 mt-1">Review, restore, or manage your translation batches.</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {uiFlags.history ? (
                      <select
                        value={historySort}
                        onChange={(e) => setHistorySort(e.target.value as 'recent' | 'oldest' | 'completion')}
                        className="lk-focus-visible rounded-lg border border-zinc-200 bg-white px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-zinc-600 dark:border-zinc-700 dark:bg-black dark:text-zinc-300"
                      >
                        <option value="recent">Recent</option>
                        <option value="oldest">Oldest</option>
                        <option value="completion">Completion</option>
                      </select>
                    ) : null}
                    <div className="text-[9px] bg-zinc-100 dark:bg-white/5 px-2 py-1 rounded text-zinc-400 font-mono">
                      Total Projects: {history.length}
                    </div>
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto p-6 space-y-4 custom-scrollbar">
                  {historyDeleteError ? (
                    <InlineMessage tone="error">
                      <div className="flex flex-wrap items-center gap-2">
                        <span>Failed to delete "{historyDeleteError.name}": {historyDeleteError.message}</span>
                        <Button
                          variant="secondary"
                          onClick={() => setPendingHistoryDelete({ id: historyDeleteError.id, name: historyDeleteError.name })}
                          disabled={isDeletingProject}
                        >
                          Retry Delete
                        </Button>
                      </div>
                    </InlineMessage>
                  ) : null}
                  {isHistoryLoading ? (
                    <div className="space-y-3" aria-busy="true">
                      <Skeleton variant="card" />
                      <Skeleton variant="card" />
                      <Skeleton variant="card" />
                    </div>
                  ) : history.length === 0 ? (
                    uiFlags.history ? (
                      <EmptyState
                        icon={<Icons.History />}
                        title="No History Found"
                        body="Start a translation batch to create your first recoverable project."
                      />
                    ) : (
                      <div className="h-full flex flex-col items-center justify-center border-2 border-dashed border-zinc-200 dark:border-zinc-800 rounded-3xl p-10 opacity-50">
                        <Icons.History />
                        <p className="text-xs font-bold text-zinc-400 uppercase mt-4">No History Found</p>
                        <p className="text-[10px] text-zinc-500 mt-2">Start a translation batch to create a history record.</p>
                      </div>
                    )
                  ) : (
                    visibleHistory.map((project) => (
                      <div
                        key={project.id}
                        style={virtualListsEnabled ? { contentVisibility: 'auto', containIntrinsicSize: '156px' } : undefined}
                        className={`flex flex-col md:flex-row items-center justify-between gap-6 p-6 bg-white dark:bg-[#121212] rounded-3xl border border-zinc-200 dark:border-white/5 group hover:border-violet-500/30 hover:shadow-lg transition-all ${activeProjectId === project.id ? 'ring-1 ring-violet-500/50 border-violet-500/30' : ''}`}
                      >
                        <div className="flex items-center gap-4 w-full md:w-auto">
                          <div className={`w-12 h-12 rounded-2xl flex items-center justify-center text-lg ${activeProjectId === project.id ? 'bg-violet-500 text-white shadow-lg shadow-violet-500/30' : 'bg-zinc-100 dark:bg-white/5 text-zinc-400'}`}>
                            {activeProjectId === project.id ? <span className="animate-pulse">●</span> : <Icons.History />}
                          </div>
                          <div>
                            <h4 className="text-sm font-bold text-zinc-800 dark:text-zinc-200">{project.name}</h4>
                            <div className="flex items-center gap-3 mt-1 text-[10px] text-zinc-400 font-mono">
                              <span>{formatDate(project.createdAt)}</span>
                              <span className="w-1 h-1 rounded-full bg-zinc-300 dark:bg-zinc-700" />
                              <span>{Object.keys(project.jobs || {}).length} Languages</span>
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 w-full md:w-auto justify-end">
                          <div className="hidden md:flex flex-col items-end mr-4">
                            <span className="text-[9px] font-bold uppercase tracking-widest text-zinc-500">Completion</span>
                            <div className="w-24 h-1.5 bg-zinc-100 dark:bg-black rounded-full mt-1 overflow-hidden">
                              <div className="h-full bg-emerald-500" style={{ width: `${((Object.values(project.jobs || {}) as TranslationJob[]).filter(j => j.status === 'completed').length / Math.max(1, Object.keys(project.jobs || {}).length)) * 100}%` }} />
                            </div>
                          </div>
                          <button
                            onClick={() => loadProject(project)}
                            disabled={isBatchRunning}
                            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-[10px] font-bold uppercase tracking-widest text-zinc-600 dark:text-zinc-400 transition-colors disabled:opacity-50"
                          >
                            <Icons.Refresh /> Load
                          </button>
                          <button
                            aria-label={`Delete project ${project.name}`}
                            onClick={(e) => requestDeleteProject(e, project.id, project.name)}
                            disabled={isDeletingProject}
                            className="p-2 rounded-xl text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors disabled:opacity-50"
                          >
                            <Icons.Trash />
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                  {virtualListsEnabled && visibleHistory.length < historyList.length ? (
                    <button
                      onClick={() => setHistoryRenderLimit(prev => prev + 80)}
                      className="lk-focus-visible w-full rounded-xl border border-dashed border-zinc-300 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-zinc-500 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
                    >
                      Load more history ({historyList.length - visibleHistory.length} remaining)
                    </button>
                  ) : null}
                </div>
              </div>
            ) : (
              // ASSET & RESOURCE MANAGER TAB
              <div className="h-full flex flex-col">
                <div className="p-6 border-b border-zinc-100 dark:border-white/5 bg-zinc-50/50 dark:bg-black/20 flex items-center justify-between shrink-0">
                  <div>
                    <h3 className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Resource Registry</h3>
                    <p className="text-xs text-zinc-400 mt-1">Define overrides for images and iframes. The engine will strictly replace these sources.</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={downloadAllAssets}
                      disabled={isDownloadingAssets || detectedImages.length === 0}
                      className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-[10px] font-bold uppercase tracking-widest text-zinc-600 dark:text-zinc-400 transition-colors disabled:opacity-50"
                    >
                      {isDownloadingAssets ? <span className="animate-spin">⏳</span> : <Icons.Archive />}
                      {isDownloadingAssets ? 'Zipping...' : 'Download Assets'}
                    </button>
                    <div className="text-[9px] bg-zinc-100 dark:bg-white/5 px-2 py-1 rounded text-zinc-400 font-mono">
                      Scan Active
                    </div>
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto p-6 space-y-8 custom-scrollbar">
                  {assetInlineError ? (
                    <InlineMessage tone="error">
                      <div className="flex flex-wrap items-center gap-2">
                        <span>{assetInlineError}</span>
                        {assetRetryContext ? (
                          <Button variant="secondary" onClick={retryLastAssetAction} disabled={isDownloadingAssets}>
                            Retry
                          </Button>
                        ) : null}
                      </div>
                    </InlineMessage>
                  ) : null}
                  {uiFlags.assets && detectedImages.length === 0 && detectedIframes.length === 0 ? (
                    <EmptyState
                      icon={<Icons.Image />}
                      title="No assets detected"
                      body="Add image or iframe tags to your HTML and return here to configure overrides."
                    />
                  ) : null}

                  {/* SECTION: IFRAMES */}
                  {detectedIframes.length > 0 && (
                    <div className="space-y-4">
                      <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-zinc-400">
                        <Icons.Globe /> <span>Detected Iframes / Widgets</span>
                      </div>
                      {visibleDetectedIframes.map((iframe) => (
                        <div
                          key={iframe.id}
                          style={virtualListsEnabled ? { contentVisibility: 'auto', containIntrinsicSize: '300px' } : undefined}
                          className="flex flex-col gap-4 p-6 bg-white dark:bg-[#121212] rounded-3xl border border-zinc-200 dark:border-white/5 border-l-4 border-l-indigo-500 group hover:border-indigo-500/30 hover:shadow-lg transition-all"
                        >
                          <div className="flex flex-col gap-2">
                            <label className="text-[9px] font-black uppercase tracking-widest text-zinc-400 flex items-center justify-between">
                              <span>Original Frame Source</span>
                              <div className="flex items-center gap-2">
                                <Badge tone={iframe.htmlContent ? 'success' : iframe.replacementUrl ? 'info' : 'neutral'}>
                                  {iframe.htmlContent ? 'Deep' : iframe.replacementUrl ? 'Override' : 'Untouched'}
                                </Badge>
                                <button aria-label="Copy iframe source URL" onClick={() => copyToClipboard(iframe.originalUrl)} className="text-zinc-400 hover:text-indigo-500">
                                  <Icons.Copy />
                                </button>
                              </div>
                            </label>
                            <code className="text-[10px] bg-zinc-50 dark:bg-black px-3 py-2 rounded-lg border border-zinc-200 dark:border-white/10 text-zinc-500 truncate font-mono select-all">{iframe.originalUrl}</code>
                          </div>

                          {/* Option A */}
                          <div className="flex flex-col gap-2">
                            <label className="text-[9px] font-black uppercase tracking-widest text-indigo-500">Option A: Replace Source URL</label>
                            <div className="relative">
                              <input
                                type="text"
                                value={iframe.replacementUrl}
                                onChange={(e) => updateIframeUrl(iframe.id, e.target.value)}
                                placeholder="https://..."
                                className="w-full bg-zinc-50 dark:bg-black pl-3 pr-10 py-2.5 rounded-xl text-[11px] border border-zinc-200 dark:border-zinc-800 focus:border-indigo-500 outline-none transition-all shadow-sm focus:shadow-indigo-500/10 font-mono"
                              />
                              {iframe.replacementUrl && (
                                <div className="absolute right-3 top-1/2 -translate-y-1/2 text-emerald-500">
                                  <Icons.Check />
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Option B: Deep Translate */}
                          {uiFlags.assets ? (
                            <details className="rounded-xl border border-zinc-200 bg-zinc-50/70 p-3 dark:border-zinc-800 dark:bg-black/40" open={Boolean(iframe.htmlContent)}>
                              <summary className="cursor-pointer text-[10px] font-black uppercase tracking-widest text-indigo-500">
                                Option B: Deep Translate
                              </summary>
                              <div className="mt-3 flex flex-col gap-2">
                                <p className="text-[9px] text-zinc-500">
                                  Paste Source HTML from this iframe to translate and inject using <code>srcdoc</code>.
                                </p>
                                <div className="relative group/editor h-32 w-full overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800">
                                  <Suspense fallback={<div className="flex items-center justify-center h-full text-zinc-400 text-xs font-mono">Loading...</div>}>
                                    <Editor
                                      height="100%"
                                      language="html"
                                      theme={theme === 'dark' ? 'vs-dark' : 'light'}
                                      value={iframe.htmlContent || ''}
                                      onChange={(value) => updateIframeHtml(iframe.id, value || '')}
                                      options={{
                                        minimap: { enabled: false },
                                        fontSize: 10,
                                        lineNumbers: 'off',
                                        scrollBeyondLastLine: false,
                                        automaticLayout: true,
                                        padding: { top: 8, bottom: 8 },
                                        wordWrap: 'on',
                                        fontFamily: 'JetBrains Mono, monospace',
                                      }}
                                    />
                                  </Suspense>
                                  {iframe.htmlContent && (
                                    <div className="absolute right-3 top-3 text-emerald-500 bg-emerald-500/10 p-1 rounded z-10">
                                      <Icons.Check />
                                    </div>
                                  )}
                                </div>
                              </div>
                            </details>
                          ) : (
                            <div className="flex flex-col gap-2">
                              <label className="text-[9px] font-black uppercase tracking-widest text-indigo-400 flex items-center gap-2">
                                Option B: Deep Translate <span className="text-zinc-500 font-normal normal-case tracking-normal">(Paste Source HTML)</span>
                              </label>
                              <div className="relative group/editor h-32 w-full overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800">
                                <Suspense fallback={<div className="flex items-center justify-center h-full text-zinc-400 text-xs font-mono">Loading...</div>}>
                                  <Editor
                                    height="100%"
                                    language="html"
                                    theme={theme === 'dark' ? 'vs-dark' : 'light'}
                                    value={iframe.htmlContent || ''}
                                    onChange={(value) => updateIframeHtml(iframe.id, value || '')}
                                    options={{
                                      minimap: { enabled: false },
                                      fontSize: 10,
                                      lineNumbers: 'off',
                                      scrollBeyondLastLine: false,
                                      automaticLayout: true,
                                      padding: { top: 8, bottom: 8 },
                                      wordWrap: 'on',
                                      fontFamily: 'JetBrains Mono, monospace',
                                    }}
                                  />
                                </Suspense>
                                {iframe.htmlContent && (
                                  <div className="absolute right-3 top-3 text-emerald-500 bg-emerald-500/10 p-1 rounded z-10">
                                    <Icons.Check />
                                  </div>
                                )}
                              </div>
                              <p className="text-[9px] text-zinc-500">
                                Paste the iframe's internal HTML here. The engine will translate it and inject it using <code>srcdoc</code>, bypassing the external URL.
                              </p>
                            </div>
                          )}

                        </div>
                      ))}
                      {virtualListsEnabled && visibleDetectedIframes.length < detectedIframes.length ? (
                        <button
                          onClick={() => setIframeRenderLimit(prev => prev + 40)}
                          className="lk-focus-visible w-full rounded-xl border border-dashed border-zinc-300 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-zinc-500 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
                        >
                          Load more iframes ({detectedIframes.length - visibleDetectedIframes.length} remaining)
                        </button>
                      ) : null}
                    </div>
                  )}

                  {/* SECTION: IMAGES */}
                  <div className="space-y-4">
                    <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-zinc-400">
                      <Icons.Image /> <span>Detected Images</span>
                    </div>
                    {detectedImages.length === 0 ? (
                      uiFlags.assets ? (
                        <EmptyState
                          icon={<Icons.Image />}
                          title="No image tags found"
                          body="Add one or more <img> tags in your source HTML to use image overrides."
                          ctaLabel="Open HTML Input"
                          onCta={() => setInputTab('html')}
                        />
                      ) : (
                        <div className="flex flex-col items-center justify-center border-2 border-dashed border-zinc-200 dark:border-zinc-800 rounded-3xl p-10 opacity-50">
                          <Icons.Image />
                          <p className="text-xs font-bold text-zinc-400 uppercase mt-4">No &lt;img&gt; tags found</p>
                        </div>
                      )
                    ) : (
                      visibleDetectedImages.map((img) => (
                        <div
                          key={img.id}
                          style={virtualListsEnabled ? { contentVisibility: 'auto', containIntrinsicSize: '280px' } : undefined}
                          className="flex flex-col md:flex-row gap-6 p-6 bg-white dark:bg-[#121212] rounded-3xl border border-zinc-200 dark:border-white/5 group hover:border-violet-500/30 hover:shadow-lg transition-all"
                        >
                          <div className="w-full md:w-32 h-32 rounded-2xl bg-zinc-100 dark:bg-black overflow-hidden border border-zinc-200 dark:border-white/10 shrink-0 relative">
                            <img src={img.originalUrl} alt="preview" className="w-full h-full object-cover" />
                          </div>
                          <div className="flex-1 flex flex-col justify-center gap-4">
                            <div className="flex flex-col gap-1.5">
                              <label className="text-[9px] font-black uppercase tracking-widest text-zinc-400 flex items-center justify-between">
                                <span>Original Source</span>
                                <div className="flex items-center gap-1">
                                  {uiFlags.assets ? (
                                    <Badge tone={translatingImages[img.id] ? 'warning' : img.replacementUrl.startsWith('data:image') ? 'success' : img.replacementUrl ? 'info' : 'neutral'}>
                                      {translatingImages[img.id] ? 'Generating' : img.replacementUrl.startsWith('data:image') ? 'AI' : img.replacementUrl ? 'Override' : 'Untouched'}
                                    </Badge>
                                  ) : null}
                                  <Tooltip content="Download Original">
                                    <button aria-label="Download original image asset" onClick={() => downloadAsset(img.originalUrl)} className="text-zinc-400 hover:text-violet-500 p-1">
                                      <Icons.Download />
                                    </button>
                                  </Tooltip>
                                  <Tooltip content="Copy URL">
                                    <button aria-label="Copy original image URL" onClick={() => copyToClipboard(img.originalUrl)} className="text-zinc-400 hover:text-violet-500 p-1">
                                      <Icons.Copy />
                                    </button>
                                  </Tooltip>
                                </div>
                              </label>
                              <code className="text-[10px] bg-zinc-50 dark:bg-black px-3 py-2 rounded-lg border border-zinc-200 dark:border-white/10 text-zinc-500 truncate font-mono select-all">{img.originalUrl}</code>
                            </div>

                            {/* NEW: AI AUTO-TRANSLATE */}
                            <div className="flex flex-col gap-2 p-3 rounded-xl bg-violet-50 dark:bg-violet-500/5 border border-violet-100 dark:border-violet-500/20">
                              <label className="text-[9px] font-black uppercase tracking-widest text-violet-500 flex items-center gap-2">
                                <Icons.Wand /> AI Auto-Translate
                              </label>
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => translateImage(img, selectedLangs[0] || 'English')}
                                  disabled={translatingImages[img.id]}
                                  className="flex-1 px-3 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-[10px] font-bold uppercase tracking-wide transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                                >
                                  {translatingImages[img.id] ? <span className="animate-spin">⏳</span> : <Icons.Wand />}
                                  Translate to {selectedLangs[0] || 'English'}
                                </button>
                                {selectedLangs.length > 1 && (
                                  <div className="text-[9px] text-zinc-400 px-2">
                                    (Select language in panel to change target)
                                  </div>
                                )}
                              </div>
                            </div>

                            <div className="flex flex-col gap-1.5">
                              <label className="text-[9px] font-black uppercase tracking-widest text-emerald-500">Replacement Source (Manual or Generated)</label>
                              <div className="relative">
                                <input
                                  type="text"
                                  value={img.replacementUrl}
                                  onChange={(e) => updateAsset(img.id, e.target.value)}
                                  placeholder="https://..."
                                  className="w-full bg-zinc-50 dark:bg-black pl-3 pr-10 py-2.5 rounded-xl text-[11px] border border-zinc-200 dark:border-zinc-800 focus:border-emerald-500 outline-none transition-all shadow-sm focus:shadow-emerald-500/10 font-mono"
                                />
                                {img.replacementUrl && (
                                  <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
                                    <Tooltip content="Download Replacement">
                                      <button aria-label="Download replacement image asset" onClick={() => downloadAsset(img.replacementUrl, `translated-asset-${img.id}.png`)} className="text-zinc-400 hover:text-emerald-500">
                                        <Icons.Download />
                                      </button>
                                    </Tooltip>
                                    <span className="text-emerald-500"><Icons.Check /></span>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                    {virtualListsEnabled && visibleDetectedImages.length < detectedImages.length ? (
                      <button
                        onClick={() => setImageRenderLimit(prev => prev + 60)}
                        className="lk-focus-visible w-full rounded-xl border border-dashed border-zinc-300 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-zinc-500 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
                      >
                        Load more images ({detectedImages.length - visibleDetectedImages.length} remaining)
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>

      {/* FOOTER */}
      <footer className="w-full border-t border-zinc-200 dark:border-white/5 bg-white dark:bg-black py-8 mt-auto">
        <div className="max-w-[1800px] mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-6 text-[10px] text-zinc-400">
          <div className="flex flex-col md:flex-row items-center gap-4 text-center md:text-left">
            <span className="font-bold">© 2026 Lokalyze AI. Todos os direitos reservados</span>
            <span className="hidden md:inline text-zinc-600">•</span>
            <span>DBE11 LTDA • CNPJ: 53.903.617/0001-83</span>
          </div>

          <div className="flex items-center gap-6 font-medium">
            <a href="#terms" onClick={(e) => { e.preventDefault(); triggerToast("Página de Termos em breve"); }} className="hover:text-zinc-900 dark:hover:text-white transition-colors" rel="nofollow">Termos de Serviço</a>
            <span className="text-zinc-700 dark:text-zinc-800">•</span>
            <a href="#privacy" onClick={(e) => { e.preventDefault(); triggerToast("Política de Privacidade em breve"); }} className="hover:text-zinc-900 dark:hover:text-white transition-colors" rel="nofollow">Política de Privacidade</a>
            <span className="text-zinc-700 dark:text-zinc-800">•</span>
            <a href="#cookies" onClick={(e) => { e.preventDefault(); triggerToast("Política de Cookies em breve"); }} className="hover:text-zinc-900 dark:hover:text-white transition-colors" rel="nofollow">Política de Cookies</a>
            <span className="text-zinc-700 dark:text-zinc-800">•</span>
            <a href="#acceptable-use" onClick={(e) => { e.preventDefault(); triggerToast("Uso Aceitável em breve"); }} className="hover:text-zinc-900 dark:hover:text-white transition-colors" rel="nofollow">Uso Aceitável</a>
          </div>

          <ApxlbsLogo />
        </div>
      </footer>

      {/* Scrollbar styles moved to index.css */}
    </div>
  );
};

const rootElement = document.getElementById('root');
if (rootElement && !(window as any)._lokalyzeRoot) {
  const root = createRoot(rootElement);
  (window as any)._lokalyzeRoot = root;
  root.render(
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  );
}
