import { db, collection, getDocs, getDoc, doc, setDoc, updateDoc, deleteDoc, storage, storageRef, getDownloadURL } from './firebase-init.js';

async function loadRounds() {
    const grid = document.getElementById('roundsGrid');
    grid.innerHTML = 'Loading...';
    try {
        const snaps = await getDocs(collection(db, 'rounds'));
        if (snaps.empty) { grid.innerHTML = '<div style="color:#888">No rounds found.</div>'; return; }
        let html = '';
        snaps.forEach(s => {
            const r = s.data();
            const id = s.id;
            html += `<div class="round-square" data-id="${id}">
                <div style="font-size:1.3em;font-weight:700;color:#00ffcc;">${r.roundName || 'Round'}</div>
                <div style="color:#ffd700;font-size:1.1em;margin:8px 0 2px 0;">${r.ticketPrice} birr</div>
                <div style="color:#ccc;font-size:0.95em;">${new Date(r.createdAt||0).toLocaleString()}</div>
                <div style="display:flex;gap:8px;margin-top:10px;">
                    <button class="makeCurrentBtn" data-id="${id}" style="padding:7px 12px;font-size:0.95em;background:#222;color:#00ffcc;border-radius:8px;border:1.5px solid #00ffcc;cursor:pointer;">Make Current</button>
                    <button class="deleteRoundBtn" data-id="${id}" style="padding:7px 12px;font-size:0.95em;background:#ff4444;color:#000;border-radius:8px;border:1.5px solid #ff8888;cursor:pointer;">Delete</button>
                </div>
            </div>`;
        });
        grid.innerHTML = html;
        // attach delete handlers
        document.querySelectorAll('.deleteRoundBtn').forEach(b => b.addEventListener('click', (e)=>{
            e.stopPropagation();
            const id = b.getAttribute('data-id'); deleteRound(id);
        }));
        // Add click listeners to round squares
        document.querySelectorAll('.round-square').forEach(sq => {
            sq.addEventListener('click', (e) => {
                const id = sq.getAttribute('data-id');
                // Hide all other squares
                document.querySelectorAll('.round-square').forEach(o => { if (o !== sq) o.style.display = 'none'; });
                // Show tickets for this round
                loadRoundTickets(id);
            });
        });
        // Add listeners for make current
        document.querySelectorAll('.makeCurrentBtn').forEach(b => b.addEventListener('click', (e)=>{
            e.stopPropagation();
            const id = b.getAttribute('data-id'); setCurrent(id);
        }));
    } catch (err) {
        console.error(err);
        grid.innerHTML = '<div style="color:#f66">Failed to load rounds</div>';
    }
}

// Delete a round and its tickets (with confirmation)
window.deleteRound = async function(roundId) {
    if (!roundId) return;
    const ok = confirm('Delete this round and ALL its tickets? This cannot be undone.');
    if (!ok) return;
    try {
        // delete tickets subcollection documents first
        const ticketsSnap = await getDocs(collection(db, 'rounds', roundId, 'tickets'));
        const delPromises = [];
        ticketsSnap.forEach(t => {
            delPromises.push(deleteDoc(doc(db, 'rounds', roundId, 'tickets', t.id)));
        });
        await Promise.all(delPromises);

        // delete the round document
        await deleteDoc(doc(db, 'rounds', roundId));

        // if this round was set as current, clear the reference from lottery/current
        try {
            const curSnap = await getDoc(doc(db, 'lottery', 'current'));
            if (curSnap.exists()) {
                const cur = curSnap.data();
                if (cur.roundId === roundId) {
                    delete cur.roundId; delete cur.roundName; delete cur.ticketPrice; cur.status = 'not_started';
                    await setDoc(doc(db, 'lottery', 'current'), cur);
                }
            }
        } catch (e) { console.warn('failed to clear lottery/current after round delete', e); }

        alert('Round deleted');
        loadRounds();
        // clear tickets view if it was showing this round
        const ticketsContainer = document.getElementById('ticketsContainer');
        if (ticketsContainer) ticketsContainer.innerHTML = '';
    } catch (e) {
        console.error('deleteRound failed', e);
        alert('Failed to delete round: ' + (e && e.message ? e.message : e));
    }
}

