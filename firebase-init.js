// Firebase initialization and exports for Firestore + Storage
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-app.js";
import {
	getFirestore, collection, getDoc, getDocs, setDoc, doc, addDoc, updateDoc, deleteDoc, onSnapshot
} from "https://www.gstatic.com/firebasejs/9.6.1/firebase-firestore.js";
import {
	getStorage, ref as storageRef, getDownloadURL, uploadBytes
} from "https://www.gstatic.com/firebasejs/9.6.1/firebase-storage.js";
import {
  getAuth
} from "https://www.gstatic.com/firebasejs/9.6.1/firebase-auth.js";

// Firebase config
const firebaseConfig = {
  apiKey: "AIzaSyB_zkbTsQOvGEv3QRSF2TK6ieYteMPBgnk",
  authDomain: "web-app-3abd4.firebaseapp.com",
  projectId: "web-app-3abd4",
  storageBucket: "web-app-3abd4.firebasestorage.app",
  messagingSenderId: "494432494948",
  appId: "1:494432494948:web:7cbcd32a959e33fbbe8671",
  measurementId: "G-E4P1W1JXMX"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const storage = getStorage(app);
const auth = getAuth(app);

// Export Firestore helpers
export {
db,
collection,
getDoc,
getDocs,
setDoc,
doc,
addDoc,
updateDoc,
deleteDoc,
onSnapshot,
// Auth
auth,
// Firebase Storage helpers
storage,
storageRef,
getDownloadURL,
uploadBytes
};
