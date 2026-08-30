const { shuffle } = require("../utils/random");

const BINGO_SIZE = 5;
const BINGO_NUMBERS = 75;
const BETTING_SECONDS = 60;

const COLUMN_RANGES = [
    [1, 15],   // B
    [16, 30],  // I
    [31, 45],  // N
    [46, 60],  // G
    [61, 75]   // O
];

function generateColumn(min, max, count) {
    const numbers = [];

    for (let n = min; n <= max; n++) {
        numbers.push(n);
    }

    return shuffle(numbers).slice(0, count).sort((a, b) => a - b);
}

function generateCartela() {
    const card = [];

    for (let column = 0; column < 5; column++) {
        const [min, max] = COLUMN_RANGES[column];

        const numbers = generateColumn(min, max, 5);

        for (let row = 0; row < 5; row++) {
            if (!card[row]) {
                card[row] = [];
            }

            card[row][column] = numbers[row];
        }
    }

    // Free center square
    card[2][2] = "FREE";

    return card;
}

function generateDrawOrder() {
    const numbers = [];

    for (let i = 1; i <= BINGO_NUMBERS; i++) {
        numbers.push(i);
    }

    return shuffle(numbers);
}

function isWinningCard(card, calledNumbers) {
    const called = new Set(calledNumbers);

    // Rows
    for (let row = 0; row < 5; row++) {
        let complete = true;

        for (let column = 0; column < 5; column++) {
            const value = card[row][column];

            if (value !== "FREE" && !called.has(value)) {
                complete = false;
                break;
            }
        }

        if (complete) return true;
    }

    // Columns
    for (let column = 0; column < 5; column++) {
        let complete = true;

        for (let row = 0; row < 5; row++) {
            const value = card[row][column];

            if (value !== "FREE" && !called.has(value)) {
                complete = false;
                break;
            }
        }

        if (complete) return true;
    }

    // Diagonal 1
    let diagonal1 = true;

    for (let i = 0; i < 5; i++) {
        const value = card[i][i];

        if (value !== "FREE" && !called.has(value)) {
            diagonal1 = false;
            break;
        }
    }

    if (diagonal1) return true;

    // Diagonal 2
    let diagonal2 = true;

    for (let i = 0; i < 5; i++) {
        const value = card[i][4 - i];

        if (value !== "FREE" && !called.has(value)) {
            diagonal2 = false;
            break;
        }
    }

    return diagonal2;
}

function createRound() {
    return {
        game: "bingo",
        bettingSeconds: BETTING_SECONDS,
        status: "BETTING",
        createdAt: new Date().toISOString()
    };
}

module.exports = {
    BINGO_SIZE,
    BINGO_NUMBERS,
    BETTING_SECONDS,
    generateCartela,
    generateDrawOrder,
    isWinningCard,
    createRound
};
