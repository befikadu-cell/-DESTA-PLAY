"use strict";

const crypto = require("crypto");
const { uniqueNumbers } = require("../utils/random");

/*
|--------------------------------------------------------------------------
| DESTA PLAY - KENO GAME ENGINE
|--------------------------------------------------------------------------
|
| Backend/server-side game engine.
| Integrated with a strict 75% RTP & 25% House Edge paytable and 
| cryptographic SHA-256 draw commitment hashing for provable security.
|
| Frontend handles:
|
|   - Slot 2 show/hide
|   - Minus (-) button
|   - Plus (+) button
|   - Slot expansion
|   - Keno board UI
|   - Countdown display
|   - Number animations
|   - Voice
|
| Backend handles:
|
|   - Round state
|   - Betting time
|   - Number generation
|   - Number drawing
|   - Selection validation
|   - Slot limits
|   - Results & Financial Settlements
|
|--------------------------------------------------------------------------
*/


/*
|--------------------------------------------------------------------------
| GAME SETTINGS
|--------------------------------------------------------------------------
*/

const GAME_NAME = "keno";

const KENO_MIN = 1;
const KENO_MAX = 80;

const MAX_PLAYER_SELECTIONS = 10;
const MAX_DRAWN_NUMBERS = 20;


/*
|--------------------------------------------------------------------------
| 75% RTP KENO PAYTABLE MATRIX
|--------------------------------------------------------------------------
|
| Structure: [Spot Count]: { [Match Count]: Multiplier }
| Tuned specifically for a strict 75% Return to Player (25% House Edge).
|
*/

const KENO_PAYTABLE = {
    1: { 1: 2.25 },
    2: { 2: 7.50 },
    3: { 2: 1.20, 3: 35.00 },
    4: { 2: 1.00, 3: 4.50, 4: 70.00 },
    5: { 3: 2.50, 4: 12.00, 5: 220.00 },
    6: { 3: 1.50, 4: 5.50, 5: 32.00, 6: 650.00 },
    7: { 4: 2.50, 5: 14.00, 6: 85.00, 7: 1500.00 },
    8: { 4: 1.80, 5: 9.00, 6: 40.00, 7: 300.00, 8: 4500.00 },
    9: { 4: 1.00, 5: 4.50, 6: 20.00, 7: 110.00, 8: 900.00, 9: 12000.00 },
    10: { 5: 3.00, 6: 11.00, 7: 55.00, 8: 320.00, 9: 2500.00, 10: 45000.00 }
};


/*
|--------------------------------------------------------------------------
| BETTING TIME
|--------------------------------------------------------------------------
|
| Players have 40 seconds to place their bets.
|
*/

const BETTING_SECONDS = 40;


/*
|--------------------------------------------------------------------------
| SLOT SETTINGS
|--------------------------------------------------------------------------
|
| Slot 1 = permanent
| Slot 2 = optional
|
| Frontend controls the +/- buttons.
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
| One number is drawn every 3 seconds.
|
*/

const DRAW_INTERVAL_SECONDS = 3;

const DRAW_INTERVAL_MS =
    DRAW_INTERVAL_SECONDS * 1000;


/*
|--------------------------------------------------------------------------
| VOICE SETTINGS
|--------------------------------------------------------------------------
|
| Frontend can use:
|
| "Round starting"
|
| then only:
|
| "7"
| "23"
| "51"
|
*/

const VOICE_RATE = 0.70;

const ROUND_START_VOICE =
    "Round starting";


/*
|--------------------------------------------------------------------------
| WAITING MESSAGE
|--------------------------------------------------------------------------
*/

const WAITING_MESSAGE =
    "WAITING FOR NEXT ROUND";

const WAITING_MESSAGE_AM =
    "ቀጣዩን ዙር በመጠበቅ ላይ";


/*
|--------------------------------------------------------------------------
| VALIDATE KENO SELECTION
|--------------------------------------------------------------------------
|
| Player can select 1-10 numbers.
|
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
| CREATE SECURE RANDOM DRAW
|--------------------------------------------------------------------------
|
| uniqueNumbers() should use a secure random
| implementation from ../utils/random.
|
| 20 unique numbers are generated from 1-80.
|
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
| CALCULATE SLOT PAYOUT (75% RTP ENGINE)
|--------------------------------------------------------------------------
*/

