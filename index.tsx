import React, { useState, useRef, useEffect, useMemo, useCallback, lazy, Suspense, Component } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI, GenerateContentResponse } from "@google/genai";
import JSZip from 'jszip';
import saveAs from 'file-saver';
const Editor = lazy(() => import('@monaco-editor/react'));
import { User } from 'firebase/auth';
import { auth, signInWithPopup, googleProvider, signOut, onAuthStateChanged, isConfigured as isFirebaseConfigured } from './src/firebase';

// Modular Imports
import { LANGUAGES, MAX_CONCURRENT_JOBS, KEYS } from './src/constants';
import { hybridDb } from './src/db';
import type { TranslationJob, ImageAsset, IframeAsset, Project } from './src/types';
import { Analytics, generateId, cleanStreamedHtml, formatDuration, formatDate, safeAssetId, urlToBase64 } from './src/utils';
import { useDebounce } from './src/hooks';

import Icons from './src/components/Icons';
import { LokalyzeLogo, ApxlbsLogo } from './src/components/Logo';
import Tooltip from './src/components/Tooltip';
import SettingsModal from './src/components/SettingsModal';

// --- ERROR BOUNDARY ---
interface ErrorBoundaryState { hasError: boolean; error: Error | null; }
class ErrorBoundary extends Component<{ children: React.ReactNode }, ErrorBoundaryState> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error: Error) { return { hasError: true, error }; }
  componentDidCatch(error: Error, info: React.ErrorInfo) { console.error('[Lokalyze] Uncaught error:', error, info); }
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

  // Memoized AI client — null when no key provided (avoids throwing on init)
  const effectiveApiKey = userApiKey || import.meta.env.VITE_GEMINI_API_KEY || '';
  const aiClient = useMemo(
    () => effectiveApiKey ? new GoogleGenAI({ apiKey: effectiveApiKey }) : null,
    [effectiveApiKey]
  );

  useEffect(() => {
    if (isFirebaseConfigured && auth) {
      const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
        setUser(currentUser);
        setAuthLoading(false);
      });
      return () => unsubscribe();
    } else {
      setAuthLoading(false);
    }
  }, []);

  const handleLogin = async () => {
    if (!auth) return triggerToast("Firebase is not configured. Check .env.example");
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error: any) {
      triggerToast(`Login failed: ${error.message}`);
    }
  };

  const handleLogout = async () => {
    if (!auth) return;
    await signOut(auth);
  };

  const saveSettings = (key: string) => {
    setUserApiKey(key);
    localStorage.setItem('lokalyze_api_key', key);
    setIsSettingsOpen(false);
    triggerToast("Settings saved successfully");
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
  const [notification, setNotification] = useState<string | null>(null);
  const [translatingImages, setTranslatingImages] = useState<Record<string, boolean>>({});

  // References for processing loop
  const processingRefs = useRef<Set<string>>(new Set());

  // -- EFFECTS: PERSISTENCE & INTEGRITY --
  useEffect(() => { document.documentElement.className = theme; }, [theme]);

  useEffect(() => localStorage.setItem(KEYS.HTML, sourceHtml), [sourceHtml]);
  useEffect(() => localStorage.setItem(KEYS.CSS, globalCss), [globalCss]);
  useEffect(() => localStorage.setItem(KEYS.ASSETS, JSON.stringify(detectedImages)), [detectedImages]);
  useEffect(() => localStorage.setItem(KEYS.IFRAMES, JSON.stringify(detectedIframes)), [detectedIframes]);
  useEffect(() => localStorage.setItem(KEYS.SOUND, String(soundEnabled)), [soundEnabled]);

  // CLEANUP CRASH CAUSING LOCALSTORAGE KEY
  useEffect(() => {
    try {
      localStorage.removeItem('lokalyze_project_history');
    } catch (e) { }
  }, []);

  // LOAD HISTORY ON MOUNT (cloud if logged in, local otherwise)
  useEffect(() => {
    if (!authLoading) {
      hybridDb.getAll(user?.uid).then(setHistory);
    }
  }, [authLoading, user]);

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

  const triggerToast = (msg: string) => {
    setNotification(msg);
    setTimeout(() => setNotification(null), 3000);
  };

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

  const updateAsset = (id: string, newUrl: string) => {
    setDetectedImages(prev => prev.map(img =>
      img.id === id ? { ...img, replacementUrl: newUrl } : img
    ));
    Analytics.track('asset_updated', { assetId: id });
  };

  const updateIframeUrl = (id: string, newUrl: string) => {
    setDetectedIframes(prev => prev.map(iframe =>
      iframe.id === id ? { ...iframe, replacementUrl: newUrl } : iframe
    ));
    Analytics.track('iframe_updated', { iframeId: id, type: 'url' });
  };

  const updateIframeHtml = (id: string, newHtml: string) => {
    setDetectedIframes(prev => prev.map(iframe =>
      iframe.id === id ? { ...iframe, htmlContent: newHtml } : iframe
    ));
    Analytics.track('iframe_updated', { iframeId: id, type: 'html' });
  };

  const translateImage = async (img: ImageAsset, targetLang: string) => {
    try {
      setTranslatingImages(prev => ({ ...prev, [img.id]: true }));

      if (!aiClient) {
        triggerToast('No API key set. Open Settings to add your Gemini API key.');
        return;
      }

      triggerToast(`Translating image text to ${targetLang}...`);

      const { data: base64Data, mimeType } = await urlToBase64(img.originalUrl);

      const response = await aiClient.models.generateContent({
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
        triggerToast("Image translated & override set!");
        playNotificationSound('success');
      } else {
        throw new Error("No image data returned from model");
      }

    } catch (e: any) {
      console.error(e);
      triggerToast(e.message || "Image translation failed (CORS or Model Error)");
    } finally {
      setTranslatingImages(prev => ({ ...prev, [img.id]: false }));
    }
  };

  const downloadHtml = (lang: string, html: string) => {
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `index-${lang.toLowerCase()}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    triggerToast(`Downloaded ${lang} file`);
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    triggerToast("Copied to clipboard");
  };

  const loadProject = (project: Project) => {
    if (isBatchRunning) {
      triggerToast("Cannot load while batch is running");
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

    setActiveTab('monitor');
    triggerToast(`Loaded "${project.name}"`);
  };

  const deleteProject = (e: React.MouseEvent, id: string) => {
    e.stopPropagation(); // Prevent loading when clicking delete
    if (confirm("Are you sure you want to delete this project history?")) {
      setHistory(prev => prev.filter(p => p.id !== id));
      if (activeProjectId === id) setActiveProjectId(null);
      // Delete from hybrid DB (local + cloud)
      hybridDb.delete(id, user?.uid).then(() => triggerToast("Project deleted"));
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
        saveAs(blob, filename || 'translated-image.png');
        triggerToast("Download complete");
        return;
      }

      const response = await fetch(url, { mode: 'cors' });
      if (!response.ok) throw new Error('Network block');
      const blob = await response.blob();
      const name = filename || url.split('/').pop()?.split('?')[0] || 'image.png';
      saveAs(blob, name);
      triggerToast("Download complete");
    } catch (e) {
      console.warn("Direct download failed, opening in new tab", e);
      // Fallback: Open in new tab
      window.open(url, '_blank');
      triggerToast("Opened in new tab (CORS restricted)");
    }
  };

  const downloadAllAssets = async () => {
    if (detectedImages.length === 0) return triggerToast("No assets to download");
    setIsDownloadingAssets(true);
    triggerToast("Packaging assets... this may take a moment");

    try {
      const zip = new JSZip();
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
      saveAs(content, "lokalyze-assets.zip");
      triggerToast(`Downloaded ${successCount} assets`);

    } catch (e: any) {
      console.error(e);
      triggerToast(e.message || "Batch download failed");
    } finally {
      setIsDownloadingAssets(false);
    }
  };

  const stopJob = (jobId: string) => {
    if (jobControllers.current[jobId]) {
      jobControllers.current[jobId].abort();
      delete jobControllers.current[jobId];

      setJobs(prev => ({
        ...prev,
        [jobId]: { ...prev[jobId], status: 'stopped' }
      }));
      triggerToast('Job stopped manually');
    }
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
      if (!aiClient) {
        throw new Error('No API key. Please open Settings and add your Gemini API key.');
      }
      const stream = await aiClient.models.generateContentStream({
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
      triggerToast("All jobs completed");
      playNotificationSound('success');
    }
  }, [jobs, isBatchRunning, sourceHtml, activeProjectId, playNotificationSound]);

  const startBatch = () => {
    if (selectedLangs.length === 0) return triggerToast("Select at least one language");
    if (!sourceHtml.trim() || sourceHtml.length < 10) return triggerToast("Source HTML looks empty");

    setIsBatchRunning(true);
    setActiveTab('monitor');

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
        <div className="animate-pulse text-zinc-400 font-mono text-xs uppercase tracking-widest">Loading...</div>
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
          <button
            onClick={handleLogin}
            className="w-full h-12 bg-violet-600 hover:bg-violet-700 text-white rounded-xl font-bold uppercase tracking-widest text-[11px] transition-colors flex items-center justify-center gap-3 mt-4"
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
      />

      {/* Toast Notification */}
      {notification && (
        <div className="fixed top-6 right-6 z-50 animate-[slideIn_0.3s_ease-out] flex items-center gap-3 bg-zinc-900 text-white px-5 py-3 rounded-xl shadow-2xl shadow-black/20 border border-white/10">
          <div className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />
          <span className="text-xs font-bold uppercase tracking-wider">{notification}</span>
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

            <Tooltip content={soundEnabled ? "Mute Sounds" : "Enable Sounds"}>
              <button onClick={() => setSoundEnabled(!soundEnabled)} className={`w-8 h-8 rounded-lg border flex items-center justify-center transition-colors ${soundEnabled ? 'border-zinc-200 dark:border-zinc-800 text-violet-500 bg-violet-50 dark:bg-violet-500/10' : 'border-zinc-200 dark:border-zinc-800 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'}`}>
                {soundEnabled ? <Icons.Volume2 /> : <Icons.VolumeX />}
              </button>
            </Tooltip>

            <Tooltip content="Settings">
              <button onClick={() => setIsSettingsOpen(true)} className="w-8 h-8 rounded-lg border border-zinc-200 dark:border-zinc-800 flex items-center justify-center hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors text-zinc-500">
                <Icons.Settings />
              </button>
            </Tooltip>
            <Tooltip content="Toggle Theme">
              <button onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} className="w-8 h-8 rounded-lg border border-zinc-200 dark:border-zinc-800 flex items-center justify-center hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors">
                {theme === 'dark' ? '☼' : '☾'}
              </button>
            </Tooltip>
          </div>
        </div>
      </nav>

      {/* MAIN CONTENT AREA */}
      <main className="flex-1 w-full max-w-[1800px] mx-auto p-4 md:p-6 grid grid-cols-1 xl:grid-cols-12 gap-6 h-auto xl:h-[calc(100vh-64px)] pb-24">

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
              <div className="grid grid-cols-2 gap-2">
                {LANGUAGES.map(lang => (
                  <button
                    key={lang}
                    onClick={() => setSelectedLangs(prev => prev.includes(lang) ? prev.filter(l => l !== lang) : [...prev, lang])}
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
                {detectedImages.filter(i => i.replacementUrl).length > 0 && (
                  <span className="text-[9px] font-bold text-emerald-500 bg-emerald-500/10 px-2 py-0.5 rounded-full">
                    {detectedImages.filter(i => i.replacementUrl).length} Overrides
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
            <button onClick={() => setActiveTab('monitor')} className={`px-6 py-2.5 rounded-full text-[10px] font-black uppercase tracking-widest border transition-all flex items-center gap-2 whitespace-nowrap ${activeTab === 'monitor' ? 'bg-white dark:bg-[#0e0e0e] border-zinc-200 dark:border-white/10 text-violet-500 shadow-xl' : 'border-transparent text-zinc-400 hover:text-zinc-600 hover:bg-white/50 dark:hover:bg-white/5'}`}>
              <Icons.Cpu /> Live Monitor
            </button>
            <button onClick={() => setActiveTab('assets')} className={`px-6 py-2.5 rounded-full text-[10px] font-black uppercase tracking-widest border transition-all flex items-center gap-2 whitespace-nowrap ${activeTab === 'assets' ? 'bg-white dark:bg-[#0e0e0e] border-zinc-200 dark:border-white/10 text-violet-500 shadow-xl' : 'border-transparent text-zinc-400 hover:text-zinc-600 hover:bg-white/50 dark:hover:bg-white/5'}`}>
              <Icons.Image /> Asset Manager <span className="ml-1 bg-zinc-200 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 px-1.5 py-0.5 rounded-md text-[9px]">{detectedImages.length + detectedIframes.length}</span>
            </button>
            <button onClick={() => setActiveTab('history')} className={`px-6 py-2.5 rounded-full text-[10px] font-black uppercase tracking-widest border transition-all flex items-center gap-2 whitespace-nowrap ${activeTab === 'history' ? 'bg-white dark:bg-[#0e0e0e] border-zinc-200 dark:border-white/10 text-violet-500 shadow-xl' : 'border-transparent text-zinc-400 hover:text-zinc-600 hover:bg-white/50 dark:hover:bg-white/5'}`}>
              <Icons.History /> History <span className="ml-1 bg-zinc-200 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 px-1.5 py-0.5 rounded-md text-[9px]">{history.length}</span>
            </button>
          </div>

          <div className="flex-1 bg-white dark:bg-[#0e0e0e] rounded-[32px] border border-zinc-200 dark:border-white/5 shadow-2xl overflow-hidden relative transition-all hover:border-zinc-300 dark:hover:border-white/10">

            {activeTab === 'monitor' ? (
              <div className="flex h-full flex-col lg:flex-row">
                {/* LIST VIEW - FIXED: Use w-96 fixed width on desktop to prevent shrinking, hidden on mobile when detailed view active */}
                <div className={`${focusedJobId ? 'hidden lg:flex' : 'flex'} w-full lg:w-96 shrink-0 flex-col border-r border-zinc-100 dark:border-white/5 transition-all duration-300 h-full`}>
                  <div className="p-4 border-b border-zinc-100 dark:border-white/5 flex justify-between items-center bg-zinc-50/50 dark:bg-black/20 shrink-0">
                    <div className="flex flex-col">
                      <span className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Process Queue</span>
                      {activeProjectId && <span className="text-[9px] font-bold text-violet-500 mt-0.5 truncate max-w-[150px]">{history.find(h => h.id === activeProjectId)?.name}</span>}
                    </div>
                    <span className="text-[9px] font-mono text-zinc-500">{Object.keys(jobs).length} Threads</span>
                  </div>
                  <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar bg-zinc-50/30 dark:bg-black/10">
                    {Object.keys(jobs).length === 0 && (
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
                    )}
                    {(Object.values(jobs) as TranslationJob[]).map(job => (
                      <div
                        key={job.id}
                        onClick={() => setFocusedJobId(job.id)}
                        className={`group cursor-pointer p-4 rounded-2xl border transition-all hover:bg-white dark:hover:bg-white/5 hover:shadow-lg relative overflow-hidden ${focusedJobId === job.id ? 'bg-white dark:bg-violet-900/10 border-violet-500/50 ring-1 ring-violet-500/20 shadow-xl' : 'bg-white dark:bg-[#121212] border-zinc-200 dark:border-white/5'}`}
                      >
                        <div className="flex justify-between items-center mb-3 relative z-10">
                          <div className="flex items-center gap-3">
                            <div className={`w-2 h-8 rounded-full ${job.status === 'completed' ? 'bg-emerald-500' : job.status === 'error' ? 'bg-red-500' : job.status === 'stopped' ? 'bg-orange-400' : job.status === 'translating' ? 'bg-violet-500 animate-pulse' : 'bg-zinc-300'}`}></div>
                            <div>
                              <span className="text-xs font-black uppercase tracking-tight block">{job.lang}</span>
                              {job.endTime && <span className="text-[9px] text-zinc-400 font-mono">{formatDuration(job.endTime - job.startTime)}</span>}
                            </div>
                          </div>
                          {job.status === 'completed' && <span className="text-[10px] text-emerald-600 bg-emerald-100 dark:bg-emerald-500/10 px-2 py-0.5 rounded-full font-bold">DONE</span>}
                          {job.status === 'error' && <span className="text-[10px] text-red-600 bg-red-100 dark:bg-red-500/10 px-2 py-0.5 rounded-full font-bold">ERR</span>}
                          {job.status === 'stopped' && <span className="text-[10px] text-orange-600 bg-orange-100 dark:bg-orange-500/10 px-2 py-0.5 rounded-full font-bold">STOP</span>}
                          {job.status === 'queued' && <span className="text-[10px] text-zinc-400 bg-zinc-100 dark:bg-white/5 px-2 py-0.5 rounded-full font-bold">WAIT</span>}
                        </div>
                        <div className="h-1.5 w-full bg-zinc-100 dark:bg-black rounded-full overflow-hidden relative z-10">
                          <div className={`h-full transition-all duration-300 ${job.status === 'error' ? 'bg-red-500' : job.status === 'completed' ? 'bg-emerald-500' : job.status === 'stopped' ? 'bg-orange-400' : 'bg-violet-500'}`} style={{ width: `${job.progress}%` }} />
                        </div>
                        <div className="mt-2 flex justify-between items-center text-[9px] font-mono text-zinc-400 relative z-10 opacity-60 group-hover:opacity-100 transition-opacity">
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

                        <div className="absolute right-4 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity text-zinc-400 lg:hidden pointer-events-none">
                          <Icons.ChevronRight />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* DRILL DOWN VIEW - FIXED: Flex-1 ensures it takes remaining space, min-w-0 prevents overflow */}
                {focusedJobId && jobs[focusedJobId] ? (
                  <div className="flex-1 flex flex-col h-full bg-zinc-50 dark:bg-[#0a0a0a] min-w-0">
                    <div className="p-4 border-b border-zinc-200 dark:border-white/5 flex justify-between items-center bg-white dark:bg-[#0e0e0e] shrink-0">
                      <div className="flex items-center gap-3">
                        <button onClick={() => setFocusedJobId(null)} className="lg:hidden w-8 h-8 rounded-lg border border-zinc-200 dark:border-white/10 flex items-center justify-center text-zinc-500">←</button>
                        <div>
                          <h2 className="text-xl font-black tracking-tighter flex items-center gap-3">
                            {jobs[focusedJobId].lang}
                            <span className={`px-2 py-0.5 rounded-md text-[9px] uppercase tracking-widest text-white ${jobs[focusedJobId].status === 'completed' ? 'bg-emerald-500' : jobs[focusedJobId].status === 'stopped' ? 'bg-orange-500' : 'bg-violet-500'}`}>{jobs[focusedJobId].status}</span>
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
                              <button onClick={() => copyToClipboard(jobs[focusedJobId].translatedHtml)} className="h-9 px-3 rounded-lg bg-zinc-100 dark:bg-zinc-800 flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors">
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
                          <button onClick={() => setFocusedJobId(null)} className="hidden lg:flex w-9 h-9 rounded-lg border border-zinc-200 dark:border-white/10 items-center justify-center text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors">
                            <Icons.Close />
                          </button>
                        </Tooltip>
                      </div>
                    </div>
                    <div className="flex-1 overflow-hidden relative">
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
                  <div className="flex-1 hidden lg:flex flex-col items-center justify-center text-zinc-300 dark:text-zinc-700 bg-zinc-50/50 dark:bg-black/20">
                    <div className="w-32 h-32 rounded-[2rem] bg-white dark:bg-white/5 shadow-2xl flex items-center justify-center mb-8 rotate-3">
                      <span className="text-5xl opacity-50">⚡</span>
                    </div>
                    <p className="text-xs font-black uppercase tracking-[0.2em] mb-2">Mainframe Output</p>
                    <p className="text-[10px] text-zinc-400 max-w-xs text-center leading-relaxed">Select a completed job from the queue to inspect the code, preview the render, or download the assets.</p>
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
                  <div className="text-[9px] bg-zinc-100 dark:bg-white/5 px-2 py-1 rounded text-zinc-400 font-mono">
                    Total Projects: {history.length}
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto p-6 space-y-4 custom-scrollbar">
                  {history.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center border-2 border-dashed border-zinc-200 dark:border-zinc-800 rounded-3xl p-10 opacity-50">
                      <Icons.History />
                      <p className="text-xs font-bold text-zinc-400 uppercase mt-4">No History Found</p>
                      <p className="text-[10px] text-zinc-500 mt-2">Start a translation batch to create a history record.</p>
                    </div>
                  ) : (
                    history.map((project) => (
                      <div key={project.id} className={`flex flex-col md:flex-row items-center justify-between gap-6 p-6 bg-white dark:bg-[#121212] rounded-3xl border border-zinc-200 dark:border-white/5 group hover:border-violet-500/30 hover:shadow-lg transition-all ${activeProjectId === project.id ? 'ring-1 ring-violet-500/50 border-violet-500/30' : ''}`}>
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
                            onClick={(e) => deleteProject(e, project.id)}
                            className="p-2 rounded-xl text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
                          >
                            <Icons.Trash />
                          </button>
                        </div>
                      </div>
                    ))
                  )}
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

                  {/* SECTION: IFRAMES */}
                  {detectedIframes.length > 0 && (
                    <div className="space-y-4">
                      <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-zinc-400">
                        <Icons.Globe /> <span>Detected Iframes / Widgets</span>
                      </div>
                      {detectedIframes.map((iframe) => (
                        <div key={iframe.id} className="flex flex-col gap-4 p-6 bg-white dark:bg-[#121212] rounded-3xl border border-zinc-200 dark:border-white/5 border-l-4 border-l-indigo-500 group hover:border-indigo-500/30 hover:shadow-lg transition-all">
                          <div className="flex flex-col gap-2">
                            <label className="text-[9px] font-black uppercase tracking-widest text-zinc-400 flex items-center justify-between">
                              <span>Original Frame Source</span>
                              <button onClick={() => copyToClipboard(iframe.originalUrl)} className="text-zinc-400 hover:text-indigo-500">
                                <Icons.Copy />
                              </button>
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

                        </div>
                      ))}
                    </div>
                  )}

                  {/* SECTION: IMAGES */}
                  <div className="space-y-4">
                    <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-zinc-400">
                      <Icons.Image /> <span>Detected Images</span>
                    </div>
                    {detectedImages.length === 0 ? (
                      <div className="flex flex-col items-center justify-center border-2 border-dashed border-zinc-200 dark:border-zinc-800 rounded-3xl p-10 opacity-50">
                        <Icons.Image />
                        <p className="text-xs font-bold text-zinc-400 uppercase mt-4">No &lt;img&gt; tags found</p>
                      </div>
                    ) : (
                      detectedImages.map((img) => (
                        <div key={img.id} className="flex flex-col md:flex-row gap-6 p-6 bg-white dark:bg-[#121212] rounded-3xl border border-zinc-200 dark:border-white/5 group hover:border-violet-500/30 hover:shadow-lg transition-all">
                          <div className="w-full md:w-32 h-32 rounded-2xl bg-zinc-100 dark:bg-black overflow-hidden border border-zinc-200 dark:border-white/10 shrink-0 relative">
                            <img src={img.originalUrl} alt="preview" className="w-full h-full object-cover" />
                          </div>
                          <div className="flex-1 flex flex-col justify-center gap-4">
                            <div className="flex flex-col gap-1.5">
                              <label className="text-[9px] font-black uppercase tracking-widest text-zinc-400 flex items-center justify-between">
                                <span>Original Source</span>
                                <div className="flex items-center gap-1">
                                  <Tooltip content="Download Original">
                                    <button onClick={() => downloadAsset(img.originalUrl)} className="text-zinc-400 hover:text-violet-500 p-1">
                                      <Icons.Download />
                                    </button>
                                  </Tooltip>
                                  <Tooltip content="Copy URL">
                                    <button onClick={() => copyToClipboard(img.originalUrl)} className="text-zinc-400 hover:text-violet-500 p-1">
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
                                      <button onClick={() => downloadAsset(img.replacementUrl, `translated-asset-${img.id}.png`)} className="text-zinc-400 hover:text-emerald-500">
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