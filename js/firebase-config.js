import { initializeApp } from "https://www.gstatic.com/firebasejs/11.3.1/firebase-app.js";
import { getFirestore, connectFirestoreEmulator } from "https://www.gstatic.com/firebasejs/11.3.1/firebase-firestore.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged, connectAuthEmulator } from "https://www.gstatic.com/firebasejs/11.3.1/firebase-auth.js";

// Your web app's Firebase configuration
const firebaseConfig = {
    apiKey: "AIzaSyC5w92O-EN4cD-f5yDtgekt_dZvp8ppNdE",
    authDomain: "ethbib-virtual-exhibitions.firebaseapp.com",
    projectId: "ethbib-virtual-exhibitions",
    storageBucket: "ethbib-virtual-exhibitions.firebasestorage.app",
    messagingSenderId: "776232667912",
    appId: "1:776232667912:web:b719a51aa9cc9ef42a3abd"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();

// Connect to emulators if running locally
if (location.hostname === "localhost" || location.hostname === "127.0.0.1") {
    connectFirestoreEmulator(db, "localhost", 8080);
    connectAuthEmulator(auth, "http://localhost:9099");
    console.log("Connected to Firebase Emulators");
}

export { db, auth, googleProvider, signInWithPopup, signOut, onAuthStateChanged };
