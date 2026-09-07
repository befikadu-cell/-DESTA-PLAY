import { shuffle, winnersByScore, validateCommonAction } from './_BaseEngine.js';
export const id='numberdraw', name='Number Draw / Lottery Race PVP', maxPlayers=8, minPlayers=2;
export function createState(room){return {target:shuffle(Array.from({length:100},(_,i)=>i+1),room.roundId)[0]};}
export function validateAction(action){const a=validateCommonAction(action);const n=Number(a.number);if(!Number.isInteger(n)||n<1||n>100)throw new Error('Choose a whole number from 1 to 100');return {type:'number',number:n};}
export function resolve(state,players){const rows=players.map(p=>({playerId:String(p.playerId),number:Number(p.actionData.number),distance:Math.abs(Number(p.actionData.number)-state.target)}));const best=Math.min(...rows.map(x=>x.distance));const scores=rows.map(x=>({...x,score:best===x.distance?100:Math.max(0,100-x.distance)}));return {target:state.target,scores,winners:scores.filter(x=>x.distance===best).map(x=>x.playerId)};}
export default {id,name,maxPlayers,minPlayers,createState,validateAction,resolve};
