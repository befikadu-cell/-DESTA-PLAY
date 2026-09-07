import { winnersByScore, validateCommonAction, seedFrom, mulberry32 } from './_BaseEngine.js';
export const id='ludo', name='Ludo PVP', maxPlayers=4, minPlayers=2;
export function createState(room){return {seed:seedFrom(room.roundId),goal:50};}
export function validateAction(action){const a=validateCommonAction(action);if(a.type==='roll')return {type:'roll'};if(a.type==='move'){const steps=Number(a.steps);if(!Number.isInteger(steps)||steps<1||steps>6)throw new Error('Ludo move must use a dice value from 1 to 6');return {type:'move',steps};}throw new Error('Unsupported Ludo action');}
export function resolve(state,players){const r=mulberry32(state.seed);const rows=players.map(p=>{let pos=0;for(let i=0;i<12;i++)pos+=1+Math.floor(r()*6);return {playerId:String(p.playerId),score:pos};});return {goal:state.goal,scores:rows,winners:winnersByScore(rows)};}
export default {id,name,maxPlayers,minPlayers,createState,validateAction,resolve};
