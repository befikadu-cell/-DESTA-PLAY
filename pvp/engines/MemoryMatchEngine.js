import { shuffle, winnersByScore, validateCommonAction } from './_BaseEngine.js';
export const id='memory', name='Memory Match PVP', maxPlayers=2, minPlayers=2;
export function createState(room){const pairs=shuffle(Array.from({length:8},(_,i)=>i+1),room.roundId);return {cards:shuffle([...pairs,...pairs],room.roundId+':cards')};}
export function validateAction(action){const a=validateCommonAction(action);if(a.type!=='memory')throw new Error('Submit your memory result');const score=Number(a.matches);if(!Number.isInteger(score)||score<0||score>8)throw new Error('Matches must be between 0 and 8');return {type:'memory',matches:score};}
export function resolve(state,players){const rows=players.map(p=>({playerId:String(p.playerId),score:Number(p.actionData.matches)}));return {cards:state.cards,scores:rows,winners:winnersByScore(rows)};}
export default {id,name,maxPlayers,minPlayers,createState,validateAction,resolve};
