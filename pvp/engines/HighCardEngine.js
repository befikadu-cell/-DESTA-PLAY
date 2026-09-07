import { shuffle, winnersByScore, validateCommonAction } from './_BaseEngine.js';
export const id='highcard', name='High Card PVP', maxPlayers=2, minPlayers=2;
export function createState(room){return {deck:shuffle(Array.from({length:13},(_,i)=>i+2),room.roundId).slice(0,2)};}
export function validateAction(action){const a=validateCommonAction(action);if(a.type!=='draw')throw new Error('Draw a card to play');return {type:'draw'};}
export function resolve(state,players){const cards=players.map((p,i)=>({playerId:String(p.playerId),value:state.deck[i],suit:['H','D','C','S'][i%4],score:state.deck[i]}));return {cards,winners:winnersByScore(cards)};}
export default {id,name,maxPlayers,minPlayers,createState,validateAction,resolve};
