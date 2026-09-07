export const PVP_ENTRY_FEES = [10,20,30,40,50,80,100,150,200,250,300,350,400,450,500,550,600,650,700,750,800,850,900,950,1000];
export const PVP_GAME_RULES = {
  bingo:{maxPlayers:8,minPlayers:2}, keno:{maxPlayers:8,minPlayers:2}, tambola:{maxPlayers:8,minPlayers:2}, bingo90:{maxPlayers:8,minPlayers:2}, bingo75:{maxPlayers:8,minPlayers:2}, numberdraw:{maxPlayers:8,minPlayers:2}, trivia:{maxPlayers:8,minPlayers:2}, wheel:{maxPlayers:8,minPlayers:2}, ludo:{maxPlayers:4,minPlayers:2}, highcard:{maxPlayers:2,minPlayers:2}, penalty:{maxPlayers:2,minPlayers:2}, dice:{maxPlayers:2,minPlayers:2}, target:{maxPlayers:4,minPlayers:2}, memory:{maxPlayers:2,minPlayers:2}, racing:{maxPlayers:4,minPlayers:2}, speedcards:{maxPlayers:2,minPlayers:2}, numberrush:{maxPlayers:4,minPlayers:2}
};
export class PVPManager {
  constructor(){ this.rooms=new Map(); }
  createRoom(game,entryFee){ const fee=Number(entryFee); const id=`${game}-${fee}-${Date.now()}-${Math.random().toString(16).slice(2)}`; const rules=PVP_GAME_RULES[game]; if(!rules) throw new Error("Unsupported game"); if(!PVP_ENTRY_FEES.includes(fee)) throw new Error("Invalid entry fee"); const room={id,game,entryFee:fee,...rules,status:"BETTING",players:new Map()}; this.rooms.set(id,room); return room; }
  addPlayer(room,player){ if(room.status!=="BETTING") throw new Error("Room closed"); if(room.players.size>=room.maxPlayers) throw new Error("Room full"); room.players.set(String(player.playerId),player); return room; }
}
export default PVPManager;
