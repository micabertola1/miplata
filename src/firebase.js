import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { initializeFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: 'AIzaSyCJ6jUGzAuLA-HjAN7xPXWhMKM9NB19hMk',
  authDomain: 'app-finanzas-5a420.firebaseapp.com',
  projectId: 'app-finanzas-5a420',
  storageBucket: 'app-finanzas-5a420.firebasestorage.app',
  messagingSenderId: '993339549157',
  appId: '1:993339549157:web:2ad7d4e12aae157a3b3b0c',
  measurementId: 'G-5HGMGQTTN7',
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
export const db = initializeFirestore(app, {
  ignoreUndefinedProperties: true,
});
