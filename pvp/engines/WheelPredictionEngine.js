import { shuffle, winnersByScore, validateCommonAction } from './_BaseEngine.js';
export const id='wheel', name='Multiplayer Wheel / Prediction PVP', maxPlayers=8, minPlayers=2;
export function createState(room){return {result:shuffle(Array.from({length:10},(_,i)=>i+1),room.roundId)[0]};}
export function validateAction(action){const a=validateCommonAction(action);const n=Number(a.prediction);if(!Number.isInteger(n)||n<1||n>10)throw new Error('Predict a wheel number from 1 to 10');return {type:'prediction',prediction:n};}
export function resolve(state,players){const scores=players.map(p=>({playerId:String(p.playerId),prediction:Number(p.actionData.prediction),score:Number(p.actionData.prediction)===state.result?100:0}));return {result:state.result,scores,winners:scores.filter(x=>x.score===100).map(x=>x.playerId)};}
export default {id,name,maxPlayers,minPlayers,createState,validateAction,resolve};
