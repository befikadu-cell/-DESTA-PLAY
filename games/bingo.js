"use strict";

const crypto = require("node:crypto");
const { shuffle } = require("../utils/random");

/*
|--------------------------------------------------------------------------
| DESTA PLAY - BINGO GAME ENGINE
|--------------------------------------------------------------------------
|
| 75-BALL BINGO
|
| B = 1-15
| I = 16-30
| N = 31-45
| G = 46-60
| O = 61-75
|
| Center N3 = FREE
|
|--------------------------------------------------------------------------
*/

const GAME_NAME = "bingo";

const BINGO_SIZE = 5;
const BINGO_NUMBERS = 75;

const BETTING_SECONDS = 60;

const TOTAL_CARTELAS = 120;

const MIN_SLOTS = 1;
const DEFAULT_SLOTS = 2;
const MAX_SLOTS = 4;

const WAITING_MESSAGE =
    "WAITING FOR NEXT ROUND";

const WAITING_MESSAGE_AM =
    "ቀጣዩን ዙር በመጠበቅ ላይ";


/*
|--------------------------------------------------------------------------
| B-I-N-G-O ranges
|--------------------------------------------------------------------------
*/

const COLUMN_RANGES = [
    [1, 15],   // B
    [16, 30],  // I
    [31, 45],  // N
    [46, 60],  // G
    [61, 75]   // O
];

const COLUMN_LETTERS = [
    "B",
    "I",
    "N",
    "G",
    "O"
];


/*
|--------------------------------------------------------------------------
| Deterministic random generator
|--------------------------------------------------------------------------
|
| Cartela #1 always produces the same card.
| Cartela #2 always produces the same card.
| ...
| Cartela #120 always produces the same card.
|
|--------------------------------------------------------------------------
*/

function seededRandom(seed) {
    let value = seed >>> 0;

    return function () {
        value += 0x6D2B79F5;

        let t = value;

        t = Math.imul(
            t ^ (t >>> 15),
            t | 1
        );

        t ^= t + Math.imul(
            t ^ (t >>> 7),
            t | 61
        );

        return (
            ((t ^ (t >>> 14)) >>> 0)
            / 4294967296
        );
    };
}


/*
|--------------------------------------------------------------------------
| Generate seed for cartela
|--------------------------------------------------------------------------
*/

function cartelaSeed(cartelaNumber) {

    const hash = crypto
        .createHash("sha256")
        .update(
            `DESTA-PLAY-BINGO-CARTELA-${cartelaNumber}`
        )
        .digest();

    return hash.readUInt32BE(0);
}


/*
|--------------------------------------------------------------------------
| Deterministic shuffle
|--------------------------------------------------------------------------
*/

function seededShuffle(array, random) {

    const result = [...array];

    for (
        let i = result.length - 1;
        i > 0;
        i--
    ) {

        const j = Math.floor(
            random() * (i + 1)
        );

        [
            result[i],
            result[j]
        ] = [
            result[j],
            result[i]
        ];
    }

    return result;
}


/*
|--------------------------------------------------------------------------
| Generate column numbers
|--------------------------------------------------------------------------
*/

function generateColumn(
    min,
    max,
    count,
    random
) {

    const numbers = [];

    for (
        let number = min;
        number <= max;
        number++
    ) {
        numbers.push(number);
    }

    return seededShuffle(
        numbers,
        random
    )
        .slice(0, count)
        .sort((a, b) => a - b);
}


/*
|--------------------------------------------------------------------------
| Validate cartela number
|--------------------------------------------------------------------------
*/

function validateCartelaNumber(cartelaNumber) {

    const number =
        Number(cartelaNumber);

    if (
        !Number.isInteger(number) ||
        number < 1 ||
        number > TOTAL_CARTELAS
    ) {
        throw new Error(
            `Cartela number must be between 1 and ${TOTAL_CARTELAS}`
        );
    }

    return number;
}


/*
|--------------------------------------------------------------------------
| Generate fixed cartela
|--------------------------------------------------------------------------
*/