async function loadRoundTickets(roundId) {
    const ticketsContainer = document.getElementById('ticketsContainer');
    ticketsContainer.innerHTML = '<h2>Tickets for round</h2><div>Loading...</div>';
    try {
        const snaps = await getDocs(collection(db, 'rounds', roundId, 'tickets'));
        if (snaps.empty) { ticketsContainer.innerHTML = '<div style="color:#888">No tickets for this round.</div>'; return; }
        let html = `<h2 style="margin-top:8px;">Tickets</h2>`;
        // Header row
        html += `<div class="ticket-grid ticket-header">
            <div>User</div><div>Phone</div><div>Number</div><div>Payment</div><div>Proof</div><div>Status</div><div>Actions</div>
        </div>`;
        snaps.forEach(s => {
            const t = s.data();
            const id = s.id;
            html += `<div class="ticket-grid">
                <div>${t.user}</div>
                <div>${t.phone}</div>
                <div style="color:#ffd700;font-weight:700;">${t.number}</div>
                <div>${t.paymentMethod || '-'}</div>
                <div>${t.paymentProof?`<img id="proof-${id}" data-proof="${encodeURIComponent(String(t.paymentProof))}" class="ticket-img" src=""/>`:''}</div>
                <div>${t.validated?'<span style="color:#0f0;font-weight:700;">Validated</span>':'<span style="color:#ff6666;">Pending</span>'}</div>
                <div class="ticket-actions">
                    <button class="validate" onclick="approveTicket('${roundId}','${id}')">Validate</button>
                    <button class="reject" onclick="rejectTicket('${roundId}','${id}')">Reject</button>
                </div>
            </div>`;
        });
        ticketsContainer.innerHTML = html;
        // after rendering, resolve any paymentProof entries that are storage paths
        document.querySelectorAll('img[data-proof]').forEach(async img => {
            try {
                const encoded = img.getAttribute('data-proof') || '';
                const proofRaw = decodeURIComponent(encoded || '');
                const proof = String(proofRaw || '');
                if (!proof) return;
                img.alt = 'loading payment proof...';
                // if it's already a usable URL or data URL, use it directly
                if (proof.startsWith('data:') || proof.startsWith('http')) {
                    img.src = proof;
                    img.alt = 'payment proof';
                    return;
                }
                // normalize path (strip leading slash)
                let tryPaths = [];
                let base = proof;
                if (base.startsWith('/')) base = base.slice(1);
                tryPaths.push(base);
                // if it looks like a plain filename, also try common prefixes
                if (!base.includes('/')) {
                    tryPaths.push(`paymentProofs/${base}`);
                    tryPaths.push(`paymentProofs/${roundId}/${base}`);
                }
                let loaded = false;
                for (const p of tryPaths) {
                    try {
                        const ref = storageRef(storage, p);
                        const url = await getDownloadURL(ref);
                        img.src = url;
                        img.alt = 'payment proof';
                        loaded = true;
                        break;
                    } catch (err) {}
                }
                if (!loaded) {
                    img.style.display = 'none';
                    const pEl = document.createElement('div');
                    pEl.style.color = '#f66';
                    pEl.style.fontSize = '12px';
                    pEl.style.marginTop = '6px';
                    pEl.textContent = `Stored proof: ${proof}`;
                    img.parentNode.insertBefore(pEl, img.nextSibling);
                }
            } catch (e) { console.error('resolve proof failed', e); }
        });
    } catch (err) {
        console.error(err);
        ticketsContainer.innerHTML = '<div style="color:#f66">Failed to load tickets</div>';
    }
}

async function setCurrent(roundId) {
    try {
        const rDoc = await getDoc(doc(db, 'rounds', roundId));
        if (!rDoc.exists()) { alert('Round not found'); return; }
        const r = rDoc.data();
        r.roundId = roundId;
        await setDoc(doc(db, 'lottery', 'current'), r);
        alert('Set as current round');
    } catch (e) { console.error(e); alert('Failed to set current round'); }
}

// validate and reject functions call Firestore directly
window.approveTicket = async function(roundId, ticketId) {
    try {
        // Mark as validated
        await updateDoc(doc(db, 'rounds', roundId, 'tickets', ticketId), { validated: true, validatedAt: Date.now() });
        // Fetch ticket data
        const tSnap = await getDoc(doc(db, 'rounds', roundId, 'tickets', ticketId));
        if (tSnap.exists()) {
            const t = tSnap.data();
            // Store in users/{user}/validated collection
            await setDoc(doc(db, 'users', t.user, 'validated', ticketId), t);
        }
        loadRoundTickets(roundId);
    } catch(e){console.error(e);alert('Failed')}
}
window.rejectTicket = async function(roundId, ticketId) {
    try {
        // Remove from tickets collection
        await deleteDoc(doc(db, 'rounds', roundId, 'tickets', ticketId));
        // Optionally, remove from users/{user}/validated if present
        // (not strictly needed, but can be added if you want full cleanup)
        loadRoundTickets(roundId);
    } catch(e){console.error(e);alert('Failed')}
}

document.getElementById('refreshRounds').addEventListener('click', loadRounds);
document.getElementById('backAdmin').addEventListener('click', ()=>{ window.location.href='admin.html' });

// initial load
loadRounds();
