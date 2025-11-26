import { db, collection, onSnapshot, getDoc, doc } from '../firebase-init.js';

const recordingsFeed = document.getElementById('recordingsFeed');

// If admin creates a new round (lottery/current changes), viewers should be sent back to user page
let _lastSeenRoundId = null;
(async () => {
  try {
    const lottoDocRef = doc(db, 'lottery', 'current');
    const snap = await getDoc(lottoDocRef);
    if (snap.exists()) {
      const d = snap.data();
      _lastSeenRoundId = d && d.roundId ? d.roundId : null;
    }
    // listen for subsequent changes
    onSnapshot(lottoDocRef, (s) => {
      const data = s.exists() ? s.data() : null;
      const newRoundId = data && data.roundId ? data.roundId : null;
      if (_lastSeenRoundId === null) {
        _lastSeenRoundId = newRoundId;
        return; // ignore initial set
      }
      // if roundId changed (new round created), navigate back to user page
      if (newRoundId && newRoundId !== _lastSeenRoundId) {
        try { window.location.href = '../index.html'; } catch(e) { /* ignore */ }
      }
      _lastSeenRoundId = newRoundId;
    });
  } catch (e) {
    console.warn('Failed to initialize lottery/current watcher in viewer', e);
  }
})();

function renderRecording(rec) {
  const card = document.createElement('div');
  card.className = 'rec-card';
  // video
  const vid = document.createElement('video');
  vid.src = rec.url;
  vid.controls = true;
  vid.style.width = '320px';
  vid.style.height = '180px';
  vid.style.borderRadius = '8px';
  vid.style.objectFit = 'cover';

  const right = document.createElement('div');
  right.style.flex = '1';
  right.style.display = 'flex';
  right.style.flexDirection = 'column';
  right.style.justifyContent = 'center';

  // Round and winner info (populate asynchronously)
  // Two-line display: green winner label above, white time below
  const winnerLabel = document.createElement('div');
  winnerLabel.style.marginTop = '8px';
  winnerLabel.style.color = '#00ff88';
  winnerLabel.style.fontWeight = '800';
  winnerLabel.textContent = 'Winner of round (loading...)';
  right.appendChild(winnerLabel);

  const timeInfo = document.createElement('div');
  timeInfo.style.color = '#ffffff';
  timeInfo.style.marginTop = '6px';
  timeInfo.style.fontSize = '13px';
  timeInfo.textContent = '';
  right.appendChild(timeInfo);

  // resolve round label and time (prefer recording metadata, fallback to lottery/current)
  (async () => {
    try {
      let roundLabel = rec.roundName || rec.roundId || '';
      let time = rec.createdAt || rec.roundTime || null;
      if (!roundLabel && rec.roundId) {
        const rDoc = await getDoc(doc(db, 'rounds', rec.roundId));
        if (rDoc.exists()) {
          const r = rDoc.data();
          roundLabel = r.roundName || rec.roundId;
        }
      }
      if (!roundLabel) {
        const lottoSnap = await getDoc(doc(db, 'lottery', 'current'));
        if (lottoSnap.exists()) {
          const l = lottoSnap.data();
          roundLabel = l.roundName || l.roundId || roundLabel || 'N/A';
          if (!time) time = l.countdownEnd || l.createdAt || null;
        }
      }
      const timeStr = time ? new Date(time).toLocaleString() : '';
      winnerLabel.textContent = `Winner of round ${roundLabel}`;
      timeInfo.textContent = timeStr;
    } catch (e) {
      console.warn('Failed to build winner line for recording', e);
      winnerLabel.textContent = 'Winner of round (unknown)';
      timeInfo.textContent = '';
    }
  })();

  card.appendChild(vid);
  card.appendChild(right);
  return card;
}

// subscribe to recordings collection
onSnapshot(collection(db, 'recordings'), (snap) => {
  const items = [];
  snap.forEach(d => items.push({ id: d.id, ...d.data() }));
  items.sort((a,b) => (b.createdAt||0) - (a.createdAt||0));
  if (recordingsFeed) {
    recordingsFeed.innerHTML = '';
    items.forEach(it => recordingsFeed.appendChild(renderRecording(it)));
  }
});
