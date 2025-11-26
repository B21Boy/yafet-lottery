import { db, collection, getDoc, getDocs, setDoc, doc, addDoc, updateDoc, deleteDoc, onSnapshot } from './firebase-init.js';

// Custom styled alert
function showStyledAlert(message) {
    let modal = document.createElement('div');
    modal.style.position = 'fixed';
    modal.style.top = '50%';
    modal.style.left = '50%';
    modal.style.transform = 'translate(-50%, -50%)';
    modal.style.background = '#222';
    modal.style.color = '#fff';
    modal.style.padding = '32px 48px';
    modal.style.borderRadius = '16px';
    modal.style.boxShadow = '0 4px 32px #0008';
    modal.style.fontSize = '1.3rem';
    modal.style.zIndex = 9999;
    modal.style.textAlign = 'center';
    modal.innerHTML = `<div style="margin-bottom:12px;">${message}</div><button style="padding:8px 24px;border:none;background:#00ffcc;color:#222;border-radius:8px;font-size:1rem;cursor:pointer;">OK</button>`;
    modal.querySelector('button').onclick = () => document.body.removeChild(modal);
    document.body.appendChild(modal);
}

// Create new round
export async function createRound() {
    let name = document.getElementById("roundName").value || "Round";
    let price = Number(document.getElementById("ticketPrice").value);

    if (!price) {
        alert("Enter a ticket price!");
        return;
    }

    // create a new round document in 'rounds' collection and set it as current
    const roundData = {
        roundName: name,
        ticketPrice: price,
        status: "not_started",
        winningNumber: null,
        winners: [],
        createdAt: Date.now()
    };

    const newRoundRef = await addDoc(collection(db, 'rounds'), roundData);
    const roundId = newRoundRef.id;

    // set the 'lottery/current' doc to point to this roundId
    let lottery = Object.assign({}, roundData, { roundId });
    await setDoc(doc(db, 'lottery', 'current'), lottery);
    document.getElementById("roundName").value = "";
    document.getElementById("ticketPrice").value = "";
    showStyledAlert('🎉 New Round Created!');
}

// Expose to window for inline HTML event handlers
window.createRound = createRound;


// Start the lottery
export async function startLottery() {
    let lottery = await getLottery();
    lottery.status = "open";
    await save(lottery);
    showStyledAlert('🚦 Lottery Started!');
}
window.startLottery = startLottery;


// Stop lottery (no more selling)
export async function stopLottery() {
    let lottery = await getLottery();
    lottery.status = "closed";
    await save(lottery);
    showStyledAlert('⏹️ Lottery Stopped!');
}
window.stopLottery = stopLottery;

// Load and display rounds
window.viewRounds = async function viewRounds() {
    // Navigate to dedicated rounds management page where rounds and tickets are loaded
    window.location.href = 'rounds.html';
}

// Set a round as current (moves lottery/current.roundId)
window.setCurrentRound = async function setCurrentRound(roundId) {
    const rDoc = await getDoc(doc(db, 'rounds', roundId));
    if (!rDoc.exists()) { showStyledAlert('Round not found'); return; }
    const r = rDoc.data();
    r.roundId = roundId;
    await setDoc(doc(db, 'lottery', 'current'), r);
    showStyledAlert('Current round set: ' + (r.roundName || roundId));
}

// View tickets for a specific round
window.viewRoundTickets = async function viewRoundTickets(roundId) {
    const ticketsSnap = await getDocs(collection(db, 'rounds', roundId, 'tickets'));
    const container = document.getElementById('roundsList');
    if (!container) return;
    if (ticketsSnap.empty) {
        container.innerHTML = '<div style="color:#888">No tickets for this round.</div>';
        return;
    }
    let html = '<div style="display:flex;flex-direction:column;gap:8px;">';
    ticketsSnap.forEach(docSnap => {
        const t = docSnap.data();
        const id = docSnap.id;
        html += `<div style="padding:10px;border-radius:8px;background:#0f1316;border:1px solid #00ff6633;display:flex;justify-content:space-between;align-items:center;gap:12px;">
            <div>
                <div><b>${t.user}</b> — ${t.phone}</div>
                <div>Number: <span style="color:#ffd700">${t.number}</span> | Time: <span style="color:#aaa">${t.time}</span></div>
                <div>Payment: ${t.paymentMethod || '-'} ${t.validated?'<span style="color:#00cc66;">(validated)</span>':''}</div>
            </div>
            <div style="display:flex;gap:8px;">
                ${t.validated?`<button disabled style="padding:6px 10px;background:#444;color:#ccc;">Validated</button>`:`<button onclick="approveTicket('${roundId}','${id}')" style="padding:6px 10px;background:#00cc66;">Validate</button>`}
                ${t.validated?`<button onclick="rejectTicket('${roundId}','${id}')" style="padding:6px 10px;background:#ff6666;">Reject</button>`:`<button onclick="rejectTicket('${roundId}','${id}')" style="padding:6px 10px;background:#ff6666;">Reject</button>`}
            </div>
        </div>`;
    });
    html += '</div>';
    container.innerHTML = html;
}

