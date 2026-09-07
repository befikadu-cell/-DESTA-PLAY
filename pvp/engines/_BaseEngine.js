export const PVP_ENTRY_FEES = [10,20,30,40,50,80,100,150,200,250,300,350,400,450,500,550,600,650,700,750,800,850,900,950,1000];

export function normalizePlayers(players) {
  return (Array.isArray(players) ? players : [...(players || [])]).map((p, i) => ({
    playerId: String(p.playerId),
    index: i,
    action: p.actionData ?? p.action ?? null
  }));
}

export function assertFee(fee) {
  const n = Number(fee);
  if (!PVP_ENTRY_FEES.includes(n)) throw new Error('Invalid PVP entry fee');
  return n;
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seedFrom(value) {
  const s = String(value ?? '');
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function shuffle(values, seed) {
  const out = [...values]; const rnd = mulberry32(seedFrom(seed));
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}

export function winnersByScore(scores) {
  const max = Math.max(...scores.map(x => Number(x.score)));
  return scores.filter(x => Number(x.score) === max).map(x => String(x.playerId));
}

export function validateCommonAction(action) {
  if (action == null || typeof action !== 'object') throw new Error('A valid game action is required');
  return action;
}
