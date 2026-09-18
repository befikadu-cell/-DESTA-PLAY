// ============================================================================
// DESTA PLAY — CHICKEN ROAD ENGINE
// ============================================================================
// Server-authoritative Chicken Road outcome engine.
//
// RTP model:
// For a fixed cash-out step n, the multiplier is chosen so that
// P(reach step n) * multiplier(n) = 0.50.
// This makes the theoretical return 50% for a fixed stopping step.
// Actual player return can differ because players choose when to cash out.
//
// The crash point is generated server-side and is never sent to the client
// at round creation. The client advances one step at a time through /tick.
// ============================================================================

import crypto from "node:crypto";

export const CHICKEN_ROAD_CONFIG = Object.freeze({
    name: "Chicken Road",
    minBet: 10,
    maxBet: 1000,
    maxSteps: 10,
    housePercent: 50,
    rtpPercent: 50,

    // Survival probability after each completed crossing.
    // The corresponding multiplier is 0.50 / survivalProbability.
    survivalByStep: Object.freeze([
        0.4545454545, // 1.10x
        0.4000000000, // 1.25x
        0.3333333333, // 1.50x
        0.2500000000, // 2.00x
        0.2000000000, // 2.50x
        0.1666666667, // 3.00x
        0.1250000000, // 4.00x
        0.1000000000, // 5.00x
        0.0800000000, // 6.25x
        0.0500000000  // 10.00x
    ]),

    multiplierByStep: Object.freeze([
        1.10, 1.25, 1.50, 2.00, 2.50,
        3.00, 4.00, 5.00, 6.25, 10.00
    ])
});

function secureUnit() {
    // 0 <= value < 1
    const max = 1_000_000_000;
    return crypto.randomInt(max) / max;
}

export function validateBet(amount) {
    const value = Number(amount);

    if (!Number.isFinite(value)) {
        throw new Error("Invalid Chicken Road bet");
    }

    if (value < CHICKEN_ROAD_CONFIG.minBet) {
        throw new Error(`Minimum Chicken Road bet is ${CHICKEN_ROAD_CONFIG.minBet} ETB`);
    }

    if (value > CHICKEN_ROAD_CONFIG.maxBet) {
        throw new Error(`Maximum Chicken Road bet is ${CHICKEN_ROAD_CONFIG.maxBet} ETB`);
    }

    return Number(value.toFixed(2));
}

export function multiplierForStep(step) {
    const n = Number(step);

    if (!Number.isInteger(n) || n < 1 || n > CHICKEN_ROAD_CONFIG.maxSteps) {
        return null;
    }

    return CHICKEN_ROAD_CONFIG.multiplierByStep[n - 1];
}

export function survivalProbability(step) {
    const n = Number(step);

    if (!Number.isInteger(n) || n < 1 || n > CHICKEN_ROAD_CONFIG.maxSteps) {
        return 0;
    }

    return CHICKEN_ROAD_CONFIG.survivalByStep[n - 1];
}

export function createRound({ playerId, amount }) {
    const stake = validateBet(amount);

    // crashStep = n means the chicken crashes while attempting step n.
    // crashStep = maxSteps + 1 means all steps can be completed.
    const u = secureUnit();

    let crashStep = CHICKEN_ROAD_CONFIG.maxSteps + 1;

    for (let step = 1; step <= CHICKEN_ROAD_CONFIG.maxSteps; step += 1) {
        if (u > survivalProbability(step)) {
            crashStep = step;
            break;
        }
    }

    return {
        id: `CHICKEN-${crypto.randomBytes(12).toString("hex")}`,
        game: "chicken-road",
        playerId: String(playerId),
        amount: stake,
        currentStep: 0,
        crashStep,
        status: "ACTIVE",
        startedAt: Date.now(),
        finishedAt: null
    };
}

export function getMultiplier(step) {
    return multiplierForStep(step);
}

export function canCashOut(round) {
    return Boolean(
        round &&
        round.status === "ACTIVE" &&
        Number(round.currentStep) >= 1 &&
        Number(round.currentStep) < Number(round.crashStep)
    );
}

export function cashOutAmount(round) {
    if (!canCashOut(round)) return 0;

    return Number(
        (Number(round.amount) * multiplierForStep(round.currentStep)).toFixed(2)
    );
}