// ----------------- Simple admin auth (stores admin user in users/{username}) -----------------
async function hashPassword(password) {
    const enc = new TextEncoder();
    const data = enc.encode(password);
    const hashBuf = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function registerAdmin() {
    const userEl = document.getElementById('adminUser');
    const passEl = document.getElementById('adminPass');
    const msg = document.getElementById('authMsg');
    if (!userEl || !passEl) return;
    const username = (userEl.value || '').trim();
    const password = (passEl.value || '').trim();
    if (!username || !password) { if (msg) msg.innerText = 'Enter username and password'; return; }
    try {
        const uDoc = await getDoc(doc(db, 'users', username));
        if (uDoc.exists()) { if (msg) msg.innerText = 'Username already exists'; return; }
        const ph = await hashPassword(password);
        const data = { username, role: 'admin', createdAt: Date.now(), passwordHash: ph };
        await setDoc(doc(db, 'users', username), data);
        if (msg) msg.innerText = 'Admin registered — logged in';
        localStorage.setItem('adminUser', username);
        showAdminUI(username);
    } catch (e) {
        console.error('registerAdmin failed', e);
        if (msg) msg.innerText = 'Registration failed: ' + (e && e.message ? e.message : e);
    }
}

async function loginAdmin() {
    const userEl = document.getElementById('adminUser');
    const passEl = document.getElementById('adminPass');
    const msg = document.getElementById('authMsg');
    if (!userEl || !passEl) return;
    const username = (userEl.value || '').trim();
    const password = (passEl.value || '').trim();
    if (!username || !password) { if (msg) msg.innerText = 'Enter username and password'; return; }
    try {
        const uDoc = await getDoc(doc(db, 'users', username));
        if (!uDoc.exists()) { if (msg) msg.innerText = 'No such user'; return; }
        const data = uDoc.data();
        if (!data || data.role !== 'admin') { if (msg) msg.innerText = 'User is not admin'; return; }
        const ph = await hashPassword(password);
        if (ph !== data.passwordHash) { if (msg) msg.innerText = 'Invalid credentials'; return; }
        localStorage.setItem('adminUser', username);
        if (msg) msg.innerText = 'Login successful';
        showAdminUI(username);
    } catch (e) {
        console.error('loginAdmin failed', e);
        if (msg) msg.innerText = 'Login failed: ' + (e && e.message ? e.message : e);
    }
}

function showAdminUI(username) {
    try {
        const authCard = document.getElementById('authCard');
        const adminContent = document.getElementById('adminContent');
        const adminHeader = document.getElementById('adminHeader');
        if (authCard) authCard.style.display = 'none';
        if (adminContent) adminContent.style.display = 'block';
        if (adminHeader) { adminHeader.style.display = 'block'; adminHeader.innerText = `⚙️ Admin Panel — ${username}`; }
    } catch (e) { }
}

function hideAdminUI() {
    const authCard = document.getElementById('authCard');
    const adminContent = document.getElementById('adminContent');
    const adminHeader = document.getElementById('adminHeader');
    if (authCard) authCard.style.display = 'block';
    if (adminContent) adminContent.style.display = 'none';
    if (adminHeader) adminHeader.style.display = 'none';
}

window.registerAdmin = registerAdmin;
window.loginAdmin = loginAdmin;
window.showAdminUI = showAdminUI;
window.hideAdminUI = hideAdminUI;

// Approve / validate a ticket
window.approveTicket = async function approveTicket(roundId, ticketId) {
    try {
        await updateDoc(doc(db, 'rounds', roundId, 'tickets', ticketId), { validated: true, validatedAt: Date.now() });
        showStyledAlert('Ticket validated');
        await viewRoundTickets(roundId);
    } catch (e) { console.error(e); showStyledAlert('Failed to validate ticket'); }
}

// Reject / mark not validated
window.rejectTicket = async function rejectTicket(roundId, ticketId) {
    try {
        await updateDoc(doc(db, 'rounds', roundId, 'tickets', ticketId), { validated: false, validatedAt: Date.now() });
        showStyledAlert('Ticket marked as not validated');
        await viewRoundTickets(roundId);
    } catch (e) { console.error(e); showStyledAlert('Failed to update ticket'); }
}


// Set winning number
async function setWinningNumber() {
    // read three inputs (allow blanks) and build an array of numbers
    const v1 = document.getElementById("winningNumber1") ? document.getElementById("winningNumber1").value : '';
    const v2 = document.getElementById("winningNumber2") ? document.getElementById("winningNumber2").value : '';
    const v3 = document.getElementById("winningNumber3") ? document.getElementById("winningNumber3").value : '';
    const nums = [v1, v2, v3].map(s => s === '' ? null : Number(s)).filter(x => x !== null && !isNaN(x));

    if (!nums.length) {
        showStyledAlert("Enter at least one winning number!");
        return;
    }

    let lottery = await getLottery();
    // store as array (if single provided will still be array)
    lottery.winningNumber = nums;

    // Find winners from Firestore tickets (use round collection if available)
    let ticketsSnap;
    if (lottery.roundId) {
        ticketsSnap = await getDocs(collection(db, 'rounds', lottery.roundId, 'tickets'));
    } else {
        ticketsSnap = await getDocs(collection(db, 'lottery', 'current', 'tickets'));
    }
    let winners = [];
    ticketsSnap.forEach(docSnap => {
        let t = docSnap.data();
        // match if ticket number equals any of the winning numbers
        if (t && nums.some(n => Number(t.number) === Number(n))) winners.push(t);
    });
    lottery.winners = winners;

    await save(lottery);

    const displayNums = nums.join(', ');
    document.getElementById("winnerText").innerText =
        "Winning Number(s): " + displayNums + 
        " | Winners: " + (lottery.winners ? lottery.winners.length : 0);

    showStyledAlert("🏆 Winners Declared!");
}
// expose to window for inline onclick in admin.html
window.setWinningNumber = setWinningNumber;


// View buyers for the CURRENT round
async function viewBuyers() {
    // Use lottery/current to determine the active round and count unique users in that round
    const outEl = document.getElementById("buyerList");
    if (!outEl) return;
    try {
        const lottery = await getLottery();
        if (!lottery || !lottery.roundId) {
            // fallback to tickets under lottery/current if no per-round collection
            const altSnap = await getDocs(collection(db, 'lottery', 'current', 'tickets'));
            if (!altSnap || altSnap.empty) {
                outEl.textContent = 'No active round or tickets found.';
                return;
            }
            const users = new Set();
            altSnap.forEach(s => { const t = s.data(); if (t && t.user) users.add(t.user); });
            outEl.textContent = `Current (no roundId) - Unique buyers: ${users.size} | Total tickets: ${altSnap.size}`;
            return;
        }

        const roundId = lottery.roundId;
        const roundName = lottery.roundName || roundId;
        const ticketsSnap = await getDocs(collection(db, 'rounds', roundId, 'tickets'));
        if (!ticketsSnap || ticketsSnap.empty) {
            outEl.textContent = `Round ${roundName}: 0 buyers (no tickets)`;
            return;
        }

        // Count unique users by the `user` field
        const users = new Set();
        ticketsSnap.forEach(docSnap => {
            const t = docSnap.data();
            if (t && t.user) users.add(t.user);
        });

        outEl.textContent = `Round ${roundName}: Unique buyers: ${users.size} | Total tickets: ${ticketsSnap.size}`;
    } catch (e) {
        console.error('Failed to fetch current round buyers', e);
        outEl.textContent = 'Failed to fetch buyers: ' + (e && e.message ? e.message : e);
    }
}
// expose to window for inline onclick in admin.html
window.viewBuyers = viewBuyers;


// View winners
async function viewWinners() {
    const outEl = document.getElementById("winnerList");
    if (!outEl) return;
    try {
        let lottery = await getLottery();

        // if there is a configured winningNumber, (re)compute winners from tickets
        if (lottery && lottery.winningNumber && Array.isArray(lottery.winningNumber) && lottery.winningNumber.length) {
            // fetch tickets (per-round if roundId present)
            let ticketsSnap;
            if (lottery.roundId) {
                ticketsSnap = await getDocs(collection(db, 'rounds', lottery.roundId, 'tickets'));
            } else {
                ticketsSnap = await getDocs(collection(db, 'lottery', 'current', 'tickets'));
            }

            const nums = lottery.winningNumber.map(n => Number(n));
            let winners = [];
            ticketsSnap.forEach(docSnap => {
                const t = docSnap.data();
                if (t && nums.some(n => Number(t.number) === n)) winners.push(t);
            });

            lottery.winners = winners;
            await save(lottery);
        }

        // render winners (if any)
        const lotteryAfter = await getLottery();
        const winners = lotteryAfter.winners || [];
        if (!winners || winners.length === 0) {
            outEl.textContent = 'No winners found (ensure winning numbers are set and tickets exist).';
            return;
        }

        // build readable HTML
        let html = '';
        winners.forEach((w, i) => {
            html += `#${i+1}: ${w.user || 'Unknown'} — Ticket: ${w.number} — Phone: ${w.phone || '-'}\n`;
        });
        outEl.textContent = html;
    } catch (e) {
        console.error('viewWinners failed', e);
        outEl.textContent = 'Failed to load winners: ' + (e && e.message ? e.message : e);
    }
}

// expose to window for inline HTML onclick in admin.html
window.viewWinners = viewWinners;


// Helper: load lottery
async function getLottery() {
    const lotterySnap = await getDoc(doc(db, 'lottery', 'current'));
    return lotterySnap.exists() ? lotterySnap.data() : {};
}

// Helper: save lottery
async function save(data) {
    await setDoc(doc(db, 'lottery', 'current'), data);
}

// format a Date for datetime-local input (yyyy-mm-ddThh:mm)
function formatForInput(dt) {
    const pad = (n) => n.toString().padStart(2, '0');
    const yyyy = dt.getFullYear();
    const mm = pad(dt.getMonth() + 1);
    const dd = pad(dt.getDate());
    const hh = pad(dt.getHours());
    const min = pad(dt.getMinutes());
    return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
}

// Auto-sync state: if admin hasn't edited the countdown input we keep it in sync with system time
let countdownAuto = true;
let _sysSyncInterval = null;
function startSystemTimeSync() {
    // update every 5 seconds
    if (_sysSyncInterval) return;
    _sysSyncInterval = setInterval(() => {
        const input = document.getElementById('countdownAt');
        if (!input) return;
        const now = new Date();
        // round up to next minute if seconds > 0
        const dt = new Date(now.getTime());
        dt.setSeconds(0, 0);
        if (now.getSeconds() > 0) dt.setMinutes(dt.getMinutes() + 1);
        // always update min to current time
        input.min = formatForInput(new Date());
        if (countdownAuto && document.activeElement !== input) {
            input.value = formatForInput(dt);
            updateCountdownStatusFromInput();
        }
    }, 5000);
}

// Set countdown end time (from admin datetime-local input)
async function setCountdown() {
    const input = document.getElementById('countdownAt');
    if (!input || !input.value) {
        showStyledAlert('Choose a date and time first');
        return;
    }

    const dt = new Date(input.value);
    if (isNaN(dt.getTime())) {
        showStyledAlert('Invalid date/time');
        return;
    }

    const lottery = await getLottery();
    lottery.countdownEnd = dt.getTime();
    await save(lottery);
    showStyledAlert('Live time set for: ' + dt.toString());
    await showCountdownInfo();
}

async function clearCountdown() {
    const lottery = await getLottery();
    delete lottery.countdownEnd;
    delete lottery.countdownSeconds;
    await save(lottery);
    showStyledAlert('Live time cleared');
    await showCountdownInfo();
}

// expose countdown controls to inline HTML onclick handlers
window.setCountdown = setCountdown;
window.clearCountdown = clearCountdown;

async function showCountdownInfo() {
    const info = document.getElementById('countdownInfo');
    const input = document.getElementById('countdownAt');
    if (!info) return;
    const lottery = await getLottery();
    // (uses top-level formatForInput)

    if (lottery && lottery.countdownEnd) {
        const dt = new Date(Number(lottery.countdownEnd));
        info.innerText = 'Configured live time: ' + dt.toString();
        if (input) {
            input.value = formatForInput(dt);
        }
    } else if (lottery && lottery.countdownSeconds) {
        info.innerText = 'Configured countdown (seconds): ' + lottery.countdownSeconds;
        // leave input as-is
    } else {
        // No configured time: prefill with the system current date/time so admin only increases day/time
        const now = new Date();
        info.innerText = 'No live time configured.';
        if (input) {
            // set input to current local datetime (rounded up to next minute)
            const dt = new Date(now.getTime());
            dt.setSeconds(0, 0);
            // if seconds exist, add a minute so we don't allow past times
            if (now.getSeconds() > 0) dt.setMinutes(dt.getMinutes() + 1);
            input.value = formatForInput(dt);
            // set min so admin can't choose a past time
            input.min = formatForInput(new Date());
            // compute status based on the prefetched dt
            const period = (h) => {
                if (h >= 5 && h < 12) return 'Morning';
                if (h >= 12 && h < 17) return 'Afternoon';
                if (h >= 17 && h < 21) return 'Evening';
                return 'Night';
            };
            info.innerText = `Suggested start: ${dt.toString()} (${period(dt.getHours())})`;
        }
    }
}

// helper: update the countdown info status when input changes
function updateCountdownStatusFromInput() {
    const input = document.getElementById('countdownAt');
    const info = document.getElementById('countdownInfo');
    if (!input || !info) return;
    const val = input.value; // format yyyy-mm-ddThh:mm
    if (!val) { info.innerText = 'No live time configured.'; return; }
    const dt = new Date(val);
    const h = dt.getHours();
    const period = (h) => {
        if (h >= 5 && h < 12) return 'Morning';
        if (h >= 12 && h < 17) return 'Afternoon';
        if (h >= 17 && h < 21) return 'Evening';
        return 'Night';
    };
    info.innerText = `Selected: ${dt.toString()} (${period(h)})`;
}

// show existing countdown info on load and require admin login
document.addEventListener('DOMContentLoaded', async () => {
    // Force login every time: unless caller explicitly sets ?allow=1 we redirect to login page.
    // This ensures admin must re-enter credentials on the login page each time they open admin.html.
    const params = new URLSearchParams(window.location.search);
    const allow = params.get('allow');
    if (allow !== '1') {
        // clear any previous admin session to enforce fresh login
        try { localStorage.removeItem('adminUser'); } catch (e) {}
        window.location.href = 'admin-register-login.html';
        return;
    }

    // If we get here, login just occurred and redirected with ?allow=1 — validate the saved admin and show UI.
    const savedAdmin = localStorage.getItem('adminUser');
    if (!savedAdmin) {
        // nothing to validate, force back to login
        window.location.href = 'admin-register-login.html';
        return;
    }
    try {
        const uDoc = await getDoc(doc(db, 'users', savedAdmin));
        if (!uDoc.exists()) {
            localStorage.removeItem('adminUser');
            window.location.href = 'admin-register-login.html';
            return;
        }
        const d = uDoc.data();
        if (!d || d.role !== 'admin') {
            localStorage.removeItem('adminUser');
            window.location.href = 'admin-register-login.html';
            return;
        }
        // valid admin, show admin UI
        showAdminUI(savedAdmin);
        // remove the allow flag from the URL to avoid reuse
        if (window.history && window.history.replaceState) {
            const url = new URL(window.location.href);
            url.searchParams.delete('allow');
            window.history.replaceState({}, '', url.pathname + url.search + url.hash);
        }
    } catch (e) {
        console.warn('admin validation failed', e);
        localStorage.removeItem('adminUser');
        window.location.href = 'admin-register-login.html';
        return;
    }

    await showCountdownInfo();
    // attach listener so changing the input updates the morning/night status live
    const countdownInput = document.getElementById('countdownAt');
    if (countdownInput) {
        countdownInput.addEventListener('input', () => { countdownAuto = false; updateCountdownStatusFromInput(); });
        countdownInput.addEventListener('focus', () => { countdownAuto = false; });
        // if focus is lost and the value equals the system time, re-enable auto mode
        countdownInput.addEventListener('blur', () => {
            const sys = formatForInput(new Date());
            if (countdownInput.value === sys) countdownAuto = true;
        });
    }
    // start periodic sync with system time
    startSystemTimeSync();
    // also refresh immediately when window regains focus
    window.addEventListener('focus', () => { if (countdownAuto) showCountdownInfo(); });
});

// Reset any existing draw/winner (admin control)
function resetDraw() {
    try {
        localStorage.removeItem('liveWinner');
        // also broadcast the reset so any open live pages can react
        localStorage.setItem('liveWinnerReset', JSON.stringify({ k: Math.random(), t: Date.now() }));
    showStyledAlert('Draw reset — winner cleared.');
    } catch (e) {
    showStyledAlert('Failed to reset draw: ' + e);
    }
}
