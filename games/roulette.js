const crypto = require("node:crypto");

const BETTING_SECONDS = 60;

// European-style wheel: 0–36
const WHEEL = Array.from({ length: 37 }, (_, i) => i);

const RED_NUMBERS = new Set([
    1, 3, 5, 7, 9, 12, 14, 16, 18,
    19, 21, 23, 25, 27, 30, 32, 34, 36
]);

const BLACK_NUMBERS = new Set([
    2, 4, 6, 8, 10, 11, 13, 15, 17,
    20, 22, 24, 26, 28, 29, 31, 33, 35
]);

/*
 * DESTA CUSTOM PAYOUT MODEL
 *
 * Target theoretical RTP: 80%
 * Target theoretical house edge: 20%
 *
 * These are NET payouts.
 *
 * Example:
 * A 10 ETB winning 1:1 bet returns:
 * 10 ETB profit + original 10 ETB stake.
 *
 * Payouts are intentionally lower than standard
 * European roulette payouts.
 */

const PAYOUTS = {
    straight: 28.8,   // standard 35:1 reduced for 80% RTP
    split: 14.4,
    street: 9.333333,
    corner: 6.6,
    sixLine: 4.333333,
    dozen: 1.666667,
    column: 1.666667,
    evenMoney: 0.8
};

function randomNumber() {
    return crypto.randomInt(0, 37);
}

function getColor(number) {
    if (number === 0) return "green";

    if (RED_NUMBERS.has(number)) {
        return "red";
    }

    return "black";
}

function getParity(number) {
    if (number === 0) return null;

    return number % 2 === 0 ? "even" : "odd";
}

function isLow(number) {
    return number >= 1 && number <= 18;
}

function isHigh(number) {
    return number >= 19 && number <= 36;
}

function isDozen(number, dozen) {
    if (number === 0) return false;

    if (dozen === 1) {
        return number >= 1 && number <= 12;
    }

    if (dozen === 2) {
        return number >= 13 && number <= 24;
    }

    if (dozen === 3) {
        return number >= 25 && number <= 36;
    }

    return false;
}

function isColumn(number, column) {
    if (number === 0) return false;

    return ((number - column) % 3 === 0);
}

/*
 * Supported bet formats:
 *
 * { type: "straight", number: 17, amount: 10 }
 * { type: "red", amount: 10 }
 * { type: "black", amount: 10 }
 * { type: "odd", amount: 10 }
 * { type: "even", amount: 10 }
 * { type: "low", amount: 10 }
 * { type: "high", amount: 10 }
 * { type: "dozen", dozen: 1, amount: 10 }
 * { type: "column", column: 1, amount: 10 }
 */

function validateBet(bet) {
    if (!bet || typeof bet !== "object") {
        throw new Error("Invalid bet");
    }

    const amount = Number(bet.amount);

    if (!Number.isFinite(amount) || amount <= 0) {
        throw new Error("Invalid bet amount");
    }

    if (!Number.isInteger(amount)) {
        throw new Error("Bet amount must be a whole number");
    }

    const allowedTypes = [
        "straight",
        "red",
        "black",
        "odd",
        "even",
        "low",
        "high",
        "dozen",
        "column"
    ];

    if (!allowedTypes.includes(bet.type)) {
        throw new Error("Unsupported roulette bet");
    }

    if (bet.type === "straight") {
        const number = Number(bet.number);

        if (!Number.isInteger(number) || number < 0 || number > 36) {
            throw new Error("Straight bet must be between 0 and 36");
        }
    }

    if (bet.type === "dozen") {
        if (![1, 2, 3].includes(Number(bet.dozen))) {
            throw new Error("Dozen must be 1, 2 or 3");
        }
    }

    if (bet.type === "column") {
        if (![1, 2, 3].includes(Number(bet.column))) {
            throw new Error("Column must be 1, 2 or 3");
        }
    }

    return {
        ...bet,
        amount
    };
}

function isWinningBet(bet, result) {
    const number = result.number;

    switch (bet.type) {

        case "straight":
            return number === Number(bet.number);

        case "red":
            return RED_NUMBERS.has(number);

        case "black":
            return BLACK_NUMBERS.has(number);

        case "odd":
            return getParity(number) === "odd";

        case "even":
            return getParity(number) === "even";

        case "low":
            return isLow(number);

        case "high":
            return isHigh(number);

        case "dozen":
            return isDozen(number, Number(bet.dozen));

        case "column":
            return isColumn(number, Number(bet.column));

        default:
            return false;
    }
}

function getPayoutMultiplier(bet) {
    switch (bet.type) {

        case "straight":
            return PAYOUTS.straight;

        case "red":
        case "black":
        case "odd":
        case "even":
        case "low":
        case "high":
            return PAYOUTS.evenMoney;

        case "dozen":
            return PAYOUTS.dozen;

        case "column":
            return PAYOUTS.column;

        default:
            throw new Error("No payout available");
    }
}

function settleBet(bet, result) {
    const validBet = validateBet(bet);

    const won = isWinningBet(validBet, result);

    if (!won) {
        return {
            won: false,
            stake: validBet.amount,
            profit: 0,
            returnAmount: 0
        };
    }

    const multiplier = getPayoutMultiplier(validBet);

    const profit =
        validBet.amount * multiplier;

    const returnAmount =
        validBet.amount + profit;

    return {
        won: true,
        stake: validBet.amount,
        profit,
        returnAmount,
        multiplier
    };
}

function spin() {
    const number = randomNumber();

    return {
        number,
        color: getColor(number),
        parity: getParity(number),
        timestamp: new Date().toISOString()
    };
}

function createRound() {
    return {
        game: "roulette",
        bettingSeconds: BETTING_SECONDS,
        status: "BETTING",
        createdAt: new Date().toISOString()
    };
}

module.exports = {
    BETTING_SECONDS,
    WHEEL,
    RED_NUMBERS,
    BLACK_NUMBERS,
    PAYOUTS,
    validateBet,
    isWinningBet,
    getPayoutMultiplier,
    settleBet,
    spin,
    createRound
};