function generateCartela(cartelaNumber) {

    const number =
        validateCartelaNumber(
            cartelaNumber
        );

    const random =
        seededRandom(
            cartelaSeed(number)
        );

    const card =
        Array.from(
            { length: BINGO_SIZE },
            () =>
                Array(BINGO_SIZE)
        );


    /*
     * Generate each column independently.
     */

    for (
        let column = 0;
        column < BINGO_SIZE;
        column++
    ) {

        const [
            min,
            max
        ] = COLUMN_RANGES[column];

        /*
         * N column only needs four numbers
         * because the center is FREE.
         */

        const count =
            column === 2
                ? 4
                : 5;

        const numbers =
            generateColumn(
                min,
                max,
                count,
                random
            );


        if (column === 2) {

            /*
             * N column:
             *
             * rows 0,1 = numbers
             * row 2   = FREE
             * rows 3,4 = numbers
             */

            let numberIndex = 0;

            for (
                let row = 0;
                row < 5;
                row++
            ) {

                if (row === 2) {
                    card[row][column] =
                        "FREE";
                } else {
                    card[row][column] =
                        numbers[numberIndex];

                    numberIndex++;
                }
            }

        } else {

            for (
                let row = 0;
                row < 5;
                row++
            ) {
                card[row][column] =
                    numbers[row];
            }
        }
    }


    return {
        number,
        card
    };
}


/*
|--------------------------------------------------------------------------
| Validate card structure
|--------------------------------------------------------------------------
*/

function validateCard(card) {

    if (
        !Array.isArray(card) ||
        card.length !== 5
    ) {
        return false;
    }

    for (
        let row = 0;
        row < 5;
        row++
    ) {

        if (
            !Array.isArray(card[row]) ||
            card[row].length !== 5
        ) {
            return false;
        }
    }

    /*
     * Center must be FREE.
     */

    if (
        card[2][2] !== "FREE"
    ) {
        return false;
    }


    /*
     * Check column ranges.
     */

    for (
        let column = 0;
        column < 5;
        column++
    ) {

        const [
            min,
            max
        ] = COLUMN_RANGES[column];

        const values = [];

        for (
            let row = 0;
            row < 5;
            row++
        ) {

            const value =
                card[row][column];

            if (value === "FREE") {
                continue;
            }

            if (
                !Number.isInteger(value) ||
                value < min ||
                value > max
            ) {
                return false;
            }

            values.push(value);
        }

        /*
         * No duplicate number inside a column.
         */

        if (
            new Set(values).size !==
            values.length
        ) {
            return false;
        }
    }


    /*
     * No duplicate number anywhere
     * on the card.
     */

    const allNumbers = [];

    for (
        let row = 0;
        row < 5;
        row++
    ) {

        for (
            let column = 0;
            column < 5;
            column++
        ) {

            const value =
                card[row][column];

            if (value !== "FREE") {
                allNumbers.push(value);
            }
        }
    }

    return (
        new Set(allNumbers).size ===
        allNumbers.length
    );
}


/*
|--------------------------------------------------------------------------
| Generate all 120 permanent cartelas
|--------------------------------------------------------------------------
*/

function generateAllCartelas() {

    const cartelas = {};

    const signatures =
        new Set();

    for (
        let number = 1;
        number <= TOTAL_CARTELAS;
        number++
    ) {

        const cartela =
            generateCartela(number);


        /*
         * Every generated card must be valid.
         */

        if (
            !validateCard(
                cartela.card
            )
        ) {
            throw new Error(
                `Invalid Bingo configuration for Cartela #${number}`
            );
        }


        /*
         * Every cartela configuration
         * must be different.
         */

        const signature =
            JSON.stringify(
                cartela.card
            );

        if (
            signatures.has(signature)
        ) {
            throw new Error(
                `Duplicate Bingo configuration detected: Cartela #${number}`
            );
        }

        signatures.add(signature);

        cartelas[number] =
            cartela;
    }

    return cartelas;
}


/*
|--------------------------------------------------------------------------
| Permanent cartela collection
|--------------------------------------------------------------------------
*/

const CARTELAS =
    generateAllCartelas();


