"use strict";

const crypto = require("node:crypto");
const { shuffle } = require("../utils/random");

/*
|--------------------------------------------------------------------------
| DESTA PLAY — BINGO GAME ENGINE
|--------------------------------------------------------------------------
|
| 75-BALL BINGO
|
| B = 1 - 15
| I = 16 - 30
| N = 31 - 45
| G = 46 - 60
| O = 61 - 75
|
|--------------------------------------------------------------------------
*/

/* =========================
   GAME SETTINGS
========================= */

const GAME_NAME = "bingo";

const BINGO_SIZE = 5;
const BINGO_NUMBERS = 75;

/*
 * Players have 30 seconds to enter
 * before the first number is called.
 */
const BETTING_SECONDS = 30;

/*
 * One Bingo number every 3 seconds.
 */
const DRAW_INTERVAL_SECONDS = 3;
const DRAW_INTERVAL_MS = DRAW_INTERVAL_SECONDS * 1000;

/*
 * Voice speed used by the frontend.
 */
const SPEECH_RATE = 0.75;

/*
 * Fixed Cartelas.
 */
const TOTAL_CARTELAS = 120;

/* =========================
   SLOT SETTINGS
========================= */

const MIN_SLOTS = 1;
const DEFAULT_SLOTS = 2;
const MAX_SLOTS = 2;

/* =========================
   MESSAGES
========================= */

const WAITING_MESSAGE = "WAITING FOR NEXT ROUND";
const WAITING_MESSAGE_AM = "ቀጣዩን ዙር በመጠበቅ ላይ";

/* =========================
   B-I-N-G-O RANGES
========================= */

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
| SEEDED RANDOM
|--------------------------------------------------------------------------
|
| Every Cartela number produces the same card every time.
|
| Cartela #1 -> permanent configuration
| Cartela #2 -> permanent configuration
| ...
| Cartela #120 -> permanent configuration
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
            ((t ^ (t >>> 14)) >>> 0) /
            4294967296
        );
    };
}

/*
|--------------------------------------------------------------------------
| CARTELA SEED
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
| SEEDED SHUFFLE
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
| GENERATE COLUMN
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
| VALIDATE CARTELA NUMBER
|--------------------------------------------------------------------------
*/

function validateCartelaNumber(cartelaNumber) {

    const number = Number(cartelaNumber);

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
| GENERATE ONE CARTELA
|--------------------------------------------------------------------------
|
| Returned structure:
|
| card[row][column]
|
|       B     I     N     G     O
|       ↓     ↓     ↓     ↓     ↓
|
| row 1
| row 2
| row 3       FREE
| row 4
| row 5
|
|--------------------------------------------------------------------------
*/

function generateCartela(cartelaNumber) {

    const number =
        validateCartelaNumber(cartelaNumber);

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
     * Generate all five columns.
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

        /*
         * N has four numbers because
         * the center is FREE.
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

        /*
         * N column.
         */

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

        }

        /*
         * B, I, G and O.
         */

        else {

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
| VALIDATE CARTELA
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
     * Validate every column.
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
         * No duplicate numbers
         * within a column.
         */

        if (
            new Set(values).size !==
            values.length
        ) {

            return false;
        }
    }

    /*
     * No duplicate numbers anywhere
     * on the Cartela.
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
| GENERATE ALL 120 CARTELAS
|--------------------------------------------------------------------------
*/

function generateAllCartelas() {

    const cartelas = {};
    const signatures = new Set();

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
                `Invalid Cartela #${number}`
            );
        }

        const signature =
            JSON.stringify(
                cartela.card
            );

        if (
            signatures.has(signature)
        ) {

            throw new Error(
                `Duplicate Cartela configuration detected: #${number}`
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
| PERMANENT CARTELA COLLECTION
|--------------------------------------------------------------------------
*/

const CARTELAS =
    generateAllCartelas();

/*
|--------------------------------------------------------------------------
| GET ONE CARTELA
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
| GET AVAILABLE CARTELAS
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
| GENERATE DRAW ORDER
|--------------------------------------------------------------------------
|
| Every number 1-75 appears exactly once.
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
| GET B-I-N-G-O LETTER
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
| AMHARIC LETTER
|--------------------------------------------------------------------------
*/

function getAmharicLetter(letter) {

    const letters = {

        B: "ቢ",
        I: "አይ",
        N: "ኤን",
        G: "ጂ",
        O: "ኦ"

    };

    return (
        letters[letter] ||
        letter
    );
}

/*
|--------------------------------------------------------------------------
| CREATE NUMBER CALL
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

        voiceText:
            `${letter}, ${value}`,

        voiceTextAm:
            `${getAmharicLetter(letter)} ${value}`,

        speechRate:
            SPEECH_RATE
    };
}

/*
|--------------------------------------------------------------------------
| CREATE ROUND
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

        /*
         * 30-second betting period.
         */

        bettingSeconds:
            BETTING_SECONDS,

        bettingStartedAt:
            new Date(now)
                .toISOString(),

        bettingEndsAt:
            now +
            BETTING_SECONDS * 1000,

        /*
         * 3-second draw interval.
         */

        drawIntervalSeconds:
            DRAW_INTERVAL_SECONDS,

        drawIntervalMs:
            DRAW_INTERVAL_MS,

        nextDrawAt:
            null,

        /*
         * Cartelas.
         */

        totalCartelas:
            TOTAL_CARTELAS,

        /*
         * Slots.
         */

        minSlots:
            MIN_SLOTS,

        defaultSlots:
            DEFAULT_SLOTS,

        maxSlots:
            MAX_SLOTS,

        /*
         * Waiting messages.
         */

        waitingMessage:
            WAITING_MESSAGE,

        waitingMessageAm:
            WAITING_MESSAGE_AM,

        /*
         * Private draw order.
         *
         * Never expose this directly
         * to the client.
         */

        drawOrder:
            generateDrawOrder(),

        drawIndex:
            0,

        /*
         * Public history.
         */

        drawnNumbers:
            [],

        calls:
            [],

        currentCall:
            null,

        /*
         * Players.
         */

        players:
            {},

        /*
         * Winner.
         */

        winner:
            null,

        createdAt:
            new Date(now)
                .toISOString()
    };
}

