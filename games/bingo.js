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
| CENTER = FREE
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
| Cartela #1 always has the same configuration.
| Cartela #2 always has the same configuration.
| ...
| Cartela #120 always has the same configuration.
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
| Cartela seed
|--------------------------------------------------------------------------
*/

function cartelaSeed(cartelaNumber) {

    const hash =
        crypto
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

        const j =
            Math.floor(
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
| Generate one Bingo column
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
        .sort(
            (a, b) => a - b
        );
}


/*
|--------------------------------------------------------------------------
| Validate cartela number
|--------------------------------------------------------------------------
*/

function validateCartelaNumber(
    cartelaNumber
) {

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
| Generate one fixed Cartela
|--------------------------------------------------------------------------
*/

function generateCartela(
    cartelaNumber
) {

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
            {
                length: BINGO_SIZE
            },
            () =>
                Array(BINGO_SIZE)
        );


    /*
     * B, I, N, G, O
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
         * N column has only four numbers
         * because its center is FREE.
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
| Validate generated card
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
     * Check every column.
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

            if (
                value === "FREE"
            ) {
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
         * No duplicate number
         * inside one column.
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

            if (
                value !== "FREE"
            ) {
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
| Generate all 120 fixed Cartelas
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
         * Ensure no two cartelas have
         * exactly the same configuration.
         */

        const signature =
            JSON.stringify(
                cartela.card
            );

        if (
            signatures.has(signature)
        ) {

            throw new Error(
                `Duplicate Bingo configuration detected for Cartela #${number}`
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
| Permanent Cartela collection
|--------------------------------------------------------------------------
*/

const CARTELAS =
    generateAllCartelas();


/*
|--------------------------------------------------------------------------
| Get a Cartela
|--------------------------------------------------------------------------
*/

function getCartela(
    cartelaNumber
) {

    const number =
        validateCartelaNumber(
            cartelaNumber
        );

    return CARTELAS[number];
}


/*
|--------------------------------------------------------------------------
| Available Cartela numbers
|--------------------------------------------------------------------------
*/

function getAvailableCartelas() {

    return Array.from(
        {
            length: TOTAL_CARTELAS
        },
        (_, index) =>
            index + 1
    );
}


/*
|--------------------------------------------------------------------------
| Generate automatic Bingo draw
|--------------------------------------------------------------------------
|
| Every number 1-75 appears exactly once.
|
| The PLAYER never controls this.
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
| Determine B-I-N-G-O letter
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
| Create Bingo call
|--------------------------------------------------------------------------
|
| Example:
|
| {
|   number: 4,
|   letter: "B",
|   display: "B-4",
|   voiceText: "B, 4"
| }
|
|--------------------------------------------------------------------------
*/

function createCall(number) {

    const value =
        Number(number);

    const letter =
        getCallLetter(value);

    return {

        number:
            value,

        letter:
            letter,

        display:
            `${letter}-${value}`,

        /*
         * Frontend can pass this to
         * SpeechSynthesisUtterance.
         */

        voiceText:
            `${letter}, ${value}`,

        /*
         * Amharic voice text.
         *
         * The frontend may use this when
         * the player selected Amharic.
         */

        voiceTextAm:
            getAmharicVoiceText(
                letter,
                value
            )
    };
}


/*
|--------------------------------------------------------------------------
| Amharic voice text
|--------------------------------------------------------------------------
|
| We provide the text to the frontend.
| Actual speech voice depends on the
| player's device/browser.
|--------------------------------------------------------------------------
*/

function getAmharicVoiceText(
    letter,
    number
) {

    const amharicLetters = {
        B: "ቢ",
        I: "አይ",
        N: "ኤን",
        G: "ጂ",
        O: "ኦ"
    };

    const letterText =
        amharicLetters[letter] ||
        letter;

    return `${letterText} ${number}`;
}


/*
|--------------------------------------------------------------------------
| Create Bingo round
|--------------------------------------------------------------------------
*/

function createRound() {

    const now =
        Date.now();

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
         * Server-only random draw order.
         *
         * DO NOT send this to the browser.
         */

        drawOrder:
            generateDrawOrder(),

        drawIndex:
            0,

        drawnNumbers:
            [],

        calls:
            [],

        currentCall:
            null,

        players:
            {},

        winner:
            null,

        createdAt:
            new Date(now)
                .toISOString()
    };
}


/*
|--------------------------------------------------------------------------
| Can place bet
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
| Start automatic drawing
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
| SERVER ONLY.
|
| The player has no Draw button.
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


    /*
     * Create the complete call object.
     */

    const call =
        createCall(number);

    round.calls.push(
        call
    );

    round.currentCall =
        call;


    /*
     * This object is returned to server.js.
     *
     * server.js sends it to the frontend.
     *
     * The frontend then:
     *
     * 1. Displays B-4
     * 2. Animates the ball
     * 3. Speaks "B, 4"
     *
     */

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
| Create player state
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
         * FREE starts marked.
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
| Get player's Cartela
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
| Player manually marks a number
|--------------------------------------------------------------------------
|
| The frontend calls this when the player
| taps a number on their Cartela.
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
            WAITING_MESSAGE
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
     * FREE square is always marked.
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

            success:
                true,

            marked:
                true,

            free:
                true
        };
    }


    const cartela =
        getPlayerCartela(
            player
        );

    const value =
        cartela.card[row][column];


    /*
     * Player cannot mark a number
     * before it has been called.
     */

    if (
        !wasNumberCalled(
            round,
            value
        )
    ) {

        return {

            success:
                false,

            marked:
                false,

            error:
                "This number has not been called yet."
        };
    }


    const position =
        `${row}-${column}`;


    /*
     * If already marked,
     * allow the player to undo it.
     */

    const existingIndex =
        player.markedPositions
            .indexOf(position);


    if (
        existingIndex !== -1
    ) {

        player.markedPositions
            .splice(
                existingIndex,
                1
            );

        return {

            success:
                true,

            marked:
                false
        };
    }


    player.markedPositions
        .push(position);


    return {

        success:
            true,

        marked:
            true,

        number:
            value,

        position
    };
}


