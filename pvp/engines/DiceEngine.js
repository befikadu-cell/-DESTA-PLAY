import { shuffle, winnersByScore, validateCommonAction } from './_BaseEngine.js';
export const id='dice', name='Dice PVP', maxPlayers=2, minPlayers=2;
export function createState(room){return {roll:Number((shuffle(Array.from({length:1000},(_,i)=>i),room.roundId)[0]/10).toFixed(1))};}
export function validateAction(action){const a=validateCommonAction(action);const prediction=String(a.prediction||'').toUpperCase();const target=Number(a.target);if(!['OVER','UNDER'].includes(prediction)||!Number.isFinite(target)||target<=0||target>=100)throw new Error('Choose OVER or UNDER with a target between 0 and 100');return {type:'prediction',prediction,target:Number(target.toFixed(1))};}
export function resolve(state,players){const rows=players.map(p=>({playerId:String(p.playerId),prediction:p.actionData.prediction,target:p.actionData.target,score:(p.actionData.prediction==='OVER'?state.roll>p.actionData.target:state.roll<p.actionData.target)?1:0}));const best=Math.max(...rows.map(x=>x.score));return {roll:state.roll,scores:rows,winners:rows.filter(x=>x.score===best).map(x=>x.playerId)};}
export default {id,name,maxPlayers,minPlayers,createState,validateAction,resolve};
