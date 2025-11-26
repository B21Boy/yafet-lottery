import { db, collection, getDoc, getDocs, setDoc, doc, addDoc, updateDoc, deleteDoc, onSnapshot } from './firebase-init.js';



// Real-time update for current lottery

export { buyTicket, loadHistory };
window.buyTicket = buyTicket;
window.loadHistory = loadHistory;
function renderCurrentLottery(lottery) {
    const statusText = document.getElementById("statusText");
    if (!lottery || !lottery.roundName) {
        document.getElementById("roundName").innerText = "No active round";
        document.getElementById("ticketPrice").innerText = "";
        if (statusText) statusText.innerHTML = "<span style='color:#888'>Status: <b>Not Started</b></span>";
        if (document.getElementById("winningNum")) document.getElementById("winningNum").innerText = "";
        return;
    }
    document.getElementById("roundName").innerText = "Round: " + lottery.roundName;
    document.getElementById("ticketPrice").innerText = "Ticket Price: " + lottery.ticketPrice + " birr";
    let statusLabel = '';
    if (lottery.status === 'open') {
        statusLabel = "<span style='color:#00cc66;font-weight:bold;'>Status: <b>Started</b> 🚦</span>";
    } else if (lottery.status === 'closed') {
        statusLabel = "<span style='color:#ff6666;font-weight:bold;'>Status: <b>Stopped</b> ⏹️</span>";
    } else {
        statusLabel = "<span style='color:#888'>Status: <b>Not Started</b></span>";
    }
    if (statusText) statusText.innerHTML = statusLabel;
    const winEl = document.getElementById("winningNum");
    if (winEl) {
        // If winners array exists, show the winning numbers and the matching user names
        if (lottery.winningNumber && Array.isArray(lottery.winningNumber)) {
            const numsArr = lottery.winningNumber.slice(0,3);
            let html = `<div class="result-header">Winning Number(s): <span class="result-numbers">${numsArr.join(', ')}</span></div>`;
            html += '<div class="result-winners">';
            // For each winning position (1..3) show matching winners for that number
            for (let i = 0; i < 3; i++) {
                const pos = i + 1;
                const num = numsArr[i];
                html += `<div class="winner-position"><div class="pos-header">${pos}. winner</div>`;
                if (num === undefined || num === null || num === '') {
                    html += `<div class="winner-item">No number set for this position</div>`;
                } else {
                    // find winners that match this number
                    const matches = (lottery.winners || []).filter(w => Number(w.number) === Number(num));
                    if (matches.length === 0) {
                        html += `<div class="winner-item">No winner for number <span class="win-num">${num}</span></div>`;
                    } else {
                        // list all matches (often one) for this position
                        matches.forEach(m => {
                            const name = m.user || 'Unknown';
                            const time = m.time ? `<div class="small">${m.time}</div>` : '';
                            html += `<div class="winner-item"><div class="winner-left"><div class="winner-name">${name}</div><div class="winner-meta">Number: <span class="win-num">${m.number}</span></div>${time}</div><div class="winner-badge">🎉</div></div>`;
                        });
                    }
                }
                html += `</div>`; // close winner-position
            }
            html += '</div>';
            winEl.innerHTML = html;
        } else if (lottery.winningNumber !== null && lottery.winningNumber !== undefined) {
            // single winning number provided
            const wn = Array.isArray(lottery.winningNumber) ? lottery.winningNumber.join(', ') : lottery.winningNumber;
            winEl.innerText = `Winning Number(s): ${wn} (no winners)`;
        } else {
            // reset when new round created or no winners yet
            winEl.innerText = 'Not announced yet';
        }
    }
    try { initCountdown(lottery); } catch (e) { /* ignore if init not available yet */ }
}

// Listen for real-time changes
onSnapshot(doc(db, 'lottery', 'current'), (docSnap) => {
    renderCurrentLottery(docSnap.exists() ? docSnap.data() : {});
});


