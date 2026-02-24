import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
    apiKey: "AIzaSyA0vejoV4GxvUoE0hCW4KXX25vuQ2uIQi0",
    authDomain: "moorphbb.firebaseapp.com",
    projectId: "moorphbb",
    storageBucket: "moorphbb.firebasestorage.app",
    messagingSenderId: "347702689367",
    appId: "1:347702689367:web:2efaa9ade7895bc917ed12",
    measurementId: "G-CHN6XRMWQ6"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const storage = getStorage(app);