/*
|--------------------------------------------------------------------------
| Convert marked positions to Set
|--------------------------------------------------------------------------
*/

function markedPositionSet(
    markedPositions
) {

    if (
        !Array.isArray(
            markedPositions
        )
    ) {

        return new Set();
    }

    return new Set(
        markedPositions.map(
            position =>
                String(position)
        )
    );
}


/*
|--------------------------------------------------------------------------
| Check complete line
|--------------------------------------------------------------------------
*/

function lineIsComplete(
    positions,
    marked
) {

    return positions.every(
        position =>
            marked.has(position)
    );
}


/*
|--------------------------------------------------------------------------
| Find winning pattern
|--------------------------------------------------------------------------
*/

function getWinningPattern(
    player
) {

    const marked =
        markedPositionSet(
            player.markedPositions
        );


    /*
     * ROWS
     */

    for (
        let row = 0;
        row < 5;
        row++
    ) {

        const positions = [];

        for (
            let column = 0;
            column < 5;
            column++
        ) {

            positions.push(
                `${row}-${column}`
            );
        }

        if (
            lineIsComplete(
                positions,
                marked
            )
        ) {

            return {

                type:
                    "ROW",

                row,

                positions
            };
        }
    }


    /*
     * COLUMNS
     */

    for (
        let column = 0;
        column < 5;
        column++
    ) {

        const positions = [];

        for (
            let row = 0;
            row < 5;
            row++
        ) {

            positions.push(
                `${row}-${column}`
            );
        }

        if (
            lineIsComplete(
                positions,
                marked
            )
        ) {

            return {

                type:
                    "COLUMN",

                column,

                positions
            };
        }
    }


    /*
     * DIAGONAL 1
     */

    const diagonal1 = [];

    for (
        let i = 0;
        i < 5;
        i++
    ) {

        diagonal1.push(
            `${i}-${i}`
        );
    }

    if (
        lineIsComplete(
            diagonal1,
            marked
        )
    ) {

        return {

            type:
                "DIAGONAL",

            direction:
                "TOP_LEFT_TO_BOTTOM_RIGHT",

            positions:
                diagonal1
        };
    }


    /*
     * DIAGONAL 2
     */

    const diagonal2 = [];

    for (
        let i = 0;
        i < 5;
        i++
    ) {

        diagonal2.push(
            `${i}-${4 - i}`
        );
    }

    if (
        lineIsComplete(
            diagonal2,
            marked
        )
    ) {

        return {

            type:
                "DIAGONAL",

            direction:
                "TOP_RIGHT_TO_BOTTOM_LEFT",

            positions:
                diagonal2
        };
    }


    return null;
}


