const { uniqueNumbers } = require("../utils/random");

const KENO_MIN = 1;
const KENO_MAX = 80;

const MAX_PLAYER_SELECTIONS = 10;
const MAX_DRAWN_NUMBERS = 20;

const BETTING_SECONDS = 60;

function validateSelection(selection) {
    if (!Array.isArray(selection)) {
        throw new Error("Selection must be an array");
    }

    const numbers = [...new Set(selection.map(Number))];

    if (numbers.length === 0) {
        throw new Error("Select at least one number");
    }

    if (numbers.length > MAX_PLAYER_SELECTIONS) {
        throw new Error(
            `You can select a maximum of ${MAX_PLAYER_SELECTIONS} numbers`
        );
    }

    for (const number of numbers) {
        if (
            !Number.isInteger(number) ||
            number < KENO_MIN ||
            number > KENO_MAX
        ) {
            throw new Error("Keno numbers must be between 1 and 80");
        }
    }

    return numbers.sort((a, b) => a - b);
}

function createDraw() {
    return uniqueNumbers(
        KENO_MIN,
        KENO_MAX,
        MAX_DRAWN_NUMBERS
    );
}

function calculateMatches(selection, drawnNumbers) {
    return selection.filter(number =>
        drawnNumbers.includes(number)
    );
}

function createRound() {
    return {
        game: "keno",
        bettingSeconds: BETTING_SECONDS,
        minNumber: KENO_MIN,
        maxNumber: KENO_MAX,
        maxSelections: MAX_PLAYER_SELECTIONS,
        maxDrawnNumbers: MAX_DRAWN_NUMBERS,
        status: "BETTING",
        createdAt: new Date().toISOString()
    };
}

function finishRound() {
    const drawnNumbers = createDraw();

    return {
        status: "FINISHED",
        drawnNumbers,
        finishedAt: new Date().toISOString()
    };
}

module.exports = {
    KENO_MIN,
    KENO_MAX,
    MAX_PLAYER_SELECTIONS,
    MAX_DRAWN_NUMBERS,
    BETTING_SECONDS,
    validateSelection,
    createDraw,
    calculateMatches,
    createRound,
    finishRound
};
