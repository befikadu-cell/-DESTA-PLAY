import { shuffle, winnersByScore, validateCommonAction } from './_BaseEngine.js';
export const id='keno', name='Keno PVP', maxPlayers=8, minPlayers=2;
export function createState(room){ return {draw:shuffle(Array.from({length:80},(_,i)=>i+1),room.roundId).slice(0,20)}; }
export function validateAction(action){ const a=validateCommonAction(action); if(a.type==='pick'){if(!Array.isArray(a.numbers)||a.numbers.length<5||a.numbers.length>10) throw new Error('Pick 5 to 10 Keno numbers'); const nums=[...new Set(a.numbers.map(Number))]; if(nums.length!==a.numbers.length||nums.some(n=>!Number.isInteger(n)||n<1||n>80)) throw new Error('Keno numbers must be unique integers from 1 to 80'); return {type:'pick',numbers:nums};} if(a.type==='ready') return {type:'ready'}; throw new Error('Unsupported Keno action'); }
export function resolve(state,players){ const scores=players.map(p=>{const picks=p.actionData?.numbers||[];const hits=picks.filter(n=>state.draw.includes(n)).length;return {playerId:String(p.playerId),hits,score:hits};});return {draw:state.draw,scores,winners:winnersByScore(scores),drawCount:20}; }
export default {id,name,maxPlayers,minPlayers,createState,validateAction,resolve};
