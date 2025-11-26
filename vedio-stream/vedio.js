// Use AgoraChat provided by the loaded script (or shim). Do NOT use require() in browser.
// const AgoraChat = require("./Agora-chat");

// NOTE: removed accidental bundler/React require which breaks in the browser.
// If you need JSX/runtime imports, bundle this file with a build step (esbuild/webpack/etc.).

let APP_ID="4e65854fa216492cb281c2defd76667e"


let token=null;
let uid = Math.floor(Math.random()*10000)

let client;
let channel;
let ws = null;
const SIGNALING_URL = (location.hostname === '127.0.0.1' || location.hostname === 'localhost') ? 'ws://localhost:8080' : 'ws://' + location.hostname + ':8080';
let currentRoom = null;
const peerConnections = new Map(); // viewerId -> RTCPeerConnection (on streamer side)

let localStream;
let remoteStream;
let peerConnection;

const servers = {
    iceServers: [
        {
            urls: ['stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302']
        }
    ]
};

let init = async () => {
    client = await AgoraChat.createInstance(APP_ID);
    await client.login({ uid, token });

    // Do not auto-join a channel; wait for the user to choose a room.
    console.log('AgoraChat client initialized, ready to join a room.');
};
let handleMessageFromPeer = async (Message, memberID) => {
    // Message may be a string or object depending on shim/SDK.
    let payload = null;
    try {
        if (!Message) return;
        if (typeof Message === 'string') payload = JSON.parse(Message);
        else if (Message.text) payload = typeof Message.text === 'string' ? JSON.parse(Message.text) : Message.text;
        else payload = Message;
    } catch (e) {
        console.warn('Failed to parse incoming message', e, Message);
        return;
    }

    console.log('received message', payload, 'from', memberID);

    if (!payload || !payload.type) return;

    switch (payload.type) {
        case 'offer':
            await handleOffer(payload.offer, memberID);
            break;
        case 'answer':
            if (peerConnection && payload.answer) {
                await peerConnection.setRemoteDescription(new RTCSessionDescription(payload.answer));
                console.log('Set remote answer');
            }
            break;
        case 'candidate':
            if (peerConnection && payload.candidate) {
                try{
                    await peerConnection.addIceCandidate(payload.candidate);
                    console.log('Added remote ICE candidate');
                }catch(e){console.warn('addIceCandidate failed',e)}
            }
            break;
        default:
            console.log('Unhandled message type', payload.type);
    }
};



let handleUserJoined = async (memberId) => {
    console.log('A new user joined the channel', memberId);
    // If we have a local stream, offer to the new member.
    if (localStream) createOffer(memberId);
};

let createOffer = async (memberId) => {
    // Ensure we have a local stream (streamer); if not, ask user to start it.
    if (!localStream) {
        console.log('Local stream not started yet; starting automatically for streamer.');
        await startLocalStream();
    }

    // Create a dedicated peer connection for this viewer (streamer-side)
    const pc = new RTCPeerConnection(servers);

    // Add local tracks (streamer's camera/mic) to this pc
    if (localStream) {
        localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));
    }

    // When ICE candidate is available, forward it to the signaling server for the specific viewer
    pc.onicecandidate = async (event) => {
        if (event.candidate) {
            sendRoomMessage({ type: 'candidate', candidate: event.candidate }, memberId);
        }
    };

    // store pc so answers/candidates can be applied
    peerConnections.set(memberId, pc);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    sendRoomMessage({ type: 'offer', offer }, memberId);
};

let handleOffer = async (offer, fromId) => {
    // Create peer connection and respond with answer
    peerConnection = new RTCPeerConnection(servers);

    remoteStream = new MediaStream();
    // Attach remote stream to the single player element (viewer will see/hear streamer)
    const player = document.getElementById('player');
    player.srcObject = remoteStream;
    player.muted = false;

    // Ensure we have local stream
    if (!localStream) {
        await startLocalStream();
    }

    if (localStream) {
        localStream.getTracks().forEach((track) => peerConnection.addTrack(track, localStream));
    }

    peerConnection.ontrack = (event) => {
        event.streams[0].getTracks().forEach((track) => remoteStream.addTrack(track));
    };

    peerConnection.onicecandidate = (event) => {
        if (event.candidate) sendRoomMessage({ type: 'candidate', candidate: event.candidate }, fromId);
    };

    await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);

    sendRoomMessage({ type: 'answer', answer }, fromId);
};