/*
|--------------------------------------------------------------------------
| CAN PLACE BET
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
| START DRAWING
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
        new Date()
            .toISOString();

    round.nextDrawAt =
        null;

    return round;
}

/*
|--------------------------------------------------------------------------
| DRAW NEXT NUMBER
|--------------------------------------------------------------------------
|
| Server calls one number every 3 seconds.
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

    const now =
        Date.now();

    /*
     * Enforce 3-second interval.
     */

    if (
        round.nextDrawAt !== null &&
        now < round.nextDrawAt
    ) {

        const remainingSeconds =
            Math.ceil(
                (
                    round.nextDrawAt -
                    now
                ) / 1000
            );

        throw new Error(
            `WAITING FOR NEXT NUMBER: ${remainingSeconds}s`
        );
    }

    /*
     * All 75 numbers have been drawn.
     */

    if (
        round.drawIndex >=
        round.drawOrder.length
    ) {

        round.status =
            "FINISHED";

        round.finishedAt =
            new Date()
                .toISOString();

        throw new Error(
            "All Bingo numbers have been drawn"
        );
    }

    /*
     * Draw exactly one number.
     */

    const number =
        round.drawOrder[
            round.drawIndex
        ];

    round.drawIndex++;

    round.drawnNumbers.push(
        number
    );

    /*
     * Create B-I-N-G-O call.
     */

    const call =
        createCall(number);

    round.calls.push(
        call
    );

    round.currentCall =
        call;

    /*
     * Next call in exactly 3 seconds.
     */

    round.nextDrawAt =
        now +
        DRAW_INTERVAL_MS;

    return {

        ...call,

        nextDrawAt:
            new Date(
                round.nextDrawAt
            ).toISOString(),

        waitSeconds:
            DRAW_INTERVAL_SECONDS
    };
}

/*
|--------------------------------------------------------------------------
| CHECK WHETHER NUMBER WAS CALLED
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
| CREATE PLAYER
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

        playerId:
            String(playerId),

        cartelaNumber:
            cartela.number,

        /*
         * FREE center is automatically
         * marked.
         */

        markedPositions:
            ["2-2"],

        bingoClaimed:
            false,

        bingoResult:
            null
    };
}

/*
|--------------------------------------------------------------------------
| GET PLAYER CARTELA
|--------------------------------------------------------------------------
*/

function getPlayerCartela(player) {

    if (!player) {
        return null;
    }

    return getCartela(
        player.cartelaNumber
    );
}

/*
|--------------------------------------------------------------------------
| MARK NUMBER
|--------------------------------------------------------------------------
|
| Player taps a number on their card.
|
| A number can only be marked after
| the server has called it.
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
     * FREE center.
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
     * Cannot mark an uncalled number.
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

    const existingIndex =
        player.markedPositions
            .indexOf(position);

    /*
     * Tap again to unmark.
     */

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
                false,

            number:
                value,

            position
        };
    }

    /*
     * Mark number.
     */

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
| MARKED POSITION SET
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
| CHECK LINE
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
| FIND WINNING PATTERN
|--------------------------------------------------------------------------
|
| A Bingo is valid when:
|
| 1. Any complete row
| 2. Any complete column
| 3. Main diagonal
| 4. Reverse diagonal
|--------------------------------------------------------------------------
*/

function getWinningPattern(player) {

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
     * MAIN DIAGONAL
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
     * REVERSE DIAGONAL
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
| VALIDATE MANUAL MARKS
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
         * FREE center is valid.
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

        /*
         * Mark must correspond to a
         * number that was actually called.
         */

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
| CLAIM BINGO
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
     * Prevent duplicate claims.
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
     * Validate every mark.
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
     * Find winning pattern.
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
     * Valid Bingo.
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
     * First valid Bingo claim
     * becomes the round winner.
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
| FINISH ROUND
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
| PUBLIC ROUND
|--------------------------------------------------------------------------
|
| IMPORTANT:
| drawOrder is NEVER exposed.
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

        drawIntervalSeconds:
            round.drawIntervalSeconds,

        nextDrawAt:
            round.nextDrawAt,

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
| PUBLIC CARTELA
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
| GET PLAYER CARD STATE
|--------------------------------------------------------------------------
*/

function getPlayerCardState(player) {

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

    DRAW_INTERVAL_SECONDS,

    DRAW_INTERVAL_MS,

    SPEECH_RATE,

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

    validateCartelaNumber,

    validateCard,

    generateDrawOrder,

    getCallLetter,

    getAmharicLetter,

    createCall,

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
