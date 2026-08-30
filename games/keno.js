"use strict";

const { uniqueNumbers } = require("../utils/random");

/*
|--------------------------------------------------------------------------
| DESTA PLAY - KENO
|--------------------------------------------------------------------------
*/

const GAME_NAME = "keno";

const KENO_MIN = 1;
const KENO_MAX = 80;

const MAX_PLAYER_SELECTIONS = 10;
const MAX_DRAWN_NUMBERS = 20;

const BETTING_SECONDS = 60;

/*
|--------------------------------------------------------------------------
| SLOT SETTINGS
|--------------------------------------------------------------------------
|
| Minimum = 1
| Default = 2
| Maximum = 2
|
*/

const MIN_SLOTS = 1;
const DEFAULT_SLOTS = 2;
const MAX_SLOTS = 2;

/*
|--------------------------------------------------------------------------
| DRAW SETTINGS
|--------------------------------------------------------------------------
|
| After betting closes, numbers can be drawn slowly.
|
| One number every 8 seconds.
|
*/

const DRAW_INTERVAL_SECONDS = 8;
const DRAW_INTERVAL_MS =
    DRAW_INTERVAL_SECONDS * 1000;

/*
|--------------------------------------------------------------------------
| VOICE SETTINGS
|--------------------------------------------------------------------------
|
| The frontend uses these values to speak:
|
| Round starting
|
| then only:
|
| 7
| 23
| 51
|
|--------------------------------------------------------------------------
*/

const VOICE_RATE = 0.70;

const ROUND_START_VOICE = "Round starting";

const WAITING_MESSAGE =
    "WAITING FOR NEXT ROUND";

const WAITING_MESSAGE_AM =
    "ቀጣዩን ዙር በመጠበቅ ላይ";


/*
|--------------------------------------------------------------------------
| VALIDATE SELECTION
|--------------------------------------------------------------------------
*/

function validateSelection(selection) {

    if (!Array.isArray(selection)) {

        throw new Error(
            "Selection must be an array"
        );
    }

    const numbers = [
        ...new Set(
            selection.map(Number)
        )
    ];

    if (numbers.length === 0) {

        throw new Error(
            "Select at least one number"
        );
    }

    if (
        numbers.length >
        MAX_PLAYER_SELECTIONS
    ) {

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

            throw new Error(
                "Keno numbers must be between 1 and 80"
            );
        }
    }

    return numbers.sort(
        (a, b) => a - b
    );
}


/*
|--------------------------------------------------------------------------
| CREATE 20-NUMBER DRAW
|--------------------------------------------------------------------------
*/

function createDraw() {

    return uniqueNumbers(
        KENO_MIN,
        KENO_MAX,
        MAX_DRAWN_NUMBERS
    );
}


/*
|--------------------------------------------------------------------------
| CALCULATE MATCHES
|--------------------------------------------------------------------------
*/

function calculateMatches(
    selection,
    drawnNumbers
) {

    const validSelection =
        validateSelection(
            selection
        );

    if (!Array.isArray(drawnNumbers)) {

        throw new Error(
            "Drawn numbers must be an array"
        );
    }

    return validSelection.filter(
        number =>
            drawnNumbers.includes(number)
    );
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
         * Betting.
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
         * Keno settings.
         */

        minNumber:
            KENO_MIN,

        maxNumber:
            KENO_MAX,

        maxSelections:
            MAX_PLAYER_SELECTIONS,

        maxDrawnNumbers:
            MAX_DRAWN_NUMBERS,

        /*
         * Slot settings.
         */

        minSlots:
            MIN_SLOTS,

        defaultSlots:
            DEFAULT_SLOTS,

        maxSlots:
            MAX_SLOTS,

        /*
         * Drawing settings.
         */

        drawIntervalSeconds:
            DRAW_INTERVAL_SECONDS,

        drawIntervalMs:
            DRAW_INTERVAL_MS,

        nextDrawAt:
            null,

        /*
         * Voice.

         * Frontend should say:
         *
         * "Round starting"
         *
         * and then only the number.
         */

        voiceRate:
            VOICE_RATE,

        roundStartVoice:
            ROUND_START_VOICE,

        /*
         * Waiting message.
         */

        waitingMessage:
            WAITING_MESSAGE,

        waitingMessageAm:
            WAITING_MESSAGE_AM,

        /*
         * Draw data.
         *
         * Keep drawOrder private.
         */

        drawOrder:
            [],

        drawIndex:
            0,

        drawnNumbers:
            [],

        currentNumber:
            null,

        /*
         * Players.
         */

        players:
            {},

        /*
         * Winner/result.
         */

        finishedAt:
            null,

        createdAt:
            new Date(now)
                .toISOString()
    };
}


