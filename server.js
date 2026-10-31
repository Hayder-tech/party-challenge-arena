const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const rooms = new Map();
const publicDir = path.join(__dirname, 'public');
const colors = ['#54e6ff','#ff5b9d','#ffd166','#62e6a7','#bda1ff','#ff9f68','#8be28b','#f6a6ff'];
const games = ['reaction','memory','draw'];
const emojis = ['🍋','🚀','🎲','🌈','🐙','🔥','🍕','⚡'];

function id() { return crypto.randomBytes(8).toString('hex'); }
function code() { return crypto.randomBytes(3).toString('hex').toUpperCase(); }
function json(res, status, data) { res.writeHead(status, {'Content-Type':'application/json','Cache-Control':'no-store'}); res.end(JSON.stringify(data)); }
function readBody(req) { return new Promise((resolve,reject) => { let s=''; req.on('data',c=>s+=c); req.on('end',()=>{ try { resolve(JSON.parse(s||'{}')); } catch(e) { reject(e); } }); }); }
function cleanName(n) { return String(n || 'Player').trim().slice(0,16) || 'Player'; }
function makeChallenge(room) {
  const type = games[room.gameIndex % games.length];
  if (type === 'reaction') return {type, targetAt: Date.now() + 1100 + Math.floor(Math.random()*1300)};
  if (type === 'memory') return {type, sequence: Array.from({length: 3 + Math.floor(room.gameIndex/3)}, () => Math.floor(Math.random()*8))};
  return {type, target: Math.floor(Math.random()*8)};
}
function publicState(room, playerId) {
  const now = Date.now();
  return {
    room: room.code, hostId: room.hostId, phase: room.phase, gameIndex: room.gameIndex,
    turnIndex: room.turnIndex, challenge: room.challenge, currentPlayerId: room.players[room.turnIndex]?.id,
    you: playerId, players: room.players.map(p => ({id:p.id,name:p.name,score:p.score,color:p.color,online:now-p.lastSeen<12000}))
  };
}
function findRoom(body) { return rooms.get(String(body.room||'').toUpperCase()); }
function advance(room) {
  room.turnIndex++;
  if (room.turnIndex >= room.players.length) { room.turnIndex=0; room.gameIndex++; }
  if (room.gameIndex >= 10) { room.phase='finished'; room.challenge=null; }
  else room.challenge = makeChallenge(room);
}

async function api(req,res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    const body = req.method === 'POST' ? await readBody(req) : {};
    if (req.method==='POST' && url.pathname==='/api/create') {
      let roomCode; do { roomCode=code(); } while (rooms.has(roomCode));
      const pid=id(); const room={code:roomCode,hostId:pid,phase:'lobby',gameIndex:0,turnIndex:0,challenge:null,players:[{id:pid,name:cleanName(body.name),score:0,color:colors[0],lastSeen:Date.now()}]};
      rooms.set(roomCode,room); return json(res,200,{room:roomCode,playerId:pid,state:publicState(room,pid)});
    }
    if (req.method==='POST' && url.pathname==='/api/join') {
      const room=findRoom(body); if(!room) return json(res,404,{error:'Room not found'});
      if(room.phase!=='lobby') return json(res,409,{error:'That match has already started'});
      if(room.players.length>=8) return json(res,409,{error:'Room is full'});
      const pid=id(); room.players.push({id:pid,name:cleanName(body.name),score:0,color:colors[room.players.length],lastSeen:Date.now()});
      return json(res,200,{room:room.code,playerId:pid,state:publicState(room,pid)});
    }
    if (req.method==='GET' && url.pathname==='/api/state') {
      const room=rooms.get((url.searchParams.get('room')||'').toUpperCase()); const pid=url.searchParams.get('playerId');
      if(!room || !room.players.some(p=>p.id===pid)) return json(res,404,{error:'Room or player not found'});
      room.players.find(p=>p.id===pid).lastSeen=Date.now(); return json(res,200,publicState(room,pid));
    }
    if (req.method==='POST' && url.pathname==='/api/start') {
      const room=findRoom(body); if(!room) return json(res,404,{error:'Room not found'});
      if(body.playerId!==room.hostId) return json(res,403,{error:'Only the host can start'});
      if(room.players.length<2) return json(res,409,{error:'At least two players are required'});
      room.phase='playing'; room.gameIndex=0; room.turnIndex=0; room.challenge=makeChallenge(room); return json(res,200,publicState(room,body.playerId));
    }
    if (req.method==='POST' && url.pathname==='/api/action') {
      const room=findRoom(body); if(!room) return json(res,404,{error:'Room not found'});
      const p=room.players[room.turnIndex]; if(room.phase!=='playing' || !p || p.id!==body.playerId) return json(res,409,{error:'It is not your turn'});
      const action=body.action||{}; let points=0; const type=room.challenge.type;
      if(type==='reaction') { const ms=Math.max(1,Number(action.elapsed)||9999); points=ms<500?100:ms<800?75:50; }
      if(type==='memory') { const correct=JSON.stringify(action.sequence)===JSON.stringify(room.challenge.sequence); points=correct?75+room.challenge.sequence.length*5:25; }
      if(type==='draw') points=Number(action.choice)===room.challenge.target?100:0;
      p.score+=points; p.lastSeen=Date.now(); advance(room);
      return json(res,200,{points,state:publicState(room,body.playerId)});
    }
    json(res,404,{error:'Not found'});
  } catch(e) { json(res,400,{error:'Invalid request'}); }
}

const server=http.createServer((req,res)=>{
  if(req.url.startsWith('/api/')) return api(req,res);
  let file=req.url==='/'?'/index.html':req.url;
  file=path.normalize(file).replace(/^\.\.[\\/]/,''); const target=path.join(publicDir,file);
  fs.readFile(target,(err,data)=>{ if(err) return json(res,404,{error:'Not found'}); const ext=path.extname(target); const types={'.html':'text/html','.js':'text/javascript','.css':'text/css'}; res.writeHead(200,{'Content-Type':types[ext]||'text/plain'}); res.end(data); });
});
server.listen(PORT,()=>console.log(`Party Challenge Arena running at http://localhost:${PORT}`));
