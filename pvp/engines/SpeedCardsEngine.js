import { shuffle, winnersByScore, validateCommonAction } from './_BaseEngine.js';
export const id='speedcards', name='Speed Cards PVP', maxPlayers=2, minPlayers=2;
export function createState(room){return {sequence:shuffle(Array.from({length:20},(_,i)=>i+1),room.roundId).slice(0,10)};}
export function validateAction(action){const a=validateCommonAction(action);const speed=Number(a.speed);if(!Number.isInteger(speed)||speed<1||speed>10)throw new Error('Speed score must be 1 to 10');return {type:'speed',speed};}
export function resolve(state,players){const rows=players.map(p=>({playerId:String(p.playerId),score:Number(p.actionData.speed)}));return {sequence:state.sequence,scores:rows,winners:winnersByScore(rows)};}
export default {id,name,maxPlayers,minPlayers,createState,validateAction,resolve};