/*
|--------------------------------------------------------------------------
| Validate player's manual marks
|--------------------------------------------------------------------------
*/

function validateManualMarks(
    round,
    player
) {

    const cartela =
        getPlayerCartela(
            player
        );

    const marked =
        markedPositionSet(
            player.markedPositions
        );


    for (
        const position of marked
    ) {

        /*
         * FREE square.
         */

        if (
            position === "2-2"
        ) {
            continue;
        }


        const parts =
            position.split("-");


        if (
            parts.length !== 2
        ) {

            return {

                valid:
                    false,

                error:
                    "Invalid marked position"
            };
        }


        const row =
            Number(parts[0]);

        const column =
            Number(parts[1]);


        if (
            !Number.isInteger(row) ||
            !Number.isInteger(column) ||
            row < 0 ||
            row > 4 ||
            column < 0 ||
            column > 4
        ) {

            return {

                valid:
                    false,

                error:
                    "Invalid marked position"
            };
        }


        const value =
            cartela.card[row][column];


        if (
            value === "FREE"
        ) {
            continue;
        }


        if (
            !wasNumberCalled(
                round,
                value
            )
        ) {

            return {

                valid:
                    false,

                error:
                    `Number ${value} has not been called`
            };
        }
    }


    return {
        valid:
            true
    };
}


/*
|--------------------------------------------------------------------------
| Player presses BINGO
|--------------------------------------------------------------------------
*/

function claimBingo(
    round,
    player
) {

    if (!round) {

        throw new Error(
            "Bingo round not found"
        );
    }

    if (!player) {

        throw new Error(
            "Player not found"
        );
    }


    if (
        round.status !== "DRAWING"
    ) {

        throw new Error(
            WAITING_MESSAGE
        );
    }


    /*
     * Prevent duplicate claim.
     */

    if (
        player.bingoClaimed
    ) {

        return {

            success:
                false,

            valid:
                false,

            message:
                "BINGO has already been claimed."
        };
    }


    /*
     * Validate manual marks.
     */

    const marks =
        validateManualMarks(
            round,
            player
        );


    if (!marks.valid) {

        return {

            success:
                false,

            valid:
                false,

            message:
                "BINGO NOT VALID",

            error:
                marks.error
        };
    }


    /*
     * Find winning line.
     */

    const pattern =
        getWinningPattern(
            player
        );


    if (!pattern) {

        return {

            success:
                false,

            valid:
                false,

            message:
                "BINGO NOT VALID",

            error:
                "You have not completed a winning pattern."
        };
    }


    /*
     * VALID BINGO.
     */

    player.bingoClaimed =
        true;

    player.bingoResult = {

        valid:
            true,

        pattern,

        claimedAt:
            new Date()
                .toISOString()
    };


    /*
     * First valid claim.
     */

    if (!round.winner) {

        round.winner = {

            playerId:
                player.playerId,

            cartelaNumber:
                player.cartelaNumber,

            pattern,

            claimedAt:
                player.bingoResult
                    .claimedAt
        };
    }


    return {

        success:
            true,

        valid:
            true,

        message:
            "BINGO! YOU WIN",

        pattern,

        winner:
            round.winner
    };
}


