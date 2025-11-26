import { db, getDoc, setDoc, doc } from './firebase-init.js';

// Hash password using SHA-256
async function hashPassword(password) {
    const enc = new TextEncoder();
    const data = enc.encode(password);
    const hashBuf = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function registerAdmin(username, password) {
    if (!username) throw new Error('Missing username');
    if (password.length < 6) throw new Error('Password must be at least 6 characters');
    const uRef = doc(db, 'users', username);
    const snap = await getDoc(uRef);
    if (snap.exists()) throw new Error('Username already exists');
    const ph = await hashPassword(password);
    await setDoc(uRef, { username, role: 'admin', passwordHash: ph, createdAt: Date.now() });
    return username;
}

async function loginAdmin(username, password) {
    if (!username || !password) throw new Error('Missing username or password');
    const uRef = doc(db, 'users', username);
    const snap = await getDoc(uRef);
    if (!snap.exists()) throw new Error('No such user');
    const data = snap.data();
    if (!data) throw new Error('Invalid user data');
    const ph = await hashPassword(password);
    if (ph !== data.passwordHash) throw new Error('Invalid credentials');
    if (data.role !== 'admin') throw new Error('User is not an admin');
    return username;
}

// DOM helpers (support inline form on admin-register-login.html)
const loginBtn = document.getElementById('indexLoginBtn');
const registerBtn = document.getElementById('indexRegisterBtn');
const userInput = document.getElementById('indexAdminUser');
const passInput = document.getElementById('indexAdminPass');
const msgEl = document.getElementById('indexAuthMsg');

function showMsg(m, err) {
    if (!msgEl) return;
    msgEl.style.color = err ? '#ff6666' : '#9fb8c8';
    msgEl.innerText = m;
}

// Registration disabled in this build: admin users should be created manually or via another flow.

if (loginBtn) loginBtn.addEventListener('click', async () => {
    const username = (userInput.value || '').trim();
    const p = (passInput.value || '').trim();
    if (!username || !p) { showMsg('Enter username and password', true); return; }
    try {
        await loginAdmin(username, p);
        localStorage.setItem('adminUser', username);
        showMsg('Login successful. Redirecting...');
        setTimeout(() => { window.location.href = 'admin.html?allow=1'; }, 600);
    } catch (e) { console.error('Login error', e); showMsg(e.message || String(e), true); }
});

// Register handler: create an admin user in Firestore
if (registerBtn) registerBtn.addEventListener('click', async () => {
    const username = (userInput.value || '').trim();
    const p = (passInput.value || '').trim();
    if (!username || !p) { showMsg('Enter username and password', true); return; }
    try {
        await registerAdmin(username, p);
        showMsg('Registration successful. You can now login.');
        // optionally clear password field
        passInput.value = '';
    } catch (e) {
        console.error('Register error', e);
        const msg = e && e.message ? e.message : String(e);
        if (msg.includes('exists')) {
            showMsg('Username already exists. Pick a different username.', true);
        } else {
            showMsg(msg, true);
        }
    }
});

// allow Enter key to submit
if (userInput && passInput) {
    passInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { if (loginBtn) loginBtn.click(); } });
}
