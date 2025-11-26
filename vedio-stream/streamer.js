import { db, collection, doc, setDoc, getDoc, onSnapshot, addDoc, getDocs, deleteDoc } from '../firebase-init.js';
import { uploadVideoToCloudinary } from './cloudinary-upload.js';

const video = document.getElementById('streamerVideo');

// --- WebRTC setup ---
let pc = null;
let stream = null;
let streamId = 'main-stream'; // could be randomized for multi-stream
let recorder = null;
let recordedChunks = [];

// placeholder functions so UI can safely call them before camera is ready
window.startRecording = async function() { alert('Recorder not ready yet — please wait until camera is initialized.'); };
window.stopRecording = async function() { alert('Recorder not ready yet — please wait until camera is initialized.'); };

async function startStream() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  } catch (err) {
    console.error('getUserMedia failed', err);
    const startBtn = document.getElementById('startRecord');
    const stopBtn = document.getElementById('stopRecord');
    const status = document.getElementById('recStatus');
    if (startBtn) startBtn.disabled = true;
    if (stopBtn) stopBtn.disabled = true;
    if (status) status.textContent = 'Camera/microphone access denied or unavailable.';
    // Provide a helpful message for common errors
    if (err && err.name === 'NotAllowedError') {
      alert('Permission denied: please allow camera and microphone access for this page.');
    } else {
      alert('Unable to access camera/microphone: ' + (err && err.message ? err.message : err));
    }
    return;
  }
  video.srcObject = stream;

  // --- Recording logic ---
  recorder = new MediaRecorder(stream, { mimeType: 'video/webm; codecs=vp8,opus' });
  recordedChunks = [];
  recorder.ondataavailable = e => { if (e.data.size > 0) recordedChunks.push(e.data); };
  recorder.onstop = async () => {
    if (recordedChunks.length > 0) {
      try {
  const blob = new Blob(recordedChunks, { type: 'video/webm' });
  const url = await uploadVideoToCloudinary(blob);
        // save recorded url on the stream doc
        await setDoc(doc(db, 'streams', streamId), { recordedUrl: url, recordedAt: Date.now() }, { merge: true });
        // collect recent chat messages to attach to this recording (include doc ids)
        let messages = [];
        try {
          const chatSnap = await getDocs(collection(db, 'streams', streamId, 'chat'));
          messages = chatSnap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a,b) => (a.createdAt||0) - (b.createdAt||0));
        } catch (e) {
          console.warn('Failed to fetch chat messages for recording:', e);
        }
        // attach current round metadata (if any)
        let roundMeta = {};
        try {
          const lottoSnap = await getDoc(doc(db, 'lottery', 'current'));
          if (lottoSnap.exists()) {
            const l = lottoSnap.data();
            roundMeta.roundId = l.roundId || null;
            roundMeta.roundName = l.roundName || l.roundTitle || null;
            // prefer countdownEnd if set, otherwise use round createdAt
            roundMeta.roundTime = l.countdownEnd || l.createdAt || null;
          }
        } catch (e) {
          console.warn('Failed to read current lottery for recording meta', e);
        }
        // add to recordings collection for viewers feed, include messages (with ids) and round metadata
        await addDoc(collection(db, 'recordings'), { streamId, url, createdAt: Date.now(), messages, ...roundMeta });
        alert('Recording uploaded to Cloudinary!');
      } catch (e) {
        alert('Failed to upload recording: ' + e.message);
      }
    }
  };
  // recorder will be started/stopped from UI controls
  // expose controls
  window.startRecording = () => {
    (async () => {
      if (recorder && recorder.state === 'inactive') {
        recordedChunks = [];
        // create and publish an offer so viewers connect now
        try {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          await setDoc(doc(db, 'streams', streamId), { offer: offer.sdp, type: offer.type, recording: true }, { merge: true });
        } catch (e) {
          console.error('Failed to create/publish offer on startRecording', e);
        }
        recorder.start();
        const startBtn = document.getElementById('startRecord');
        const stopBtn = document.getElementById('stopRecord');
        const status = document.getElementById('recStatus');
        if (startBtn) startBtn.disabled = true;
        if (stopBtn) stopBtn.disabled = false;
        if (status) status.textContent = 'Recording...';
      }
    })();
  };
  window.stopRecording = () => {
    if (recorder && recorder.state === 'recording') {
      recorder.stop();
      const startBtn = document.getElementById('startRecord');
      const stopBtn = document.getElementById('stopRecord');
      const status = document.getElementById('recStatus');
      if (startBtn) startBtn.disabled = false;
      if (stopBtn) stopBtn.disabled = true;
      if (status) status.textContent = 'Processing upload...';
      // unset the live offer/recording flag so viewers know stream stopped
      (async () => {
        try {
          await setDoc(doc(db, 'streams', streamId), { recording: false, offer: null, answer: null }, { merge: true });
        } catch (e) {
          console.warn('Failed to clear stream offer on stopRecording', e);
        }
      })();
    }
  };
  pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
  stream.getTracks().forEach(track => pc.addTrack(track, stream));


  // Listen for answer
  onSnapshot(doc(db, 'streams', streamId), snap => {
    const data = snap.data();
    if (data && data.answer) {
      if (!pc.currentRemoteDescription || pc.currentRemoteDescription.sdp !== data.answer) {
        pc.setRemoteDescription({ type: 'answer', sdp: data.answer });
      }
    }
  });

  // ICE
  pc.onicecandidate = e => {
      if (e.candidate) {
        // Store only JSON-serializable ICE candidate data
        addDoc(collection(db, 'streams', streamId, 'ice-candidates'), {
          candidate: {
            candidate: e.candidate.candidate,
            sdpMid: e.candidate.sdpMid,
            sdpMLineIndex: e.candidate.sdpMLineIndex
          }
        });
      }
    };
  // Listen for viewer ICE
  onSnapshot(collection(db, 'streams', streamId, 'viewer-ice'), snap => {
    snap.docChanges().forEach(change => {
      if (change.type === 'added') {
        const c = change.doc.data();
        if (c.candidate) pc.addIceCandidate(new RTCIceCandidate(c.candidate)).catch(()=>{});
      }
    });
  });
}