// Buy ticket
async function buyTicket() {

    const user = document.getElementById("username").value.trim();
    const phone = document.getElementById("phone") ? document.getElementById("phone").value.trim() : '';
    const number = Number(document.getElementById("number").value);
    const paymentMethod = document.getElementById("paymentMethod") ? document.getElementById("paymentMethod").value : '';
    const paymentFileInput = document.getElementById("paymentFile");
    const paymentFile = paymentFileInput && paymentFileInput.files && paymentFileInput.files[0] ? paymentFileInput.files[0] : null;

    if (!user || !phone || isNaN(number)) {
        showStyledAlert("Please fill in your name, phone, and number!");
        return;
    }
    if (!paymentMethod) {
        showStyledAlert("Please select a payment method!");
        return;
    }
    if (!paymentFile) {
        showStyledAlert("Please upload your payment proof!");
        return;
    }

    // Read payment file as base64
    const readFileAsBase64 = (file) => new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });

        let paymentProofUrl = null;
        try {
            showStyledAlert("Uploading payment proof, please wait...");
            paymentProofUrl = await uploadToCloudinary(paymentFile);
        } catch (e) {
            showStyledAlert("Failed to upload payment proof. Please try again.");
            return;
        }

    // Get current lottery to determine where to store tickets
    const lotterySnap = await getDoc(doc(db, 'lottery', 'current'));
    const lottery = lotterySnap.exists() ? lotterySnap.data() : null;
    if (!lottery || lottery.status !== "open") {
        showStyledAlert("Lottery is not open!");
        return;
    }

    // determine tickets collection path (per-round if roundId present)
    const ticketsCollection = lottery && lottery.roundId
        ? collection(db, 'rounds', lottery.roundId, 'tickets')
        : collection(db, 'lottery', 'current', 'tickets');

    // Check for duplicate ticket number in the tickets collection
    try {
        const ticketsCheckSnap = await getDocs(ticketsCollection);
        let duplicate = null;
        ticketsCheckSnap.forEach(d => {
            const t = d.data();
            if (t && Number(t.number) === number) duplicate = t;
        });
        if (duplicate) {
            showStyledAlert(`Ticket number ${number} is already used by ${duplicate.user}. Please pick another number.`);
            try { document.getElementById('number').value = ''; document.getElementById('number').focus(); } catch(e){}
            return;
        }
    } catch (err) {
        console.error('duplicate check failed', err);
    }

    const ticket = {
        user: user,
        phone: phone,
        number: number,
        time: new Date().toLocaleString(),
        paymentMethod: paymentMethod,
            paymentProof: paymentProofUrl,
        validated: false
    };

    // Save the ticket in the correct collection and save history
    await addDoc(ticketsCollection, ticket);
    await saveHistory(user, ticket);
    localStorage.setItem('currentUserName', user);

    // Clear input fields
    document.getElementById("username").value = "";
    if (document.getElementById("phone")) document.getElementById("phone").value = "";
    document.getElementById("number").value = "";
    if (paymentFileInput) paymentFileInput.value = "";
    // Hide payment preview and wrapper
    const paymentPreview = document.getElementById('paymentPreview');
    const paymentPreviewWrap = document.getElementById('paymentPreviewWrap');
    if (paymentPreview) paymentPreview.src = '';
    if (paymentPreviewWrap) paymentPreviewWrap.style.display = 'none';

    showStyledAlert("🎟️ Ticket purchased! Good luck!");
}

    async function uploadToCloudinary(file) {
        // Returns secure_url or throws
        const url = 'https://api.cloudinary.com/v1_1/dwfz6c6x0/image/upload';
        const preset = 'deksi-image';
        const formData = new FormData();
        formData.append('file', file);
        formData.append('upload_preset', preset);
        const resp = await fetch(url, { method: 'POST', body: formData });
        if (!resp.ok) throw new Error('Cloudinary upload failed');
        const data = await resp.json();
        if (!data.secure_url) throw new Error('No secure_url from Cloudinary');
        return data.secure_url;
    }