/*
|--------------------------------------------------------------------------
| START ROUND DRAWING
|--------------------------------------------------------------------------
*/

function startDrawing(round) {

    if (!round) {

        throw new Error(
            "Keno round not found"
        );
    }

    if (
        round.status !==
        "BETTING"
    ) {

        throw new Error(
            "Keno round is not in betting state"
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

    /*
     * Generate the 20 numbers only
     * when drawing begins.
     */

    round.drawOrder =
        createDraw();

    round.drawIndex =
        0;

    round.drawnNumbers =
        [];

    round.currentNumber =
        null;

    round.status =
        "DRAWING";

    round.nextDrawAt =
        null;

    return round;
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

    if (
        round.status !==
        "BETTING"
    ) {

        return false;
    }

    if (
        Date.now() >=
        round.bettingEndsAt
    ) {

        return false;
    }

    return true;
}


/*
|--------------------------------------------------------------------------
| VALIDATE BET
|--------------------------------------------------------------------------
*/

function validateBet(
    round,
    selection
) {

    if (!round) {

        return {

            success:
                false,

            error:
                "Round not found"
        };
    }

    if (
        !canPlaceBet(round)
    ) {

        return {

            success:
                false,

            error:
                WAITING_MESSAGE,

            errorAm:
                WAITING_MESSAGE_AM
        };
    }

    try {

        const validSelection =
            validateSelection(
                selection
            );

        return {

            success:
                true,

            selection:
                validSelection
        };

    } catch (error) {

        return {

            success:
                false,

            error:
                error.message
        };
    }
}


/*
|--------------------------------------------------------------------------
| GET BETTING TIME REMAINING
|--------------------------------------------------------------------------
*/

function getBettingRemainingSeconds(
    round
) {

    if (!round) {
        return 0;
    }

    return Math.max(
        0,
        Math.ceil(
            (
                round.bettingEndsAt -
                Date.now()
            ) / 1000
        )
    );
}


/*
|--------------------------------------------------------------------------
| DRAW NEXT NUMBER
|--------------------------------------------------------------------------
|
| This draws ONE number.
|
| The frontend receives:
|
| {
|   number: 23,
|   voiceText: "23"
| }
|
| So the frontend speaks ONLY:
|
| "23"
|
|--------------------------------------------------------------------------
*/

function drawNextNumber(round) {

    if (!round) {

        throw new Error(
            "Keno round not found"
        );
    }

    /*
     * Automatically move from betting
     * into drawing when the timer reaches 0.
     */

    if (
        round.status ===
        "BETTING"
    ) {

        if (
            Date.now() <
            round.bettingEndsAt
        ) {

            throw new Error(
                "Betting is still open"
            );
        }

        startDrawing(round);
    }


    if (
        round.status !==
        "DRAWING"
    ) {

        throw new Error(
            "Keno is not currently drawing"
        );
    }


    const now =
        Date.now();


    /*
     * Respect the draw interval.
     */

    if (
        round.nextDrawAt !== null &&
        now <
        round.nextDrawAt
    ) {

        const remaining =
            Math.ceil(
                (
                    round.nextDrawAt -
                    now
                ) / 1000
            );

        throw new Error(
            `WAITING FOR NEXT NUMBER: ${remaining}s`
        );
    }


    /*
     * All 20 numbers have been drawn.
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

        return {

            finished:
                true,

            number:
                null,

            message:
                "Round finished"
        };
    }


    /*
     * Draw exactly ONE number.
     */

    const number =
        round.drawOrder[
            round.drawIndex
        ];

    round.drawIndex++;

    round.drawnNumbers.push(
        number
    );

    round.currentNumber =
        number;


    /*
     * Schedule next number.
     */

    round.nextDrawAt =
        now +
        DRAW_INTERVAL_MS;


    return {

        finished:
            false,

        number,

        /*
         * IMPORTANT:
         * frontend speaks ONLY this.
         */

        voiceText:
            String(number),

        voiceRate:
            VOICE_RATE,

        drawnCount:
            round.drawnNumbers.length,

        remainingDraws:
            MAX_DRAWN_NUMBERS -
            round.drawnNumbers.length,

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
| WAS NUMBER DRAWN?
|--------------------------------------------------------------------------
*/

function wasNumberDrawn(
    round,
    number
) {

    if (!round) {
        return false;
    }

    return round.drawnNumbers.includes(
        Number(number)
    );
}


/*
|--------------------------------------------------------------------------
| CREATE SLOT
|--------------------------------------------------------------------------
*/

function createSlot(
    slotNumber
) {

    const number =
        Number(slotNumber);

    if (
        !Number.isInteger(number)
    ) {

        throw new Error(
            "Slot number must be an integer"
        );
    }

    if (
        number < MIN_SLOTS ||
        number > MAX_SLOTS
    ) {

        throw new Error(
            `Keno supports ${MIN_SLOTS} to ${MAX_SLOTS} slots`
        );
    }

    return {

        slot:
            number,

        selection:
            [],

        betAmount:
            0,

        placed:
            false,

        result:
            null
    };
}


/*
|--------------------------------------------------------------------------
| DEFAULT TWO SLOTS
|--------------------------------------------------------------------------
*/

function createDefaultSlots() {

    const slots = [];

    for (
        let i = 1;
        i <= DEFAULT_SLOTS;
        i++
    ) {

        slots.push(
            createSlot(i)
        );
    }

    return slots;
}


/*
|--------------------------------------------------------------------------
| CHANGE SLOT COUNT
|--------------------------------------------------------------------------
*/

function setSlotCount(
    requestedCount
) {

    const count =
        Number(
            requestedCount
        );

    if (
        !Number.isInteger(count)
    ) {

        throw new Error(
            "Slot count must be an integer"
        );
    }

    if (
        count < MIN_SLOTS ||
        count > MAX_SLOTS
    ) {

        throw new Error(
            `Keno slot count must be between ${MIN_SLOTS} and ${MAX_SLOTS}`
        );
    }

    const slots = [];

    for (
        let i = 1;
        i <= count;
        i++
    ) {

        slots.push(
            createSlot(i)
        );
    }

    return slots;
}


/*
|--------------------------------------------------------------------------
| CALCULATE SLOT RESULT
|--------------------------------------------------------------------------
*/

function calculateSlotResult(
    slot,
    drawnNumbers
) {

    if (!slot) {

        throw new Error(
            "Slot not found"
        );
    }

    const selection =
        validateSelection(
            slot.selection
        );

    const matches =
        calculateMatches(
            selection,
            drawnNumbers
        );

    return {

        slot:
            slot.slot,

        selection,

        matches,

        matchCount:
            matches.length,

        drawnNumbers:
            [
                ...drawnNumbers
            ]
    };
}


/*
|--------------------------------------------------------------------------
| CREATE PLAYER RESULT
|--------------------------------------------------------------------------
*/

function createPlayerResult(
    slots,
    drawnNumbers
) {

    if (!Array.isArray(slots)) {

        throw new Error(
            "Slots must be an array"
        );
    }

    if (
        slots.length <
        MIN_SLOTS
    ) {

        throw new Error(
            "Player must have at least one slot"
        );
    }

    if (
        slots.length >
        MAX_SLOTS
    ) {

        throw new Error(
            `Player cannot have more than ${MAX_SLOTS} slots`
        );
    }

    return slots.map(
        slot =>
            calculateSlotResult(
                slot,
                drawnNumbers
            )
    );
}


/*
|--------------------------------------------------------------------------
| FINISH ROUND
|--------------------------------------------------------------------------
*/

function finishRound(round) {

    /*
     * Compatibility with your
     * existing server:
     *
     * keno.finishRound()
     */

    if (!round) {

        const drawnNumbers =
            createDraw();

        return {

            status:
                "FINISHED",

            drawnNumbers,

            finishedAt:
                new Date()
                    .toISOString()
        };
    }


    /*
     * Already finished.
     */

    if (
        round.status ===
        "FINISHED"
    ) {

        return round;
    }


    /*
     * Betting cannot be finished
     * before the timer expires.
     */

    if (
        round.status ===
        "BETTING" &&
        Date.now() <
        round.bettingEndsAt
    ) {

        throw new Error(
            "Betting period has not ended"
        );
    }


    /*
     * If drawing hasn't started,
     * generate the complete draw.
     */

    if (
        round.drawnNumbers.length === 0
    ) {

        round.drawOrder =
            createDraw();

        round.drawnNumbers =
            [
                ...round.drawOrder
            ];

        round.drawIndex =
            round.drawOrder.length;
    }


    round.status =
        "FINISHED";

    round.currentNumber =
        round.drawnNumbers[
            round.drawnNumbers.length - 1
        ];

    round.finishedAt =
        new Date()
            .toISOString();

    return round;
}


/*
|--------------------------------------------------------------------------
| ROUND STATUS
|--------------------------------------------------------------------------
*/

function getRoundStatus(
    round
) {

    if (!round) {

        return {

            status:
                "UNKNOWN"
        };
    }


    if (
        round.status ===
        "BETTING"
    ) {

        const remaining =
            getBettingRemainingSeconds(
                round
            );


        if (
            remaining <= 0
        ) {

            return {

                status:
                    "WAITING_FOR_NEXT_ROUND",

                remainingSeconds:
                    0,

                message:
                    WAITING_MESSAGE,

                messageAm:
                    WAITING_MESSAGE_AM
            };
        }


        return {

            status:
                "BETTING",

            remainingSeconds:
                remaining
        };
    }


    if (
        round.status ===
        "DRAWING"
    ) {

        let remaining =
            0;


        if (
            round.nextDrawAt !== null
        ) {

            remaining =
                Math.max(
                    0,
                    Math.ceil(
                        (
                            round.nextDrawAt -
                            Date.now()
                        ) / 1000
                    )
                );
        }


        return {

            status:
                "DRAWING",

            remainingSeconds:
                remaining
        };
    }


    return {

        status:
            round.status,

        remainingSeconds:
            0
    };
}


/*
|--------------------------------------------------------------------------
| PUBLIC ROUND
|--------------------------------------------------------------------------
|
| Never expose drawOrder.
|--------------------------------------------------------------------------
*/

function publicRound(
    round
) {

    if (!round) {
        return null;
    }


    const status =
        getRoundStatus(
            round
        );


    return {

        game:
            round.game,

        status:
            status.status,

        bettingSeconds:
            round.bettingSeconds,

        bettingStartedAt:
            round.bettingStartedAt,

        bettingEndsAt:
            round.bettingEndsAt,

        remainingSeconds:
            status.remainingSeconds ??
            0,

        minNumber:
            round.minNumber,

        maxNumber:
            round.maxNumber,

        maxSelections:
            round.maxSelections,

        maxDrawnNumbers:
            round.maxDrawnNumbers,

        /*
         * Slots.
         */

        minSlots:
            round.minSlots,

        defaultSlots:
            round.defaultSlots,

        maxSlots:
            round.maxSlots,

        /*
         * Drawing.
         */

        drawIntervalSeconds:
            round.drawIntervalSeconds,

        nextDrawAt:
            round.nextDrawAt,

        drawnNumbers:
            [
                ...round.drawnNumbers
            ],

        currentNumber:
            round.currentNumber,

        drawnCount:
            round.drawnNumbers.length,

        remainingDraws:
            Math.max(
                0,
                MAX_DRAWN_NUMBERS -
                round.drawnNumbers.length
            ),

        /*
         * Voice.
         */

        voiceRate:
            round.voiceRate,

        roundStartVoice:
            round.roundStartVoice,

        /*
         * Waiting.
         */

        waitingMessage:
            round.waitingMessage,

        waitingMessageAm:
            round.waitingMessageAm,

        createdAt:
            round.createdAt,

        finishedAt:
            round.finishedAt
    };
}


/*
|--------------------------------------------------------------------------
| EXPORTS
|--------------------------------------------------------------------------
*/

module.exports = {

    GAME_NAME,

    KENO_MIN,

    KENO_MAX,

    MAX_PLAYER_SELECTIONS,

    MAX_DRAWN_NUMBERS,

    BETTING_SECONDS,

    MIN_SLOTS,

    DEFAULT_SLOTS,

    MAX_SLOTS,

    DRAW_INTERVAL_SECONDS,

    DRAW_INTERVAL_MS,

    VOICE_RATE,

    ROUND_START_VOICE,

    WAITING_MESSAGE,

    WAITING_MESSAGE_AM,

    validateSelection,

    createDraw,

    calculateMatches,

    createRound,

    startDrawing,

    canPlaceBet,

    validateBet,

    getBettingRemainingSeconds,

    drawNextNumber,

    wasNumberDrawn,

    createSlot,

    createDefaultSlots,

    setSlotCount,

    calculateSlotResult,

    createPlayerResult,

    finishRound,

    getRoundStatus,

    publicRound
};
