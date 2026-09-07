import { winnersByScore, validateCommonAction, seedFrom, mulberry32 } from './_BaseEngine.js';
export const id='penalty', name='Penalty PVP', maxPlayers=2, minPlayers=2;
export function createState(room){return {seed:seedFrom(room.roundId),rounds:5};}
export function validateAction(action){const a=validateCommonAction(action);const choice=String(a.choice||'').toLowerCase();if(!['left','center','right'].includes(choice))throw new Error('Choose left, center, or right');return {type:'shot',choice};}
export function resolve(state,players){const r=mulberry32(state.seed);const rows=players.map(p=>({playerId:String(p.playerId),score:0}));for(let i=0;i<state.rounds;i++){const keeper=Math.floor(r()*3);rows.forEach((x,j)=>{if(['left','center','right'].indexOf(players[j].actionData?.choice)!==keeper)x.score++;});}return {rounds:state.rounds,scores:rows,winners:winnersByScore(rows)};}
export default {id,name,maxPlayers,minPlayers,createState,validateAction,resolve};