// Custom styled alert for user page (moved to top level)
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


// Load user tickets only
async function loadHistory() {

    // Try to get user name from localStorage first
    let user = localStorage.getItem('currentUserName') || document.getElementById("username").value.trim();
    if (!user) {
        showStyledAlert("Please buy a ticket first so we know who you are!");
        return;
    }

    // choose tickets collection based on active round
    const lotterySnap = await getDoc(doc(db, 'lottery', 'current'));
    const lottery = lotterySnap.exists() ? lotterySnap.data() : {};
    let ticketsSnap;
    if (lottery.roundId) {
        ticketsSnap = await getDocs(collection(db, 'rounds', lottery.roundId, 'tickets'));
    } else {
        ticketsSnap = await getDocs(collection(db, 'lottery', 'current', 'tickets'));
    }
    let myTickets = [];
    ticketsSnap.forEach(docSnap => {
        let t = docSnap.data();
        if (t.user === user) myTickets.push(t);
    });

    const historyList = document.getElementById("historyList");
    if (myTickets.length === 0) {
        historyList.innerHTML = '<span style="color:#888">No tickets found for this round.</span>';
        return;
    }

    // Build a nice HTML list
    let html = '<div style="display:flex;flex-direction:column;gap:12px;">';
    myTickets.forEach((t) => {
        html += `<div style=\"background:#181f2a;padding:12px 18px;border-radius:10px;box-shadow:0 2px 8px #0003;\">
            <div style=\"font-size:1.1em;color:#00ffcc;font-weight:600;\">Ticket #${t.number}</div>
            <div><b>Name:</b> <span style=\"color:#fff;\">${t.user}</span></div>
            <div><b>Number:</b> <span style=\"color:#ffd700;\">${t.number}</span></div>
            <div><b>Time:</b> <span style=\"color:#aaa;\">${t.time}</span></div>
        </div>`;
    });
    html += '</div>';
    historyList.innerHTML = html;
}


// Save purchase history
async function saveHistory(user, ticket) {
    await addDoc(collection(db, 'users', user, 'history'), ticket);
}


// Helpers
async function getLottery() {
    const lotterySnap = await getDoc(doc(db, 'lottery', 'current'));
    return lotterySnap.exists() ? lotterySnap.data() : {};
}

async function save(data) {
    await setDoc(doc(db, 'lottery', 'current'), data);
}
// holds the last uploaded image dataURL (resized) so it can be attached to a ticket
let currentUploadData = null;
// IMAGE DROPZONE LOGIC
const dropzoneArea = document.getElementById('dropzoneArea');
const userImageInput = document.getElementById('userImage');
const imagePreview = document.getElementById('imagePreview');
const dropzoneText = document.getElementById('dropzoneText');

if (dropzoneArea && userImageInput && imagePreview) {
    dropzoneArea.addEventListener('click', () => {
        userImageInput.click();
    });
    dropzoneArea.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            userImageInput.click();
        }
    });
    dropzoneArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropzoneArea.style.borderColor = '#00ffcc';
    });
    dropzoneArea.addEventListener('dragleave', (e) => {
        e.preventDefault();
        dropzoneArea.style.borderColor = '#00ff66';
    });
    dropzoneArea.addEventListener('drop', (e) => {
        e.preventDefault();
        dropzoneArea.style.borderColor = '#00ff66';
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            userImageInput.files = e.dataTransfer.files;
            handleImagePreview(e.dataTransfer.files[0]);
        }
    });
    userImageInput.addEventListener('change', (e) => {
        if (userImageInput.files && userImageInput.files[0]) {
            handleImagePreview(userImageInput.files[0]);
        }
    });
}

