/*
 * DESTA PLAY — CHICKEN ROAD ENGINE
 *
 * One-file engine: outcome, physics/state, multiplier and settlement math.
 * The browser never decides the authoritative result.
 */
"use strict";

import crypto from "crypto";

const MAX_STEP = 12;
const RTP = 0.50;
const HOUSE_EDGE = 0.50;

/*
 * Multiplier schedule. For every fixed cash-out step n:
 *   P(reach n) * multiplier[n] = 0.50
 * Therefore the theoretical fixed-step return is 50% before rounding.
 * This is intentionally a high-house-edge/high-volatility configuration.
 */
const MULTIPLIERS = [
    1.10, 1.25, 1.45, 1.70,
    2.05, 2.50, 3.10, 3.90,
    4.90, 6.20, 8.00, 10.00
];

const SURVIVAL = MULTIPLIERS.map(m => RTP / m);

function assertStep(step) {
    const n = Number(step);
    if (!Number.isInteger(n) || n < 1 || n > MAX_STEP) {
        throw new Error("Invalid Chicken Road step");
    }
    return n;
}

function randomUnit() {
    // randomInt avoids modulo bias and is suitable for server-side outcome generation.
    const n = crypto.randomInt(0, 1_000_000);
    return n / 1_000_000;
}

export const CONFIG = Object.freeze({
    name: "chicken-road",
    maxStep: MAX_STEP,
    rtp: RTP,
    houseEdge: HOUSE_EDGE,
    multipliers: [...MULTIPLIERS],
    bettingSeconds: 0
});

export function validateBetAmount(amount) {
    const n = Number(amount);
    if (!Number.isFinite(n) || n < 10) {
        throw new Error("Minimum Chicken Road bet is 10 ETB");
    }
    return Number(n.toFixed(2));
}

export function multiplierForStep(step) {
    return MULTIPLIERS[assertStep(step) - 1];
}

export function survivalProbability(step) {
    return SURVIVAL[assertStep(step) - 1];
}

/*
 * Returns the authoritative crash step.
 * 1..12 = crash occurs at that step.
 * 13 = no crash through the maximum step; reaching step 12 completes at 10x.
 */
export function generateCrashStep(randomValue = randomUnit()) {
    const r = Number(randomValue);
    if (!Number.isFinite(r) || r < 0 || r >= 1) {
        throw new Error("Invalid random outcome");
    }

    for (let step = 1; step <= MAX_STEP; step++) {
        const crashThroughStep = 1 - SURVIVAL[step - 1];
        if (r < crashThroughStep) return step;
    }

    return MAX_STEP + 1;
}

export function createRound({ roundId, playerId, stake, walletType = "cash" }) {
    const amount = validateBetAmount(stake);
    const crashStep = generateCrashStep();

    return {
        id: String(roundId),
        game: "chicken-road",
        playerId: String(playerId),
        stake: amount,
        walletType: String(walletType).toLowerCase() === "bonus" ? "bonus" : "cash",
        status: "ACTIVE",
        currentStep: 0,
        multiplier: 1,
        crashStep,
        cashedOut: false,
        payout: 0,
        createdAt: Date.now(),
        updatedAt: Date.now()
    };
}

export function isCrashAtStep(round, step) {
    const n = assertStep(step);
    return n >= Number(round.crashStep) && Number(round.crashStep) <= MAX_STEP;
}

export function advance(round, step) {
    const n = assertStep(step);
    if (round.status !== "ACTIVE") {
        throw new Error("Chicken Road round is no longer active");
    }
    if (n !== Number(round.currentStep) + 1) {
        throw new Error("Chicken Road step is out of sequence");
    }

    round.currentStep = n;
    round.updatedAt = Date.now();

    if (isCrashAtStep(round, n)) {
        round.status = "LOST";
        round.multiplier = 0;
        round.payout = 0;
        return { state: "CRASH", step: n, multiplier: 0, payout: 0 };
    }

    round.multiplier = multiplierForStep(n);

    if (n === MAX_STEP) {
        round.status = "WON";
        round.payout = calculatePayout(round.stake, n);
        return { state: "FINISH", step: n, multiplier: round.multiplier, payout: round.payout };
    }

    return { state: "SAFE", step: n, multiplier: round.multiplier, payout: 0 };
}

export function calculatePayout(stake, step) {
    const amount = validateBetAmount(stake);
    const m = multiplierForStep(step);
    return Number((amount * m).toFixed(2));
}

export function cashOut(round, step) {
    const n = assertStep(step);
    if (round.status !== "ACTIVE") {
        throw new Error("Round is no longer active");
    }
    if (n !== Number(round.currentStep)) {
        throw new Error("Cash-out step does not match the authoritative game state");
    }
    if (isCrashAtStep(round, n)) {
        throw new Error("The chicken already crashed");
    }

    const payout = calculatePayout(round.stake, n);
    round.status = "CASHED_OUT";
    round.cashedOut = true;
    round.multiplier = multiplierForStep(n);
    round.payout = payout;
    round.updatedAt = Date.now();

    return {
        state: "CASHED_OUT",
        step: n,
        multiplier: round.multiplier,
        payout
    };
}

export function publicRound(round) {
    return {
        id: round.id,
        game: "chicken-road",
        status: round.status,
        currentStep: Number(round.currentStep || 0),
        multiplier: Number(round.multiplier || 1),
        stake: Number(round.stake || 0),
        walletType: round.walletType,
        maxStep: MAX_STEP
        // crashStep is intentionally NOT returned before the round ends.
    };
}

export function finalRound(round) {
    return {
        ...publicRound(round),
        crashStep: Number(round.crashStep),
        payout: Number(round.payout || 0)
    };
}

export function theoreticalRtpTable() {
    return MULTIPLIERS.map((multiplier, i) => ({
        step: i + 1,
        multiplier,
        probabilityToReachStep: SURVIVAL[i],
        fixedStepReturn: Number((SURVIVAL[i] * multiplier).toFixed(6))
    }));
}

export default {
    CONFIG,
    validateBetAmount,
    multiplierForStep,
    survivalProbability,
    generateCrashStep,
    createRound,
    isCrashAtStep,
    advance,
    calculatePayout,
    cashOut,
    publicRound,
    finalRound,
    theoreticalRtpTable
};
