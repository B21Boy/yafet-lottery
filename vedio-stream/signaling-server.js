// Simple WebSocket signaling server for one-streamer -> many-viewers
// Usage: npm install ws && node signaling-server.js

const WebSocket = require('ws');
const PORT = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port: PORT });

// rooms: { roomName: { streamerId: clientId, clients: Map(clientId->ws) } }
const rooms = new Map();

function send(ws, msg){
  try { ws.send(JSON.stringify(msg)); } catch(e){ }
}

wss.on('connection', function connection(ws){
  ws.id = Math.random().toString(36).slice(2,9);
  ws.room = null;
  ws.role = null;
  console.log('Client connected', ws.id);

  ws.on('message', function incoming(message){
    let msg;
    try{ msg = JSON.parse(message); }catch(e){ return; }
    const { type, room, role, to, payload, from } = msg;

    if (type === 'join'){
      ws.room = room;
      ws.role = role || 'viewer';
      if(!rooms.has(room)) rooms.set(room, { streamerId: null, clients: new Map() });
      const state = rooms.get(room);
      state.clients.set(ws.id, ws);
      // if streamer joined, mark streamerId
      if (ws.role === 'streamer'){
        state.streamerId = ws.id;
        console.log(`Streamer ${ws.id} joined room ${room}`);
      } else {
        console.log(`Viewer ${ws.id} joined room ${room}`);
        // notify streamer that a viewer joined
        if (state.streamerId && state.clients.has(state.streamerId)){
          const streamerWs = state.clients.get(state.streamerId);
          send(streamerWs, { type: 'viewer-joined', room, viewerId: ws.id });
        }
      }
      // ack
      send(ws, { type: 'joined', room, id: ws.id, streamerId: state.streamerId || null });
      return;
    }

    // Forward signaling messages
    if (type === 'offer' || type === 'answer' || type === 'candidate'){
      if (!room || !to) return;
      const state = rooms.get(room);
      if (!state) return;
      const target = state.clients.get(to);
      if (target){
        send(target, { type, room, from: ws.id, payload });
      }
      return;
    }

    if (type === 'leave'){
      const state = rooms.get(ws.room);
      if (state){
        state.clients.delete(ws.id);
        if (state.streamerId === ws.id) state.streamerId = null;
      }
      ws.room = null;
      ws.role = null;
      return;
    }
  });

  ws.on('close', function(){
    console.log('Client disconnected', ws.id);
    if (ws.room){
      const state = rooms.get(ws.room);
      if (state){
        state.clients.delete(ws.id);
        if (state.streamerId === ws.id) state.streamerId = null;
      }
    }
  });
});

console.log('Signaling server running on ws://localhost:' + PORT);
