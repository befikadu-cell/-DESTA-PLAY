import { shuffle, winnersByScore, validateCommonAction } from './_BaseEngine.js';
export const id='numberrush', name='Number Rush PVP', maxPlayers=4, minPlayers=2;
export function createState(room){return {numbers:shuffle(Array.from({length:50},(_,i)=>i+1),room.roundId).slice(0,10)};}
export function validateAction(action){const a=validateCommonAction(action);const n=Number(a.score);if(!Number.isInteger(n)||n<0||n>10)throw new Error('Number Rush score must be 0 to 10');return {type:'rush',score:n};}
export function resolve(state,players){const rows=players.map(p=>({playerId:String(p.playerId),score:Number(p.actionData.score)}));return {numbers:state.numbers,scores:rows,winners:winnersByScore(rows)};}
export default {id,name,maxPlayers,minPlayers,createState,validateAction,resolve};
