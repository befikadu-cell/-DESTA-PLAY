export class PoolEngine {
  constructor(houseRakePercent = 10) {
    if (!Number.isFinite(Number(houseRakePercent)) || houseRakePercent < 0 || houseRakePercent >= 100) throw new Error("Invalid house rake");
    this.houseRakePercent = Number(houseRakePercent);
  }
  calculatePool(entryFee, playerCount) {
    const fee = Number(entryFee); const count = Number(playerCount);
    if (!Number.isFinite(fee) || fee <= 0 || !Number.isInteger(count) || count <= 0) throw new Error("Invalid pool inputs");
    const totalPool = Number((fee * count).toFixed(2));
    const houseFee = Number((totalPool * this.houseRakePercent / 100).toFixed(2));
    const prizePool = Number((totalPool - houseFee).toFixed(2));
    return { totalPool, houseFee, prizePool };
  }
  splitEqually(prizePool, winnerCount) {
    const pool = Number(prizePool); const count = Number(winnerCount);
    if (!Number.isFinite(pool) || pool < 0 || !Number.isInteger(count) || count < 1) return { share:0, remainder:Number(pool.toFixed(2)) };
    const share = Number((Math.floor((pool / count) * 100) / 100).toFixed(2));
    const remainder = Number((pool - share * count).toFixed(2));
    return { share, remainder };
  }
}
export default PoolEngine;