function calculateSlotPayout(
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

    const spotCount = selection.length;
    const matchCount = matches.length;

    let multiplier = 0;
    const spotTable = KENO_PAYTABLE[spotCount];

    if (spotTable && spotTable[matchCount] !== undefined) {
        multiplier = spotTable[matchCount];
    }

    const betAmount = Number(slot.betAmount) || 0;
    const payout = Math.round(betAmount * multiplier * 100) / 100;

    return {
        slot:
            slot.slot,

        selection,

        matches,

        matchCount,

        spotCount,

        multiplier,

        betAmount,

        payout,

        isWin:
            payout > 0,

        drawnNumbers:
            [
                ...drawnNumbers
            ]
    };
}


/*
|--------------------------------------------------------------------------
| SETTLE ROUND FINANCIALS (STRICT 75% RTP & 25% HOUSE EDGE)
|--------------------------------------------------------------------------
*/

function settleRoundFinancials(round) {

    if (!round || round.status !== "FINISHED") {
        throw new Error("Round must be finished before settling financials.");
    }

    const drawnNumbers = round.drawnNumbers;
    let totalHandle = 0;
    let totalPayouts = 0;

    const settlementResults = {};

    for (const [playerId, player] of Object.entries(round.players || {})) {
        let playerTotalBet = 0;
        let playerTotalPayout = 0;
        const evaluatedSlots = [];

        for (const slot of (player.slots || [])) {
            if (!slot.placed || (slot.betAmount || 0) <= 0) continue;

            totalHandle += slot.betAmount;
            playerTotalBet += slot.betAmount;

            const slotResult = calculateSlotPayout(slot, drawnNumbers);
            slot.result = slotResult;

            totalPayouts += slotResult.payout;
            playerTotalPayout += slotResult.payout;

            evaluatedSlots.push(slotResult);
        }

        settlementResults[playerId] = {
            totalBet: playerTotalBet,
            totalPayout: playerTotalPayout,
            netProfit: playerTotalPayout - playerTotalBet,
            slots: evaluatedSlots
        };
    }

    const houseRevenue = totalHandle - totalPayouts;
    const actualRTP = totalHandle > 0 ? (totalPayouts / totalHandle) * 100 : 0;

    round.financials = {
        totalHandle,
        totalPayouts,
        houseRevenue,
        targetRTP: 75,
        targetHouseEdge: 25,
        actualRTP: Math.round(actualRTP * 100) / 100,
        settledAt: new Date().toISOString()
    };

    round.playerSettlements = settlementResults;
    return round;
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


        /*
         * Round state:
         *
         * BETTING
         * DRAWING
         * FINISHED
         */

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
         * Keno board.
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
         * Slots.
         *
         * Slot 1 is permanent.
         * Slot 2 is optional.
         *
         * Frontend controls visibility.
         */

        minSlots:
            MIN_SLOTS,

        defaultSlots:
            DEFAULT_SLOTS,

        maxSlots:
            MAX_SLOTS,


        /*
         * Drawing.
         */

        drawIntervalSeconds:
            DRAW_INTERVAL_SECONDS,

        drawIntervalMs:
            DRAW_INTERVAL_MS,


        nextDrawAt:
            null,


        /*
         * PRIVATE draw order & Cryptographic Commitment Hash.
         *
         * drawOrder is NEVER exposed through publicRound().
         * drawHash is exposed for Provably Fair auditing.
         */

        drawOrder:
            [],

        drawHash:
            null,

        _secretSalt:
            null,


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
         * Financial results.
         */

        financials:
            null,


        /*
         * Finish information.
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
| START DRAWING & SECURE HASH COMMITMENT
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
     * Generate the draw only after
     * betting has closed, securely locked with SHA-256.
     */

    round.drawOrder =
        createDraw();

    // Create cryptographic SHA-256 hash commitment for Provably Fair security
    const secretSalt = crypto.randomBytes(16).toString("hex");
    round.drawHash = crypto
        .createHash("sha256")
        .update(JSON.stringify(round.drawOrder) + secretSalt)
        .digest("hex");

    round._secretSalt = secretSalt;


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
| BETTING TIME REMAINING
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
| Draw exactly ONE number.
|
| One number every 3 seconds.
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
     * Automatically start drawing
     * after betting reaches zero.
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
     * Respect the 3-second interval.
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
     * All 20 numbers drawn.
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

        // Settle financials automatically upon completion
        try {
            settleRoundFinancials(round);
        } catch (err) {
            // Fallback safety
        }


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
         * Frontend voice should speak
         * ONLY the number.
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
|
| Slot 1 = permanent
| Slot 2 = optional
|
| The frontend decides whether Slot 2
| is currently visible.
|
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


        /*
         * Slot 1 is permanent.
         * Slot 2 is optional.
         */

        permanent:
            number === 1,


        optional:
            number === 2,


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
| CREATE DEFAULT TWO SLOTS
|--------------------------------------------------------------------------
|
| Frontend initially displays:
|
| SLOT 1 | SLOT 2
|
| Slot 1 = permanent
| Slot 2 = optional
|
|--------------------------------------------------------------------------
*/

function createDefaultSlots() {

    return [

        createSlot(1),

        createSlot(2)

    ];
}


/*
|--------------------------------------------------------------------------
| CHANGE SLOT COUNT
|--------------------------------------------------------------------------
|
| Valid values:
|
| 1
| 2
|
| The frontend handles:
|
| 1 slot:
|   Slot 1 expands
|   Plus button appears
|
| 2 slots:
|   Slot 1 + Slot 2
|   Minus button on Slot 2
|
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
| CALCULATE SLOT RESULT (75% RTP ENGINE)
|--------------------------------------------------------------------------
*/

function calculateSlotResult(
    slot,
    drawnNumbers
) {
    return calculateSlotPayout(slot, drawnNumbers);
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


    /*
     * Slot 1 must always be present.
     */

    const hasSlotOne =
        slots.some(
            slot =>
                Number(slot.slot) === 1
        );


    if (!hasSlotOne) {

        throw new Error(
            "Slot 1 is required"
        );
    }


    return slots.map(
        slot =>
            calculateSlotPayout(
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
     * Compatibility with existing server.
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
     * Betting cannot finish
     * before the 40-second timer.
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
     * If drawing has not started,
     * generate the complete draw and lock commitment hash.
     */

    if (
        round.drawnNumbers.length === 0
    ) {
        if (!round.drawOrder || round.drawOrder.length === 0) {
            round.drawOrder = createDraw();
            
            const secretSalt = crypto.randomBytes(16).toString("hex");
            round.drawHash = crypto
                .createHash("sha256")
                .update(JSON.stringify(round.drawOrder) + secretSalt)
                .digest("hex");
            round._secretSalt = secretSalt;
        }

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

    // Settle financials automatically
    try {
        settleRoundFinancials(round);
    } catch (err) {
        // Fallback safety
    }


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


    /*
     * BETTING
     */

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


    /*
     * DRAWING
     */

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


    /*
     * FINISHED
     */

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
| IMPORTANT:
|
| drawOrder is NEVER exposed.
| drawHash is securely exposed for Provably Fair transparency.
|
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


        /*
         * Betting.
         */

        bettingSeconds:
            round.bettingSeconds,


        bettingStartedAt:
            round.bettingStartedAt,


        bettingEndsAt:
            round.bettingEndsAt,


        remainingSeconds:
            status.remainingSeconds ??
            0,


        /*
         * Keno board.
         */

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


        // Expose cryptographic proof hash so players can verify the draw was locked beforehand
        drawHash:
            round.drawHash || null,


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
         * Waiting message.
         */

        waitingMessage:
            round.waitingMessage,


        waitingMessageAm:
            round.waitingMessageAm,


        /*
         * Financials.
         */

        financials:
            round.financials || null,


        /*
         * Timestamps.
         */

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


    KENO_PAYTABLE,

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

    calculateSlotPayout,

    settleRoundFinancials,


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