/*
|--------------------------------------------------------------------------
| Get one cartela
|--------------------------------------------------------------------------
*/

function getCartela(cartelaNumber) {

    const number =
        validateCartelaNumber(
            cartelaNumber
        );

    return CARTELAS[number];
}


/*
|--------------------------------------------------------------------------
| Get available cartela numbers
|--------------------------------------------------------------------------
*/

function getAvailableCartelas() {

    return Array.from(
        { length: TOTAL_CARTELAS },
        (_, index) => index + 1
    );
}


/*
|--------------------------------------------------------------------------
| Generate automatic draw order
|--------------------------------------------------------------------------
|
| Every number 1-75 appears exactly once.
|
| This is generated by the server.
| The player cannot control the draw.
|
|--------------------------------------------------------------------------
*/

function generateDrawOrder() {

    const numbers = [];

    for (
        let number = 1;
        number <= BINGO_NUMBERS;
        number++
    ) {
        numbers.push(number);
    }

    return shuffle(numbers);
}


/*
|--------------------------------------------------------------------------
| Convert number to B-I-N-G-O call
|--------------------------------------------------------------------------
*/

function getCallLetter(number) {

    const value =
        Number(number);

    if (
        !Number.isInteger(value) ||
        value < 1 ||
        value > 75
    ) {
        throw new Error(
            "Bingo number must be between 1 and 75"
        );
    }

    if (value <= 15) {
        return "B";
    }

    if (value <= 30) {
        return "I";
    }

    if (value <= 45) {
        return "N";
    }

    if (value <= 60) {
        return "G";
    }

    return "O";
}


/*
|--------------------------------------------------------------------------
| Create B-I-N-G-O call
|--------------------------------------------------------------------------
*/

function createCall(number) {

    return {
        number,
        letter:
            getCallLetter(number),
        display:
            `${getCallLetter(number)}-${number}`
    };
}


/*
|--------------------------------------------------------------------------
| Create round
|--------------------------------------------------------------------------
*/

function createRound() {

    const now =
        Date.now();

    const drawOrder =
        generateDrawOrder();

    return {

        game:
            GAME_NAME,

        status:
            "BETTING",

        bettingSeconds:
            BETTING_SECONDS,

        bettingStartedAt:
            new Date(now)
                .toISOString(),

        bettingEndsAt:
            now +
            BETTING_SECONDS * 1000,

        waitingMessage:
            WAITING_MESSAGE,

        waitingMessageAm:
            WAITING_MESSAGE_AM,

        totalCartelas:
            TOTAL_CARTELAS,

        minSlots:
            MIN_SLOTS,

        defaultSlots:
            DEFAULT_SLOTS,

        maxSlots:
            MAX_SLOTS,

        /*
         * Internal server-only draw sequence.
         *
         * NEVER send this whole array to the browser.
         */

        drawOrder,

        drawIndex: 0,

        drawnNumbers: [],

        calls: [],

        currentCall: null,

        players: {},

        winner: null,

        createdAt:
            new Date(now)
                .toISOString()
    };
}


/*
|--------------------------------------------------------------------------
| Can place a bet
|--------------------------------------------------------------------------
*/

function canPlaceBet(round) {

    if (!round) {
        return false;
    }

    return (
        round.status === "BETTING" &&
        Date.now() <
            round.bettingEndsAt
    );
}


/*
|--------------------------------------------------------------------------
| Start drawing
|--------------------------------------------------------------------------
*/

function startDrawing(round) {

    if (!round) {
        throw new Error(
            "Bingo round not found"
        );
    }

    if (
        round.status !== "BETTING"
    ) {
        throw new Error(
            "Bingo betting is not active"
        );
    }

    if (
        Date.now() <
        round.bettingEndsAt
    ) {
        throw new Error(
            "Betting period has not ended"
        );
    }

    round.status =
        "DRAWING";

    round.drawingStartedAt =
        new Date().toISOString();

    return round;
}


/*
|--------------------------------------------------------------------------
| Draw next number
|--------------------------------------------------------------------------
|
| IMPORTANT:
| This function is for server.js.
|
| The player NEVER calls this.
|
|--------------------------------------------------------------------------
*/