function sendRoomMessage(payload, toMemberId){
    // Prefer WebSocket signaling when available (cross-device). Fall back to shim/local channel.
    try{
        if (ws && ws.readyState === WebSocket.OPEN && currentRoom){
            ws.send(JSON.stringify({ type: payload.type, room: currentRoom, to: toMemberId, payload }));
            return;
        }
        if (client && typeof client.sendMessageToPeer === 'function'){
            client.sendMessageToPeer({ text: JSON.stringify(payload) }, toMemberId);
            return;
        }
        if (channel && typeof channel._emit === 'function'){
            channel._emit('MessageFromPeer', { text: JSON.stringify(payload), from: uid, to: toMemberId });
            return;
        }
        console.warn('No messaging implementation available for payload', payload);
    }catch(e){console.warn('sendRoomMessage failed',e)}
}

init();

// Local stream controls
async function startLocalStream(){
    try{
            // Quick secure-context check: many browsers require HTTPS for camera access
            if (typeof window !== 'undefined' && !window.isSecureContext && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1'){
                const msg = 'getUserMedia requires a secure context (HTTPS) on this browser. Serve the page over HTTPS or use localhost for testing.';
                console.warn(msg);
                document.getElementById('status').textContent = msg;
                throw new Error(msg);
            }

            // cross-browser getUserMedia wrapper
            const getUserMediaCompat = (constraints) => {
                if (typeof navigator === 'undefined') return Promise.reject(new Error('navigator is undefined'));
                if (navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function') {
                    return navigator.mediaDevices.getUserMedia(constraints);
                }
                const legacy = navigator.getUserMedia || navigator.webkitGetUserMedia || navigator.mozGetUserMedia || navigator.msGetUserMedia;
                if (legacy) {
                    return new Promise((resolve, reject) => legacy.call(navigator, constraints, resolve, reject));
                }
                return Promise.reject(new Error('getUserMedia is not supported in this browser'));
            };

            localStream = await getUserMediaCompat({ video: true, audio: true });
        const player = document.getElementById('player');
        player.srcObject = localStream;
        // mute local preview to avoid echo
        player.muted = true;
        document.getElementById('status').textContent = 'Local stream started';
        // enable buttons
        document.getElementById('stopStreamBtn').disabled = false;
        document.getElementById('toggleCamBtn').disabled = false;
        document.getElementById('toggleMicBtn').disabled = false;
    }catch(e){
        console.error('getUserMedia failed', e);
        document.getElementById('status').textContent = 'Camera/mic access denied';
    }
}

function stopLocalStream(){
    if (!localStream) return;
    localStream.getTracks().forEach(t => t.stop());
    localStream = null;
    const player = document.getElementById('player');
    player.srcObject = null;
    document.getElementById('status').textContent = 'Local stream stopped';
    document.getElementById('stopStreamBtn').disabled = true;
    document.getElementById('toggleCamBtn').disabled = true;
    document.getElementById('toggleMicBtn').disabled = true;
}

function toggleCamera(){
    if (!localStream) return;
    const videoTrack = localStream.getVideoTracks()[0];
    if (!videoTrack) return;
    videoTrack.enabled = !videoTrack.enabled;
    document.getElementById('status').textContent = videoTrack.enabled ? 'Camera on' : 'Camera off';
}

function toggleMic(){
    if (!localStream) return;
    const audioTrack = localStream.getAudioTracks()[0];
    if (!audioTrack) return;
    audioTrack.enabled = !audioTrack.enabled;
    document.getElementById('status').textContent = audioTrack.enabled ? 'Mic on' : 'Mic off';
}

