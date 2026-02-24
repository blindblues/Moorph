import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

// TODO: Sostituisci questa configurazione con i tuoi dati di Firebase Console
const firebaseConfig = {
    apiKey: "IL_TUO_API_KEY",
    authDomain: "IL_TUO_AUTH_DOMAIN",
    projectId: "IL_TUO_PROJECT_ID",
    storageBucket: "IL_TUO_STORAGE_BUCKET",
    messagingSenderId: "IL_TUO_MESSAGING_SENDER_ID",
    appId: "IL_TUO_APP_ID"
};

// Inizializza Firebase
const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
