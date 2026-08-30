const crypto = require("node:crypto");

const BETTING_SECONDS = 40;

const MIN_MULTIPLIER = 1.00;
const MAX_MULTIPLIER = 100.00;

const MIN_SLOTS = 1;
const DEFAULT_SLOTS = 2;
const MAX_SLOTS = 4;

/*
 * Round states:
 *
 * BETTING  -> players may place bets
 * FLYING   -> plane is flying; new bets are rejected
 * CRASHED  -> flight has ended
 */

function createRound() {
    const crashPoint = generateCrashPoint();

    return {
        game: "aviator",

        status: "BETTING",

        bettingSeconds: BETTING_SECONDS,

        minSlots: MIN_SLOTS,
        defaultSlots: DEFAULT_SLOTS,
        maxSlots: MAX_SLOTS,

        multiplier: null,

        /*
         * The crash point is kept on the server.
         * Do NOT send this value to the browser before
         * the round has finished.
         */
        crashPoint,

        bets: [],

        createdAt: new Date().toISOString(),

        bettingEndsAt:
            Date.now() + BETTING_SECONDS * 1000
    };
}


/*
 * Cryptographically secure random crash point.
 *
 * This is an independent random implementation.
 * It is NOT intended to reproduce SPRIBE's proprietary
 * algorithm or guarantee a particular house profit.
 */
function generateCrashPoint() {
    const cents = crypto.randomInt(
        Math.round(MIN_MULTIPLIER * 100),
        Math.round(MAX_MULTIPLIER * 100) + 1
    );

    return cents / 100;
}


/*
 * Check whether a new bet can be accepted.
 *
 * IMPORTANT:
 * The backend must perform this check.
 * Do not rely on the browser timer.
 */
function canPlaceBet(round) {
    if (!round) {
        return false;
    }

    return round.status === "BETTING";
}


/*
 * Check whether a cash-out request can be accepted.
 */
function canCashOut(round) {
    if (!round) {
        return false;
    }

    return round.status === "FLYING";
}


/*
 * Create a new player bet.
 *
 * The caller should provide:
 *
 * {
 *   playerId,
 *   slot,
 *   amount
 * }
 */
function createBet(round, playerId, slot, amount) {
    if (!canPlaceBet(round)) {
        throw new Error(
            "Betting is closed. Please wait for the next round."
        );
    }

    if (!Number.isInteger(slot)) {
        throw new Error("Invalid slot");
    }

    if (slot < MIN_SLOTS || slot > MAX_SLOTS) {
        throw new Error(
            `Slot must be between ${MIN_SLOTS} and ${MAX_SLOTS}`
        );
    }

    const numericAmount = Number(amount);

    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
        throw new Error("Invalid bet amount");
    }

    if (!playerId) {
        throw new Error("Player ID is required");
    }

    /*
     * Prevent the same player from creating
     * two bets in the same slot.
     */
    const existingBet = round.bets.find(
        bet =>
            bet.playerId === playerId &&
            bet.slot === slot
    );

    if (existingBet) {
        throw new Error(
            "This betting slot has already been used."
        );
    }

    const bet = {
        id: crypto.randomUUID(),

        playerId,

        slot,

        amount: numericAmount,

        status: "ACTIVE",

        cashOutMultiplier: null,

        payout: 0,

        createdAt: new Date().toISOString()
    };

    round.bets.push(bet);

    return bet;
}


/*
 * Start the flight.
 *
 * This must only be called after the betting countdown
 * has reached zero.
 */
function startFlight(round) {
    if (!round) {
        throw new Error("Round not found");
    }

    if (round.status !== "BETTING") {
        throw new Error(
            "Flight cannot be started from the current state."
        );
    }

    round.status = "FLYING";

    round.multiplier = MIN_MULTIPLIER;

    round.startedAt = new Date().toISOString();

    return round;
}


/*
 * Cash out ONE bet.
 *
 * Cashing out Slot 1 does NOT affect Slots 2, 3 or 4.
 */
