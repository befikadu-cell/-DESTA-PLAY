// ============================================================================
// DESTA PLAY — AVIATOR ENGINE
// Shared, server-authoritative round helpers.
// ============================================================================

import crypto from "node:crypto";

export const AVIATOR_CONFIG = {
  name: "Aviator",
  bettingSeconds: 30,
  tickMilliseconds: 100,
  minBet: 10,
  payoutPercent: 50,
  housePercent: 50,
  startingMultiplier: 1.00,
  growthRate: 0.0075
};

export function createRound() {
  const now = Date.now();
  return {
    id: `aviator-${now}-${crypto.randomBytes(5).toString("hex")}`,
    game: "aviator",
    status: "BETTING",
    bettingSeconds: AVIATOR_CONFIG.bettingSeconds,
    createdAt: now,
    bettingStartedAt: now,
    bettingEndsAt: now + AVIATOR_CONFIG.bettingSeconds * 1000,
    flyingStartedAt: null,
    multiplier: 1.00,
    crashPoint: null,
    payoutCap: 0,
    totalWagered: 0,
    totalPaid: 0,
    bets: [],
    roundNumber: 1,
    secretSeed: crypto.randomBytes(32).toString("hex"),
    committedSeedHash: null,
    settled: false,
    result: null
  };
}

export function commitHash(secretSeed) {
  return crypto.createHash("sha256").update(String(secretSeed)).digest("hex");
}

export function multiplierAt(elapsedMs) {
  const elapsed = Math.max(0, Number(elapsedMs) || 0);
  const raw = Math.exp(AVIATOR_CONFIG.growthRate * elapsed / 100);
  return Number(Math.max(1, raw).toFixed(2));
}

export function generateSafetyCrashPoint(seed) {
  // Hidden 50% RTP crash distribution for player rounds. The future point is
  // server-only and is never sent to the browser before the crash.
  const hash = crypto.createHash("sha256").update(String(seed)).digest("hex");
  const n = parseInt(hash.slice(0, 13), 16);
  const unit = Math.max(Number.EPSILON, n / 0x1fffffffffffff);
  const point = 0.5 / unit;
  return Number(Math.min(1000, Math.max(1.00, point)).toFixed(2));
}

export function attractMultiplierAt(elapsedMs, flightMs) {
  const elapsed = Math.max(0, Number(elapsedMs) || 0);
  const duration = Math.max(1000, Number(flightMs) || 12000);
  const progress = Math.min(1, elapsed / duration);
  return Number(Math.pow(10, progress).toFixed(2));
}

export function normalizeBetAmount(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return 0;
  return Number(Math.max(0, Math.min(1000000, n)).toFixed(2));
}

export function payoutForBet(amount, multiplier) {
  const a = normalizeBetAmount(amount);
  const m = Number(multiplier);
  if (!a || !Number.isFinite(m) || m < 1) return 0;
  return Number((a * m).toFixed(2));
}

export function calculatePayoutCap(totalWagered) {
  return Number((normalizeBetAmount(totalWagered) * AVIATOR_CONFIG.payoutPercent / 100).toFixed(2));
}

export function canCashOut(round, bet, multiplier) {
  if (!round || round.status !== "FLYING") return { ok:false, reason:"The plane has crashed or betting is not active." };
  if (!bet || bet.cashedOut) return { ok:false, reason:"This bet is already settled." };
  const requested = payoutForBet(bet.amount, multiplier);
  if (requested <= 0) return { ok:false, reason:"Invalid cash-out amount." };
  // A valid cash-out is never rejected because of the hidden RTP calculation.
  // The server settles it immediately at the authoritative multiplier.
  return { ok:true, payout:requested };
}


// Compatibility export for deployments that load the engine as a default module.
export default {
  AVIATOR_CONFIG,
  createRound,
  commitHash,
  multiplierAt,
  generateSafetyCrashPoint,
  attractMultiplierAt,
  normalizeBetAmount,
  payoutForBet,
  calculatePayoutCap,
  canCashOut
};