async function joinRoom(name){
    if (!client) { document.getElementById('status').textContent = 'Client not initialized'; return; }
    currentRoom = name;
    // also join the shim channel (keeps backward compatibility for local demo)
    channel = client.createChannel(name);
    if (channel.join) await channel.join();
    if (channel && typeof channel.on === 'function'){
        channel.on('MemberJoined', handleUserJoined);
        channel.on('MessageFromPeer', handleMessageFromPeer);
    }

    // Connect to signaling server
    if (!ws || ws.readyState !== WebSocket.OPEN){
        ws = new WebSocket(SIGNALING_URL);
        ws.onopen = ()=>{
            const role = document.getElementById('roleSelect').value || 'viewer';
            ws.send(JSON.stringify({ type: 'join', room: name, role }));
            document.getElementById('status').textContent = `Connected to signaling, joined ${name} as ${role}`;
            // If user is streamer, start local camera/mic automatically so viewers can be offered immediately
            if (role === 'streamer') startLocalStream();
            // enable leave button
            document.getElementById('leaveBtn').disabled = false;
            document.getElementById('joinBtn').disabled = true;
        };
        ws.onmessage = (ev)=>{
            try{ const msg = JSON.parse(ev.data); handleSignalingMessage(msg); }catch(e){}
        };
        ws.onclose = ()=>{ document.getElementById('status').textContent = 'Signaling disconnected'; };
    } else {
        // already open: send join message with role
        const role = document.getElementById('roleSelect').value || 'viewer';
        ws.send(JSON.stringify({ type: 'join', room: name, role }));
        document.getElementById('status').textContent = `Joined room ${name} (signaling)`;
        if (role === 'streamer') startLocalStream();
        document.getElementById('leaveBtn').disabled = false;
        document.getElementById('joinBtn').disabled = true;
    }
}

async function leaveRoom(){
    if (!channel && !ws) return;
    if (channel && channel.leave) try{ await channel.leave(); }catch(e){/* ignore */}
    channel = null;
    if (ws && ws.readyState === WebSocket.OPEN){
        ws.send(JSON.stringify({ type: 'leave', room: currentRoom }));
        ws.close();
    }
    currentRoom = null;
    // close all peer connections
    peerConnections.forEach(pc => { try{ pc.close(); }catch(e){} });
    peerConnections.clear();
    document.getElementById('status').textContent = 'Left room';
    document.getElementById('leaveBtn').disabled = true;
    document.getElementById('joinBtn').disabled = false;
}

function handleSignalingMessage(msg){
    const { type, viewerId, from, payload } = msg;
    // streamer gets viewer-joined
    if (type === 'viewer-joined'){
        console.log('Viewer joined', viewerId);
        // if this client is streamer, create offer for viewer
        if (document.getElementById('roleSelect').value === 'streamer'){
            createOffer(viewerId);
        }
        return;
    }

    if (type === 'offer'){
        // viewer receives offer
        const offer = payload.offer;
        const fromId = from;
        (async ()=>{
            // create pc for this streamer
            const pc = new RTCPeerConnection(servers);
            const remoteStreamLocal = new MediaStream();
            const player = document.getElementById('player');
            player.srcObject = remoteStreamLocal;
            player.muted = false; // viewers should hear audio
            pc.ontrack = (e)=>{ e.streams[0].getTracks().forEach(t => remoteStreamLocal.addTrack(t)); };
            pc.onicecandidate = (ev)=>{ if (ev.candidate && ws && ws.readyState===WebSocket.OPEN){ ws.send(JSON.stringify({ type:'candidate', room: currentRoom, to: fromId, payload:{ candidate: ev.candidate } })); } };
            await pc.setRemoteDescription(new RTCSessionDescription(offer));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            // store pc
            peerConnections.set(fromId, pc);
            // send answer back
            if (ws && ws.readyState===WebSocket.OPEN) ws.send(JSON.stringify({ type:'answer', room: currentRoom, to: fromId, payload:{ answer } }));
        })();
        return;
    }

    if (type === 'answer'){
        // streamer receives answer to previously-sent offer
        const fromId = from;
        const answer = payload.answer;
        const pc = peerConnections.get(fromId);
        if (pc){ pc.setRemoteDescription(new RTCSessionDescription(answer)).catch(e=>console.warn(e)); }
        return;
    }

    if (type === 'candidate'){
        const fromId = from;
        const cand = payload.candidate;
        const pc = peerConnections.get(fromId);
        if (pc){ pc.addIceCandidate(cand).catch(e=>console.warn('addIce failed',e)); }
        return;
    }
}

document.addEventListener('DOMContentLoaded', ()=>{
    document.getElementById('joinBtn').addEventListener('click', ()=>{
        const name = document.getElementById('roomName').value.trim() || 'main';
        joinRoom(name);
    });
    document.getElementById('leaveBtn').addEventListener('click', ()=>leaveRoom());
    document.getElementById('startStreamBtn').addEventListener('click', ()=>startLocalStream());
    document.getElementById('stopStreamBtn').addEventListener('click', ()=>stopLocalStream());
    document.getElementById('toggleCamBtn').addEventListener('click', ()=>toggleCamera());
    document.getElementById('toggleMicBtn').addEventListener('click', ()=>toggleMic());
});
