const crypto = require("node:crypto");

function randomInt(min, max) {
    if (!Number.isInteger(min) || !Number.isInteger(max)) {
        throw new Error("min and max must be integers");
    }

    if (max < min) {
        throw new Error("max must be greater than or equal to min");
    }

    return crypto.randomInt(min, max + 1);
}

function shuffle(array) {
    const result = [...array];

    for (let i = result.length - 1; i > 0; i--) {
        const j = crypto.randomInt(0, i + 1);

        [result[i], result[j]] = [result[j], result[i]];
    }

    return result;
}

function uniqueNumbers(min, max, count) {
    if (count < 0 || count > (max - min + 1)) {
        throw new Error("Invalid number count");
    }

    const numbers = [];

    while (numbers.length < count) {
        const number = randomInt(min, max);

        if (!numbers.includes(number)) {
            numbers.push(number);
        }
    }

    return numbers;
}

module.exports = {
    randomInt,
    shuffle,
    uniqueNumbers
};
