import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, signOut, onAuthStateChanged } from 'firebase/auth';
import { getAnalytics } from 'firebase/analytics';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID
};

const toBool = (value: string | undefined): boolean => {
  if (!value) return false;
  return value === '1' || value.toLowerCase() === 'true';
};

// Optional test-only override used by smoke workspace profile.
const disableFirebaseAuth = toBool(import.meta.env.VITE_DISABLE_FIREBASE_AUTH);
const hasFirebaseConfig = !!firebaseConfig.apiKey;

// Initialize Firebase only if config is provided and auth isn't explicitly disabled.
const isConfigured = hasFirebaseConfig && !disableFirebaseAuth;

const app = isConfigured
  ? (getApps().length === 0 ? initializeApp(firebaseConfig) : getApp())
  : null;

const auth = app ? getAuth(app) : null;

// Only init analytics if measurementId is present (avoids crash when absent)
const analytics = (app && firebaseConfig.measurementId && typeof window !== 'undefined')
  ? getAnalytics(app)
  : null;

const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

export { auth, googleProvider, signInWithPopup, signInWithRedirect, getRedirectResult, signOut, onAuthStateChanged, isConfigured, analytics };
