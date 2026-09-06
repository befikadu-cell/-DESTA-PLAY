export const PVP_GAME_RULES = {
  ludo:{maxPlayers:4,minPlayers:2}, highcard:{maxPlayers:2,minPlayers:2}, penalty:{maxPlayers:2,minPlayers:2}, dice:{maxPlayers:2,minPlayers:2}, target:{maxPlayers:4,minPlayers:2}, memory:{maxPlayers:2,minPlayers:2}, racing:{maxPlayers:4,minPlayers:2}, speedcards:{maxPlayers:2,minPlayers:2}, numberrush:{maxPlayers:4,minPlayers:2}
};

export class PVPManager {
  constructor(){ this.rooms=new Map(); }
  createRoom(game,entryFee){ const id=`${game}-${Date.now()}-${Math.random().toString(16).slice(2)}`; const rules=PVP_GAME_RULES[game]; if(!rules) throw new Error("Unsupported game"); const room={id,game,entryFee:Number(entryFee),...rules,status:"BETTING",players:new Map()}; this.rooms.set(id,room); return room; }
  addPlayer(room,player){ if(room.status!=="BETTING") throw new Error("Room closed"); if(room.players.size>=room.maxPlayers) throw new Error("Room full"); room.players.set(player.playerId,player); return room; }
}
export default PVPManager;