// Chat removed: streamer no longer listens for live chat messages.

// Render recordings for streamer (per-recording chat view)
const recordingsFeed = document.getElementById('recordingsFeed');
function renderRecordingForStreamer(rec) {
  const card = document.createElement('div');
  card.style.background = 'linear-gradient(180deg,#061018,#07121a)';
  card.style.border = '1px solid rgba(255,255,255,0.02)';
  card.style.padding = '8px';
  card.style.borderRadius = '10px';
  card.style.display = 'flex';
  card.style.flexDirection = 'column';
  card.style.gap = '8px';
  // video thumbnail
  const vid = document.createElement('video');
  vid.src = rec.url;
  vid.controls = true;
  vid.style.width = '100%';
  vid.style.height = '160px';
  vid.style.borderRadius = '8px';
  vid.style.objectFit = 'cover';
  card.appendChild(vid);
  const title = document.createElement('div');
  title.style.fontWeight = '800';
  title.style.color = '#ffd670';
  title.textContent = rec.createdAt ? new Date(rec.createdAt).toLocaleString() : 'Recording';
  card.appendChild(title);
  const meta = document.createElement('div');
  meta.style.color = '#9fb8c8';
  meta.style.fontSize = '13px';
  meta.textContent = rec.streamId || '';
  card.appendChild(meta);
  // remove button (streamer only)
  const controls = document.createElement('div');
  controls.style.display = 'flex';
  controls.style.justifyContent = 'flex-end';
  controls.style.gap = '8px';
  const delBtn = document.createElement('button');
  delBtn.textContent = 'Remove';
  delBtn.style.background = '#ff4d5a';
  delBtn.style.color = '#fff';
  delBtn.style.border = 'none';
  delBtn.style.padding = '6px 10px';
  delBtn.style.borderRadius = '8px';
  delBtn.style.cursor = 'pointer';
  delBtn.onclick = async () => {
    if (!rec.id) return alert('Cannot delete recording: missing id');
    if (!confirm('Delete this recording? This will remove it from streamer and viewer feeds.')) return;
    try {
      // delete recording doc from Firestore
      await deleteDoc(doc(db, 'recordings', rec.id));
      // if this recording was the last recordedUrl on the stream doc, clear it
      try {
        const sDoc = await getDoc(doc(db, 'streams', streamId));
        if (sDoc.exists()) {
          const sdata = sDoc.data();
          if (sdata && sdata.recordedUrl === rec.url) {
            await setDoc(doc(db, 'streams', streamId), { recordedUrl: null, recordedAt: null }, { merge: true });
          }
        }
      } catch (e) {
        console.warn('Failed to clear stream recordedUrl after deletion', e);
      }
      // optimistically remove card from UI; snapshot listener will also update
      card.remove();
    } catch (e) {
      console.error('Failed to delete recording', e);
      alert('Failed to delete recording: ' + (e.message || e));
    }
  };
  controls.appendChild(delBtn);
  card.appendChild(controls);
  // Chat removed: recording cards do not display message lists.
  const none = document.createElement('div');
  none.style.color = '#9fb8c8';
  none.textContent = '';
  card.appendChild(none);
  return card;
}

onSnapshot(collection(db, 'recordings'), snap => {
  const items = [];
  snap.forEach(d => items.push({ id: d.id, ...d.data() }));
  items.sort((a,b) => (b.createdAt||0) - (a.createdAt||0));
  if (recordingsFeed) {
    recordingsFeed.innerHTML = '';
    items.forEach(it => recordingsFeed.appendChild(renderRecordingForStreamer(it)));
  }
});


// Stop recording and upload when window closes or reloads
window.addEventListener('beforeunload', () => {
  if (recorder && recorder.state === 'recording') {
    recorder.stop();
  }
});

// wire UI buttons if present
document.addEventListener('DOMContentLoaded', () => {
  const startBtn = document.getElementById('startRecord');
  const stopBtn = document.getElementById('stopRecord');
  if (startBtn) startBtn.addEventListener('click', () => { window.startRecording(); });
  if (stopBtn) stopBtn.addEventListener('click', () => { window.stopRecording(); });
});

startStream();
