import { shuffle, seedFrom, winnersByScore, validateCommonAction } from './_BaseEngine.js';
export const id='trivia', name='Trivia / Quiz PVP', maxPlayers=8, minPlayers=2;
const Q=[['Which planet is known as the Red Planet?',['Earth','Mars','Venus','Jupiter'],1],['How many continents are there?',['5','6','7','8'],2],['What is 2 + 2?',['3','4','5','6'],1],['Which ocean is largest?',['Atlantic','Indian','Pacific','Arctic'],2],['What gas do humans breathe in?',['Oxygen','Helium','Carbon dioxide','Hydrogen'],0]];
export function createState(room){return {questions:shuffle(Q,room.roundId).slice(0,5)};}
export function validateAction(action){const a=validateCommonAction(action);const answer=Number(a.answer);if(!Number.isInteger(answer)||answer<0||answer>3)throw new Error('Choose an answer from 1 to 4');return {type:'answer',answer};}
export function resolve(state,players){const scores=players.map(p=>{const ans=p.actionData?.answer;const correct=state.questions.reduce((n,q)=>n+(ans===q[2]?1:0),0);return {playerId:String(p.playerId),score:correct};});return {questions:state.questions.map(q=>({question:q[0],options:q[1],correct:q[2]})),scores,winners:winnersByScore(scores)};}
export default {id,name,maxPlayers,minPlayers,createState,validateAction,resolve};
