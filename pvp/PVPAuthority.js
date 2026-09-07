import crypto from 'crypto';

const CHOICES = ['left','center','right'];

function hashInt(seed, label, max) {
  const h = crypto.createHmac('sha256', String(seed)).update(String(label)).digest();
  return h.readUInt32BE(0) % max;
}

function hashFloat(seed, label) {
  const h = crypto.createHmac('sha256', String(seed)).update(String(label)).digest();
  return h.readUInt32BE(0) / 0x100000000;
}

function playerIds(room) { return [...room.players.keys()].map(String); }

export function createAuthorityState(room, engineState = {}) {
  const game = String(room.game);
  const ids = playerIds(room);
  const state = {
    version: 2,
    game,
    serverSeed: crypto.randomBytes(32).toString('hex'),
    phase: 'WAITING',
    turnIndex: 0,
    currentPlayerId: null,
    roundsCompleted: 0,
    history: [],
    scores: Object.fromEntries(ids.map(id => [id, 0])),
    engineState,
    gameState: {}
  };

  if (game === 'penalty') {
    state.phase = 'SHOOT';
    state.roundsTotal = 6;
    state.shooterIndex = 0;
    state.keeperIndex = 1;
    state.currentPlayerId = ids[0] || null;
    state.gameState = { round: 1, shooterId: ids[0] || null, keeperId: ids[1] || null, shots: [] };
  } else if (game === 'ludo') {
    state.phase = 'ROLL';
    state.currentPlayerId = ids[0] || null;
    state.gameState = {
      trackLength: 52,
      goal: 52,
      dice: null,
      pendingMove: false,
      tokens: Object.fromEntries(ids.map(id => [id, [-1,-1,-1,-1]])),
      playerStarts: Object.fromEntries(ids.map((id,i) => [id, i * Math.floor(52 / Math.max(1, ids.length))]))
    };
  } else if (game === 'memory') {
    const cards = Array.from({length:8},(_,i)=>i).flatMap(v=>[v,v]);
    for (let i=cards.length-1;i>0;i--) { const j=hashInt(state.serverSeed, `memory-shuffle:${i}`, i+1); [cards[i],cards[j]]=[cards[j],cards[i]]; }
    state.phase = 'TURN';
    state.currentPlayerId = ids[0] || null;
    state.gameState = { cards, revealed: [], matched: [], attempts: Object.fromEntries(ids.map(id=>[id,0])) };
  } else if (game === 'racing') {
    state.phase = 'TURN'; state.currentPlayerId = ids[0] || null;
    state.turnsTotal = 10;
    state.gameState = { positions:Object.fromEntries(ids.map(id=>[id,0])), turnBoosts:[] };
  } else if (game === 'speedcards') {
    state.phase = 'TURN'; state.currentPlayerId = ids[0] || null;
    state.turnsTotal = 10;
    state.gameState = { target: hashInt(state.serverSeed,'speed-target-0',10)+1, responses:Object.fromEntries(ids.map(id=>[id,0])) };
  } else if (game === 'numberrush') {
    state.phase = 'TURN'; state.currentPlayerId = ids[0] || null;
    state.turnsTotal = 10;
    state.gameState = { target: hashInt(state.serverSeed,'rush-target-0',10)+1, correct:Object.fromEntries(ids.map(id=>[id,0])) };
  } else if (game === 'trivia') {
    state.phase = 'TURN'; state.currentPlayerId = ids[0] || null;
    state.turnsTotal = 5;
    state.gameState = { questionIndex:0, questions:engineState.questions || [], answered:{} };
  } else {
    state.phase = 'ACTION';
  }
  return state;
}

export function publicAuthorityState(room, viewerId) {
  const s = room.state?.authority || {};
  const g = room.game;
  const base = {
    phase: s.phase,
    turnIndex: s.turnIndex,
    currentPlayerId: s.currentPlayerId,
    yourTurn: String(s.currentPlayerId || '') === String(viewerId || ''),
    roundsCompleted: s.roundsCompleted || 0,
    historyCount: Array.isArray(s.history) ? s.history.length : 0
  };
  if (g === 'penalty') return {...base, round:s.gameState?.round, shooterId:s.gameState?.shooterId, keeperId:s.gameState?.keeperId};
  if (g === 'ludo') return {...base, dice:s.gameState?.dice, tokens:s.gameState?.tokens, goal:s.gameState?.goal, pendingMove:s.gameState?.pendingMove};
  if (g === 'memory') return {...base, cardsCount:s.gameState?.cards?.length || 16, revealed:s.gameState?.revealed || [], matched:s.gameState?.matched || []};
  if (g === 'racing') return {...base, positions:s.gameState?.positions || {}, turnsTotal:s.turnsTotal};
  if (g === 'speedcards') return {...base, target:s.gameState?.target || null, turnsTotal:s.turnsTotal};
  if (g === 'numberrush') return {...base, target:s.gameState?.target || null, turnsTotal:s.turnsTotal};
  if (g === 'trivia') {
    const q=s.gameState?.questions?.[s.gameState?.questionIndex || 0];
    return {...base, questionIndex:s.gameState?.questionIndex || 0, question:q ? {question:q[0],options:q[1]} : null};
  }
  return base;
}