function cashOut(round, playerId, betId) {
    if (!canCashOut(round)) {
        throw new Error(
            "Cash out is unavailable."
        );
    }

    const bet = round.bets.find(
        item =>
            item.id === betId &&
            item.playerId === playerId
    );

    if (!bet) {
        throw new Error("Bet not found");
    }

    if (bet.status !== "ACTIVE") {
        throw new Error(
            "This bet has already been settled."
        );
    }

    const multiplier = round.multiplier;

    if (
        !Number.isFinite(multiplier) ||
        multiplier < MIN_MULTIPLIER
    ) {
        throw new Error(
            "Invalid flight multiplier."
        );
    }

    /*
     * Round the payout to two decimal places.
     */
    const payout =
        Math.round(
            bet.amount * multiplier * 100
        ) / 100;

    bet.status = "CASHED_OUT";

    bet.cashOutMultiplier = multiplier;

    bet.payout = payout;

    bet.cashedOutAt = new Date().toISOString();

    return {
        betId: bet.id,

        slot: bet.slot,

        amount: bet.amount,

        multiplier,

        payout,

        status: bet.status
    };
}


/*
 * Update the multiplier.
 *
 * The server should call this while the round is flying.
 */
function updateMultiplier(round, multiplier) {
    if (!round) {
        throw new Error("Round not found");
    }

    if (round.status !== "FLYING") {
        throw new Error(
            "Multiplier can only change while flying."
        );
    }

    const value = Number(multiplier);

    if (!Number.isFinite(value)) {
        throw new Error("Invalid multiplier");
    }

    if (
        value < MIN_MULTIPLIER ||
        value > MAX_MULTIPLIER
    ) {
        throw new Error("Multiplier out of range");
    }

    /*
     * Never allow the multiplier to move backwards.
     */
    if (
        round.multiplier !== null &&
        value < round.multiplier
    ) {
        throw new Error(
            "Multiplier cannot move backwards."
        );
    }

    round.multiplier =
        Math.round(value * 100) / 100;

    return round.multiplier;
}


/*
 * Finish the flight.
 *
 * Any ACTIVE bets that weren't cashed out lose.
 *
 * Already CASHED_OUT bets remain untouched.
 */
function crashRound(round) {
    if (!round) {
        throw new Error("Round not found");
    }

    if (round.status !== "FLYING") {
        throw new Error(
            "Round is not flying."
        );
    }

    round.status = "CRASHED";

    round.multiplier =
        round.crashPoint;

    round.crashedAt =
        new Date().toISOString();

    for (const bet of round.bets) {
        if (bet.status === "ACTIVE") {
            bet.status = "LOST";
            bet.payout = 0;
        }
    }

    return round;
}


/*
 * Remove sensitive information before sending
 * a round to the browser.
 *
 * In particular, do NOT reveal crashPoint
 * while the round is still betting/flying.
 */
function publicRound(round) {
    if (!round) {
        return null;
    }

    const result = {
        game: round.game,

        status: round.status,

        bettingSeconds:
            round.bettingSeconds,

        minSlots:
            round.minSlots,

        defaultSlots:
            round.defaultSlots,

        maxSlots:
            round.maxSlots,

        multiplier:
            round.multiplier,

        createdAt:
            round.createdAt,

        bettingEndsAt:
            round.bettingEndsAt
    };

    /*
     * Only reveal the crash point AFTER
     * the round has ended.
     */
    if (round.status === "CRASHED") {
        result.crashPoint =
            round.crashPoint;
    }

    return result;
}


module.exports = {
    BETTING_SECONDS,

    MIN_MULTIPLIER,

    MAX_MULTIPLIER,

    MIN_SLOTS,

    DEFAULT_SLOTS,

    MAX_SLOTS,

    createRound,

    generateCrashPoint,

    canPlaceBet,

    canCashOut,

    createBet,

    startFlight,

    updateMultiplier,

    cashOut,

    crashRound,

    publicRound
};