function resizeAndCompressImage(file, maxWidth, maxHeight, quality, cb) {
    const reader = new FileReader();
    reader.onload = function(evt) {
        const img = new Image();
        img.onload = function() {
            let w = img.width;
            let h = img.height;
            const ratio = Math.min(maxWidth / w, maxHeight / h, 1);
            w = Math.round(w * ratio);
            h = Math.round(h * ratio);
            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d');
            // optional: fill with a dark background for better contrast
            ctx.fillStyle = '#0b0b0b';
            ctx.fillRect(0,0,w,h);
            ctx.drawImage(img, 0, 0, w, h);
            try {
                const dataURL = canvas.toDataURL('image/jpeg', quality || 0.8);
                cb(null, dataURL);
            } catch (err) {
                cb(err);
            }
        };
        img.onerror = function(err){ cb(err || new Error('image load error')) };
        img.src = evt.target.result;
    };
    reader.onerror = function(e){ cb(e) };
    reader.readAsDataURL(file);
}

function handleImagePreview(file) {
    // resize to reasonable thumbnail to avoid huge localStorage usage
    resizeAndCompressImage(file, 420, 420, 0.78, function(err, dataUrl){
        if (err) {
            // fallback to direct dataURL read
            const fr = new FileReader();
            fr.onload = function(e){
                imagePreview.src = e.target.result;
                imagePreview.style.display = 'block';
                dropzoneText.style.display = 'none';
                currentUploadData = e.target.result;
            };
            fr.readAsDataURL(file);
            return;
        }
        imagePreview.src = dataUrl;
        imagePreview.style.display = 'block';
        dropzoneText.style.display = 'none';
        currentUploadData = dataUrl;
    });
}

// ===== PUBLISHER (demo WebRTC using localStorage signaling) =====
// Elements on user.html: #publishBtn and #publishPreview
const publishBtn = document.getElementById('publishBtn');
const publishPreview = document.getElementById('publishPreview');
let pubPc = null;
let pubStream = null;
let pubId = null;

function pushIceArray(key, cand) {
    try {
        const arr = JSON.parse(localStorage.getItem(key) || '[]');
        arr.push(cand);
        localStorage.setItem(key, JSON.stringify(arr));
    } catch (e) { console.error('pushIceArray', e); }
}

if (publishBtn) {
    publishBtn.addEventListener('click', async () => {
        if (!pubStream) {
            try {
                pubStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
                if (publishPreview) { publishPreview.srcObject = pubStream; publishPreview.style.display = 'block'; }

                pubPc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
                // send local ICE candidates to localStorage
                pubPc.onicecandidate = (e) => { if (e.candidate) pushIceArray('webrtc_ice_pub_' + pubId, e.candidate); };
                pubStream.getTracks().forEach(t => pubPc.addTrack(t, pubStream));

                pubId = 'pub_' + Date.now() + '_' + Math.floor(Math.random() * 10000);
                const userName = (document.getElementById('username') && document.getElementById('username').value) || ('User-' + pubId);

                const offer = await pubPc.createOffer();
                await pubPc.setLocalDescription(offer);

                const payload = { id: pubId, name: userName, sdp: offer.sdp, type: offer.type, avatar: currentUploadData || null };
                localStorage.setItem('webrtc_offer_' + pubId, JSON.stringify(payload));

                // listen for answer and ICE from live page
                const onStorage = (ev) => {
                    try {
                        if (!ev.key) return;
                        if (ev.key === ('webrtc_answer_' + pubId) && ev.newValue) {
                            const ans = JSON.parse(ev.newValue);
                            if (ans && ans.sdp) pubPc.setRemoteDescription({ type: ans.type || 'answer', sdp: ans.sdp }).catch(console.error);
                        }
                        if (ev.key === ('webrtc_ice_answer_' + pubId) && ev.newValue) {
                            const cands = JSON.parse(ev.newValue || '[]');
                            for (const c of cands) try { pubPc.addIceCandidate(c).catch(()=>{}); } catch(e){}
                        }
                    } catch (e) { }
                };
                window.addEventListener('storage', onStorage);

                publishBtn.textContent = 'Stop Publishing';
            } catch (err) {
                console.error('publish start failed', err);
                alert('Unable to access camera/microphone.');
                if (pubStream) { pubStream.getTracks().forEach(t => t.stop()); pubStream = null; }
            }
        } else {
            // stop publishing
            try { if (pubStream) { pubStream.getTracks().forEach(t => t.stop()); } } catch(e){}
            if (publishPreview) { publishPreview.srcObject = null; publishPreview.style.display = 'none'; }
            try { if (pubPc) pubPc.close(); } catch(e){}
            if (pubId) { try { localStorage.removeItem('webrtc_offer_' + pubId); localStorage.removeItem('webrtc_ice_pub_' + pubId); } catch(e){} }
            pubStream = null; pubPc = null; pubId = null;
            publishBtn.textContent = 'Start Publishing';
        }
    });
}

