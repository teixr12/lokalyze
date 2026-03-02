import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from 'firebase/auth';
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

// Initialize Firebase only if config is provided
const isConfigured = !!firebaseConfig.apiKey;

const app = isConfigured 
  ? (getApps().length === 0 ? initializeApp(firebaseConfig) : getApp()) 
  : null;

const auth = app ? getAuth(app) : null;
const analytics = app && typeof window !== 'undefined' ? getAnalytics(app) : null;
const googleProvider = new GoogleAuthProvider();

export { auth, googleProvider, signInWithPopup, signOut, onAuthStateChanged, isConfigured, analytics };