function requireTurn(room, playerId) {
  const s=room.state.authority;
  if (s.currentPlayerId && String(s.currentPlayerId)!==String(playerId)) throw new Error('Wait for your server-assigned turn');
}

function nextTurn(room) {
  const ids=playerIds(room); const s=room.state.authority;
  if (!ids.length) { s.currentPlayerId=null; return; }
  s.turnIndex += 1;
  s.currentPlayerId = ids[s.turnIndex % ids.length];
}

function finish(room, winners) {
  const s=room.state.authority; s.phase='FINISHED'; s.currentPlayerId=null; s.winners=[...new Set(winners.map(String))];
  return {winners:s.winners, scores:s.scores, history:s.history};
}

export function applyAction(room, playerId, rawAction) {
  const game=String(room.game); const s=room.state.authority; const ids=playerIds(room); const a=rawAction && typeof rawAction==='object' ? rawAction : {};
  if (!s) throw new Error('Authoritative state unavailable');
  const pid=String(playerId);
  if (!ids.includes(pid)) throw new Error('Player is not in this room');
  if (s.phase==='FINISHED') throw new Error('Round already finished');

  // Server-authoritative random games: the player supplies only a prediction/selection.
  if (game==='penalty') {
    requireTurn(room,pid);
    const choice=String(a.choice||'').toLowerCase(); if(!CHOICES.includes(choice)) throw new Error('Choose left, center, or right');
    const gs=s.gameState;
    if(s.phase==='SHOOT') {
      const keeperChoice=CHOICES[hashInt(s.serverSeed,`penalty:keeper:${gs.round}`,3)];
      const goal=choice!==keeperChoice;
      if(goal) s.scores[pid]=(s.scores[pid]||0)+1;
      gs.shots.push({round:gs.round,role:'SHOOTER',playerId:pid,choice,goal});
      s.history.push({turn:s.turnIndex,playerId:pid,role:'SHOOTER',choice,goal});
      s.phase='KEEP'; s.currentPlayerId=String(gs.keeperId);
    } else {
      // Keeper gets an equal opportunity: the server creates a shot direction.
      const shotChoice=CHOICES[hashInt(s.serverSeed,`penalty:shot:${gs.round}`,3)];
      const saved=choice===shotChoice;
      gs.shots.push({round:gs.round,role:'KEEPER',playerId:pid,choice,shotChoice,saved});
      s.history.push({turn:s.turnIndex,playerId:pid,role:'KEEPER',choice,shotChoice,saved});
      gs.round += 1; s.roundsCompleted += 1;
      if(gs.round>s.roundsTotal) return finish(room, Object.entries(s.scores).filter(([,v])=>v===Math.max(...Object.values(s.scores))).map(([id])=>id));
      gs.shooterId=ids[gs.roundsCompleted % ids.length];
      gs.keeperId=ids[(gs.roundsCompleted+1) % ids.length];
      s.phase='SHOOT'; s.currentPlayerId=String(gs.shooterId);
    }
    return {finished:false,authority:publicAuthorityState(room,pid)};
  }

  if(game==='ludo') {
    requireTurn(room,pid); const gs=s.gameState;
    if(s.phase==='ROLL') {
      const dice=hashInt(s.serverSeed,`ludo:dice:${s.turnIndex}`,6)+1;
      gs.dice=dice; gs.pendingMove=true; s.phase='MOVE';
      s.history.push({turn:s.turnIndex,playerId:pid,role:'ROLL',dice});
      return {finished:false,authority:publicAuthorityState(room,pid)};
    }
    if(s.phase==='MOVE') {
      const token=Number(a.token); if(!Number.isInteger(token)||token<0||token>3) throw new Error('Choose token 1 to 4');
      const dice=Number(gs.dice); const tokens=gs.tokens[pid]; const start=Number(gs.playerStarts[pid]||0);
      if(!Array.isArray(tokens)) throw new Error('Player board unavailable');
      let pos=Number(tokens[token]);
      if(pos<0){ if(dice!==6) throw new Error('A token can enter only when the server dice is 6'); pos=0; }
      else pos += dice;
      if(pos>gs.goal) throw new Error('That move exceeds the finish');
      tokens[token]=pos;
      s.scores[pid]=tokens.reduce((n,v)=>n+(v===gs.goal?1:0),0);
      s.history.push({turn:s.turnIndex,playerId:pid,role:'MOVE',token,dice,newPosition:pos});
      gs.pendingMove=false; gs.dice=null;
      const won=tokens.every(v=>v===gs.goal);
      if(won) return finish(room,[pid]);
      // Six grants another roll, otherwise next player.
      if(dice===6){s.phase='ROLL';}
      else {nextTurn(room);s.phase='ROLL';}
      return {finished:false,authority:publicAuthorityState(room,pid)};
    }
  }

  if(game==='memory') {
    requireTurn(room,pid); const gs=s.gameState; const idx=Number(a.index);
    if(!Number.isInteger(idx)||idx<0||idx>=gs.cards.length) throw new Error('Choose a valid card');
    if(gs.matched.includes(idx)||gs.revealed.includes(idx)) throw new Error('That card is unavailable');
    gs.revealed.push(idx); s.history.push({turn:s.turnIndex,playerId:pid,role:'FLIP',index:idx});
    if(gs.revealed.length===2){
      const [x,y]=gs.revealed; const match=gs.cards[x]===gs.cards[y];
      if(match){gs.matched.push(x,y);s.scores[pid]=(s.scores[pid]||0)+1;gs.revealed=[];}
      else {const result={first:x,second:y,match:false};gs.revealed=[];nextTurn(room);return {finished:false,authority:publicAuthorityState(room,pid),pair:result};}
      if(gs.matched.length===gs.cards.length){const best=Math.max(...Object.values(s.scores));return finish(room,Object.entries(s.scores).filter(([,v])=>v===best).map(([id])=>id));}
    }
    return {finished:false,authority:publicAuthorityState(room,pid)};
  }

  if(game==='racing') {
    requireTurn(room,pid); const boost=Number(a.boost); if(!Number.isInteger(boost)||boost<0||boost>10) throw new Error('Boost must be 0 to 10');
    const gain=1+boost+hashInt(s.serverSeed,`race:${s.turnIndex}:${pid}`,4); s.gameState.positions[pid]+=gain; s.gameState.turnBoosts.push({playerId:pid,boost,gain}); s.history.push({turn:s.turnIndex,playerId:pid,boost,gain});
    s.scores[pid]=s.gameState.positions[pid]; s.roundsCompleted+=1;
    if(s.gameState.positions[pid]>=100) return finish(room,[pid]);
    if(s.roundsCompleted>=s.turnsTotal*ids.length){const best=Math.max(...Object.values(s.scores));return finish(room,Object.entries(s.scores).filter(([,v])=>v===best).map(([id])=>id));}
    nextTurn(room); return {finished:false,authority:publicAuthorityState(room,pid)};
  }

  if(game==='speedcards') {
    requireTurn(room,pid); const n=Number(a.answer); if(!Number.isInteger(n)||n<1||n>10) throw new Error('Choose 1 to 10');
    const target=Number(s.gameState.target); if(n===target)s.scores[pid]=(s.scores[pid]||0)+1;
    s.history.push({turn:s.turnIndex,playerId:pid,target,answer:n,correct:n===target}); s.roundsCompleted+=1;
    if(s.roundsCompleted>=s.turnsTotal*ids.length){const best=Math.max(...Object.values(s.scores));return finish(room,Object.entries(s.scores).filter(([,v])=>v===best).map(([id])=>id));}
    s.gameState.target=hashInt(s.serverSeed,`speed-target:${s.roundsCompleted}`,10)+1; nextTurn(room); return {finished:false,authority:publicAuthorityState(room,pid)};
  }

  if(game==='numberrush') {
    requireTurn(room,pid); const n=Number(a.answer); if(!Number.isInteger(n)||n<1||n>10) throw new Error('Choose 1 to 10');
    const target=Number(s.gameState.target); if(n===target)s.scores[pid]=(s.scores[pid]||0)+1;
    s.history.push({turn:s.turnIndex,playerId:pid,target,answer:n,correct:n===target}); s.roundsCompleted+=1;
    if(s.roundsCompleted>=s.turnsTotal*ids.length){const best=Math.max(...Object.values(s.scores));return finish(room,Object.entries(s.scores).filter(([,v])=>v===best).map(([id])=>id));}
    s.gameState.target=hashInt(s.serverSeed,`rush-target:${s.roundsCompleted}`,10)+1; nextTurn(room); return {finished:false,authority:publicAuthorityState(room,pid)};
  }

  if(game==='trivia') {
    requireTurn(room,pid); const q=s.gameState.questions?.[s.gameState.questionIndex]; if(!q) return finish(room,[]);
    const ans=Number(a.answer); if(!Number.isInteger(ans)||ans<0||ans>3) throw new Error('Choose an answer from 1 to 4');
    const correct=ans===q[2]; if(correct)s.scores[pid]=(s.scores[pid]||0)+1;
    s.history.push({turn:s.turnIndex,playerId:pid,questionIndex:s.gameState.questionIndex,answer:ans,correct});
    s.roundsCompleted+=1; s.gameState.answered[pid]=ans;
    if(s.roundsCompleted>=s.turnsTotal*ids.length){const best=Math.max(...Object.values(s.scores));return finish(room,Object.entries(s.scores).filter(([,v])=>v===best).map(([id])=>id));}
    s.gameState.questionIndex=Math.floor(s.roundsCompleted/ids.length); nextTurn(room); return {finished:false,authority:publicAuthorityState(room,pid)};
  }

  // One-shot games: the server controls the hidden outcome. Client can only submit a legal prediction/selection.
  if(['bingo','bingo75','tambola','bingo90'].includes(game)) {
    if(a.type==='card'||a.type==='ticket'||a.type==='claim') return {engineAction:true};
  }
  return {engineAction:true};
}

export default {createAuthorityState,publicAuthorityState,applyAction};