function drawNextNumber(round) {

    if (!round) {
        throw new Error(
            "Bingo round not found"
        );
    }

    if (
        round.status !== "DRAWING"
    ) {
        throw new Error(
            "Bingo is not currently drawing"
        );
    }

    if (
        round.drawIndex >=
        round.drawOrder.length
    ) {
        throw new Error(
            "All Bingo numbers have been drawn"
        );
    }


    const number =
        round.drawOrder[
            round.drawIndex
        ];

    round.drawIndex++;

    round.drawnNumbers.push(
        number
    );


    const call =
        createCall(number);

    round.calls.push(
        call
    );

    round.currentCall =
        call;


    return call;
}


/*
|--------------------------------------------------------------------------
| Check whether a number was called
|--------------------------------------------------------------------------
*/

function wasNumberCalled(
    round,
    number
) {

    if (!round) {
        return false;
    }

    return round.drawnNumbers
        .includes(
            Number(number)
        );
}


/*
|--------------------------------------------------------------------------
| Get player's selected cartela
|--------------------------------------------------------------------------
*/

function getPlayerCartela(
    player
) {

    if (!player) {
        return null;
    }

    return getCartela(
        player.cartelaNumber
    );
}


/*
|--------------------------------------------------------------------------
| Create player
|--------------------------------------------------------------------------
|
| This does NOT handle payment.
| It only creates the player's Bingo state.
|
|--------------------------------------------------------------------------
*/

function createPlayer(
    playerId,
    cartelaNumber
) {

    if (!playerId) {
        throw new Error(
            "Player ID is required"
        );
    }

    const cartela =
        getCartela(
            cartelaNumber
        );

    return {

        playerId,

        cartelaNumber:
            cartela.number,

        /*
         * Manual marks.
         *
         * Center FREE starts marked.
         */

        markedPositions: [
            "2-2"
        ],

        bingoClaimed:
            false,

        bingoResult:
            null
    };
}


/*
|--------------------------------------------------------------------------
| Mark a position manually
|--------------------------------------------------------------------------
|
| The player taps a square.
|
| The number MUST have already been called.
|
|--------------------------------------------------------------------------
*/

function markPosition(
    round,
    player,
    row,
    column
) {

    if (!round) {
        throw new Error(
            "Bingo round not found"
        );
    }

    if (
        round.status !== "DRAWING"
    ) {
        throw new Error(
            "The Bingo round is not active"
        );
    }

    if (!player) {
        throw new Error(
            "Player not found"
        );
    }

    if (
        !Number.isInteger(row) ||
        !Number.isInteger(column) ||
        row < 0 ||
        row > 4 ||
        column < 0 ||
        column > 4
    ) {
        throw new Error(
            "Invalid Bingo position"
        );
    }


    /*
     * FREE square.
     */

    if (
        row === 2 &&
        column === 2
    ) {

        if (
            !player.markedPositions
                .includes("2-2")
        ) {
            player.markedPositions
                .push("2-2");
        }

        return {
            success: true,
            marked: true,
            free: true
        };
    }


    const cartela =
        getPlayerCartela(
            player
        );

    const value =
        cartela.card[row][column];


    /*
     * Only numbers actually called
     * by the game engine can be marked.
     */

    if (
        !wasNumberCalled(
            round,
            value
        )
    ) {

        return {
            success: false,
            marked: false,
            error:
                "This number has not been called yet."
        };
    }


    const position =
        `${row}-${column}`;


    /*
     * Toggle the mark.
     *
     * This allows the player to correct
     * an accidental tap.
     */

    const existingIndex =
        player.markedPositions
            .indexOf(position);

    if (
        existingIndex !== -1
    ) {

        /*
         * Don't allow FREE to be removed.
         */

        player.markedPositions
            .splice(
                existingIndex,
                1
            );

        return {
            success: true,
            marked: false
        };
    }


    player.markedPositions
        .push(position);

    return {
        success: true,
        marked: true,
        number:
