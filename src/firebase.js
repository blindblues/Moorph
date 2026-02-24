// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
import { getFirestore } from "firebase/firestore";

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
    apiKey: "AIzaSyA0vejoV4GxvUoE0hCW4KXX25vuQ2uIQi0",
    authDomain: "moorphbb.firebaseapp.com",
    projectId: "moorphbb",
    storageBucket: "moorphbb.firebasestorage.app",
    messagingSenderId: "347702689367",
    appId: "1:347702689367:web:2efaa9ade7895bc917ed12",
    measurementId: "G-CHN6XRMWQ6"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
export const db = getFirestore(app);