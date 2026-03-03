import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

const getAdminConfig = () => {
  const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID || '';
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL || '';
  const privateKeyRaw = process.env.FIREBASE_ADMIN_PRIVATE_KEY || '';
  const privateKey = privateKeyRaw.replace(/\\n/g, '\n');

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error('Missing Firebase admin credentials (FIREBASE_ADMIN_PROJECT_ID, FIREBASE_ADMIN_CLIENT_EMAIL, FIREBASE_ADMIN_PRIVATE_KEY)');
  }

  return {
    projectId,
    clientEmail,
    privateKey,
  };
};

const getAdminApp = () => {
  if (getApps().length > 0) return getApps()[0];
  return initializeApp({ credential: cert(getAdminConfig()) });
};

export const verifyAuthHeader = async (authHeader = '') => {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new Error('Unauthorized: missing bearer token');
  }

  const token = authHeader.slice('Bearer '.length).trim();
  if (!token) throw new Error('Unauthorized: empty token');

  const adminAuth = getAuth(getAdminApp());
  const decoded = await adminAuth.verifyIdToken(token);
  if (!decoded?.uid) {
    throw new Error('Unauthorized: invalid user context');
  }

  return decoded;
};

