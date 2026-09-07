import { winnersByScore, validateCommonAction, seedFrom, mulberry32 } from './_BaseEngine.js';
export const id='racing', name='Mini Racing PVP', maxPlayers=4, minPlayers=2;
export function createState(room){return {seed:seedFrom(room.roundId),distance:100};}
export function validateAction(action){const a=validateCommonAction(action);const boost=Number(a.boost);if(!Number.isInteger(boost)||boost<0||boost>10)throw new Error('Boost must be 0 to 10');return {type:'race',boost};}
export function resolve(state,players){const r=mulberry32(state.seed);const rows=players.map(p=>({playerId:String(p.playerId),score:Math.floor(r()*90)+Number(p.actionData.boost||0)}));return {distance:state.distance,scores:rows,winners:winnersByScore(rows)};}
export default {id,name,maxPlayers,minPlayers,createState,validateAction,resolve};
