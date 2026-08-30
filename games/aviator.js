const { randomInt } = require("../utils/random");

const BETTING_SECONDS = 40;

const MIN_MULTIPLIER = 1.00;
const MAX_MULTIPLIER = 100.00;

function createRound() {
    return {
        game: "aviator",
        bettingSeconds: BETTING_SECONDS,
        status: "BETTING",
        createdAt: new Date().toISOString()
    };
}

function generateCrashPoint() {
    // Simple independently generated crash point.
    // This is not a house-edge targeting algorithm.

    const cents = randomInt(100, MAX_MULTIPLIER * 100);

    return {
        multiplier: cents / 100
    };
}

function canCashOut(roundStatus) {
    return roundStatus === "FLYING";
}

module.exports = {
    BETTING_SECONDS,
    MIN_MULTIPLIER,
    MAX_MULTIPLIER,
    createRound,
    generateCrashPoint,
    canCashOut
};