/*
|--------------------------------------------------------------------------
| Finish round
|--------------------------------------------------------------------------
*/

function finishRound(round) {

    if (!round) {

        throw new Error(
            "Bingo round not found"
        );
    }

    round.status =
        "FINISHED";

    round.finishedAt =
        new Date()
            .toISOString();

    return round;
}


/*
|--------------------------------------------------------------------------
| Public round
|--------------------------------------------------------------------------
|
| NEVER expose drawOrder.
|--------------------------------------------------------------------------
*/

function publicRound(round) {

    if (!round) {
        return null;
    }

    return {

        game:
            round.game,

        status:
            round.status,

        bettingSeconds:
            round.bettingSeconds,

        bettingStartedAt:
            round.bettingStartedAt,

        bettingEndsAt:
            round.bettingEndsAt,

        totalCartelas:
            round.totalCartelas,

        minSlots:
            round.minSlots,

        defaultSlots:
            round.defaultSlots,

        maxSlots:
            round.maxSlots,

        waitingMessage:
            round.waitingMessage,

        waitingMessageAm:
            round.waitingMessageAm,

        drawnNumbers:
            [
                ...round.drawnNumbers
            ],

        calls:
            [
                ...round.calls
            ],

        currentCall:
            round.currentCall,

        drawIndex:
            round.drawIndex,

        createdAt:
            round.createdAt
    };
}


/*
|--------------------------------------------------------------------------
| Public Cartela
|--------------------------------------------------------------------------
*/

function publicCartela(
    cartelaNumber
) {

    const cartela =
        getCartela(
            cartelaNumber
        );

    return {

        number:
            cartela.number,

        card:
            cartela.card.map(
                row =>
                    [...row]
            ),

        columns:
            [...COLUMN_LETTERS]
    };
}


/*
|--------------------------------------------------------------------------
| Get player's marked card
|--------------------------------------------------------------------------
*/

function getPlayerCardState(
    player
) {

    if (!player) {

        throw new Error(
            "Player not found"
        );
    }

    const cartela =
        getCartela(
            player.cartelaNumber
        );

    const marked =
        markedPositionSet(
            player.markedPositions
        );


    const card =
        cartela.card.map(
            (
                row,
                rowIndex
            ) =>
                row.map(
                    (
                        value,
                        columnIndex
                    ) => {

                        const position =
                            `${rowIndex}-${columnIndex}`;

                        return {

                            value,

                            marked:
                                marked.has(
                                    position
                                ),

                            position
                        };
                    }
                )
        );


    return {

        cartelaNumber:
            player.cartelaNumber,

        card,

        bingoClaimed:
            player.bingoClaimed,

        bingoResult:
            player.bingoResult
    };
}


/*
|--------------------------------------------------------------------------
| EXPORTS
|--------------------------------------------------------------------------
*/

module.exports = {

    GAME_NAME,

    BINGO_SIZE,

    BINGO_NUMBERS,

    BETTING_SECONDS,

    TOTAL_CARTELAS,

    MIN_SLOTS,

    DEFAULT_SLOTS,

    MAX_SLOTS,

    COLUMN_RANGES,

    COLUMN_LETTERS,

    WAITING_MESSAGE,

    WAITING_MESSAGE_AM,

    generateCartela,

    generateAllCartelas,

    getCartela,

    getAvailableCartelas,

    validateCard,

    generateDrawOrder,

    getCallLetter,

    createCall,

    getAmharicVoiceText,

    createRound,

    canPlaceBet,

    startDrawing,

    drawNextNumber,

    wasNumberCalled,

    createPlayer,

    getPlayerCartela,

    markPosition,

    getWinningPattern,

    validateManualMarks,

    claimBingo,

    finishRound,

    publicRound,

    publicCartela,

    getPlayerCardState
};