/* ===== COUNTDOWN & LIVE NAVIGATION ===== */
function pad(n) { return n.toString().padStart(2, '0'); }

// single interval holder so calling initCountdown repeatedly doesn't create duplicates
let _countdownInterval = null;

// lotteryArg (optional) can be passed directly (preferred) to avoid extra async fetch
async function initCountdown(lotteryArg) {
    const countdownEl = document.getElementById('countdownTimer');
    const liveBtn = document.getElementById('liveBtn');
    if (!countdownEl || !liveBtn) return;

    // ensure only one click listener is attached
    // clear any existing interval immediately so clearing on admin side takes effect
    if (_countdownInterval) { clearInterval(_countdownInterval); _countdownInterval = null; }

    // reattach live button handler (replace to avoid duplicate listeners)
    try {
        liveBtn.replaceWith(liveBtn.cloneNode(true));
        const freshLiveBtn = document.getElementById('liveBtn');
        if (freshLiveBtn) freshLiveBtn.addEventListener('click', () => { window.location.href = 'live.html'; });
    } catch (e) { /* ignore if DOM replace fails for some reason */ }

    // determine lottery object (use passed arg if available)
    let lottery = lotteryArg;
    if (!lottery) {
        lottery = await getLottery();
    }

    let end = null;
    if (lottery && lottery.countdownEnd) {
        end = Number(lottery.countdownEnd);
    } else if (lottery && lottery.countdownSeconds) {
        end = Date.now() + Number(lottery.countdownSeconds) * 1000;
        lottery.countdownEnd = end;
        await save(lottery);
    }

    if (!end) {
        // no countdown configured — clear any running interval and show placeholder
        if (_countdownInterval) { clearInterval(_countdownInterval); _countdownInterval = null; }
        countdownEl.innerText = '--:--:--';
        return;
    }

    // clear any previous interval
    if (_countdownInterval) { clearInterval(_countdownInterval); _countdownInterval = null; }

    const tick = () => {
        const now = Date.now();
        let diff = Math.max(0, end - now);
        if (diff <= 0) {
            countdownEl.innerText = '00:00:00';
            // navigate shortly after hitting zero
            setTimeout(() => { window.location.href = 'vedio-stream/viewer.html'; }, 200);
            if (_countdownInterval) { clearInterval(_countdownInterval); _countdownInterval = null; }
            return;
        }
        const s = Math.floor(diff / 1000);
        const days = Math.floor(s / 86400);
        const hh = Math.floor((s % 86400) / 3600);
        const mm = Math.floor((s % 3600) / 60);
        const ss = s % 60;

        if (days > 0) {
            countdownEl.innerText = `${days}d ${pad(hh)}:${pad(mm)}:${pad(ss)}`;
        } else {
            countdownEl.innerText = `${pad(hh)}:${pad(mm)}:${pad(ss)}`;
        }
    };

    // initial render and interval
    tick();
    _countdownInterval = setInterval(tick, 500);
}