"use strict";

import crypto from "node:crypto";

/*
|--------------------------------------------------------------------------
| DESTA PLAY - ROULETTE GAME ENGINE (SECURE 80% RTP / 20% HOUSE EDGE)
|--------------------------------------------------------------------------
|
| EUROPEAN ROULETTE
|
| Numbers: 0 - 36
|
| IMPORTANT:
| The roulette result is generated SERVER-SIDE using crypto.randomInt().
| The frontend must NEVER generate or submit the result.
|
| Financial Configuration:
| Target RTP: 80% | House Edge: 20%
| Minimum Bet: 10 ETB
|
|--------------------------------------------------------------------------
*/


/* =========================
   GAME SETTINGS
========================= */

export const GAME_NAME = "roulette";

/*
 * Players have 40 seconds to place bets.
 */
export const BETTING_SECONDS = 40;

/*
 * Minimum Bet Amount (ETB)
 */
export const MIN_BET_AMOUNT = 10;

/*
 * Financial Targets
 */
export const TARGET_RTP_PERCENTAGE = 80;
export const HOUSE_EDGE_PERCENTAGE = 20;


/* =========================
   SLOT SETTINGS
========================= */

/*
 * Slot 1 is permanent.
 *
 * Slot 2 is optional.
 *
 * Frontend behavior:
 *
 * SLOT 1:
 *   always visible
 *
 * SLOT 2:
 *   visible by default
 *   has MINUS button
 *
 * When player removes Slot 2:
 *
 *   Slot 1 expands
 *   Slot 2 disappears
 *   PLUS button appears on Slot 1
 *
 * When player presses PLUS:
 *
 *   Slot 2 returns
 *   both slots become visible
 */

export const MIN_SLOTS = 1;
export const DEFAULT_SLOTS = 2;
export const MAX_SLOTS = 2;


/* =========================
   WHEEL
========================= */

export const WHEEL = Object.freeze(
    Array.from(
        { length: 37 },
        (_, i) => i
    )
);


/* =========================
   COLORS
========================= */

export const RED_NUMBERS = new Set([
    1, 3, 5, 7, 9,
    12, 14, 16, 18,
    19, 21, 23, 25, 27,
    30, 32, 34, 36
]);

export const BLACK_NUMBERS = new Set([
    2, 4, 6, 8, 10,
    11, 13, 15, 17,
    20, 22, 24, 26,
    28, 29, 31, 33, 35
]);


/* =========================
   PAYOUTS (Scaled for 80% RTP structure)
========================= */

export const PAYOUTS = Object.freeze({

    straight: 28.8,

    split: 14.4,

    street: 9.333333,

    corner: 6.6,

    sixLine: 4.333333,

    dozen: 1.666667,

    column: 1.666667,

    evenMoney: 0.8
});


/* =========================
   BET TYPES
========================= */

export const ALLOWED_BET_TYPES = Object.freeze([
    "straight",
    "red",
    "black",
    "odd",
    "even",
    "low",
    "high",
    "dozen",
    "column"
]);


/* =========================
   RANDOM NUMBER (SECURE DRAW)
========================= */

/*
 * CRITICAL SECURITY POINT
 *
 * crypto.randomInt() runs on the server.
 *
 * Do NOT replace this with:
 *
 * Math.random()
 *
 * Do NOT accept a number supplied
 * by the frontend.
 */

export function randomNumber() {

    return crypto.randomInt(
        0,
        37
    );
}


/* =========================
   RESULT INFORMATION
========================= */

export function getColor(number) {

    const value = Number(number);

    if (value === 0) {
        return "green";
    }

    if (RED_NUMBERS.has(value)) {
        return "red";
    }

    if (BLACK_NUMBERS.has(value)) {
        return "black";
    }

    throw new Error(
        "Invalid roulette number"
    );
}


export function getParity(number) {

    const value = Number(number);

    if (value === 0) {
        return null;
    }

    return value % 2 === 0
        ? "even"
        : "odd";
}


export function isLow(number) {

    const value = Number(number);

    return (
        value >= 1 &&
        value <= 18
    );
}


export function isHigh(number) {

    const value = Number(number);

    return (
        value >= 19 &&
        value <= 36
    );
}


export function isDozen(
    number,
    dozen
) {

    const value = Number(number);

    if (value === 0) {
        return false;
    }

    if (dozen === 1) {

        return (
            value >= 1 &&
            value <= 12
        );
    }

    if (dozen === 2) {

        return (
            value >= 13 &&
            value <= 24
        );
    }

    if (dozen === 3) {

        return (
            value >= 25 &&
            value <= 36
        );
    }

    return false;
}


export function isColumn(
    number,
    column
) {

    const value = Number(number);

    if (
        value === 0
    ) {
        return false;
    }

    if (
        ![1, 2, 3].includes(
            Number(column)
        )
    ) {
        return false;
    }

    return (
        (value - Number(column)) % 3 === 0
    );
}


/* =========================
   VALIDATE BET
========================= */

export function validateBet(bet) {

    if (
        !bet ||
        typeof bet !== "object" ||
        Array.isArray(bet)
    ) {

        throw new Error(
            "Invalid roulette bet"
        );
    }


    const amount =
        Number(bet.amount);


    if (
        !Number.isFinite(amount) ||
        amount < MIN_BET_AMOUNT
    ) {

        throw new Error(
            `Minimum bet amount is ${MIN_BET_AMOUNT} ETB`
        );
    }


    if (
        !Number.isInteger(amount)
    ) {

        throw new Error(
            "Bet amount must be a whole number"
        );
    }


    if (
        !ALLOWED_BET_TYPES.includes(
            bet.type
        )
    ) {

        throw new Error(
            "Unsupported roulette bet"
        );
    }


    /*
     * Straight.
     */

    if (
        bet.type === "straight"
    ) {

        const number =
            Number(bet.number);

        if (
            !Number.isInteger(number) ||
            number < 0 ||
            number > 36
        ) {

            throw new Error(
                "Straight bet must be between 0 and 36"
            );
        }
    }


    /*
     * Dozen.
     */

    if (
        bet.type === "dozen"
    ) {

        const dozen =
            Number(bet.dozen);

        if (
            ![1, 2, 3].includes(
                dozen
            )
        ) {

            throw new Error(
                "Dozen must be 1, 2 or 3"
            );
        }
    }


    /*
     * Column.
     */

    if (
        bet.type === "column"
    ) {

        const column =
            Number(bet.column);

        if (
            ![1, 2, 3].includes(
                column
            )
        ) {

            throw new Error(
                "Column must be 1, 2 or 3"
            );
        }
    }


    /*
     * Return a clean copy.
     *
     * Do not trust additional frontend
     * fields.
     */

    const cleanBet = {

        type:
            bet.type,

        amount
    };


    if (
        bet.type === "straight"
    ) {

        cleanBet.number =
            Number(bet.number);
    }


    if (
        bet.type === "dozen"
    ) {

        cleanBet.dozen =
            Number(bet.dozen);
    }


    if (
        bet.type === "column"
    ) {

        cleanBet.column =
            Number(bet.column);
    }


    return cleanBet;
}


/* =========================
   CHECK WIN
========================= */

export function isWinningBet(
    bet,
    result
) {

    const validBet =
        validateBet(bet);


    if (
        !result ||
        !Number.isInteger(
            Number(result.number)
        )
    ) {

        throw new Error(
            "Invalid roulette result"
        );
    }


    const number =
        Number(result.number);


    if (
        number < 0 ||
        number > 36
    ) {

        throw new Error(
            "Roulette result must be between 0 and 36"
        );
    }


    switch (
        validBet.type
    ) {

        case "straight":

            return (
                number ===
                validBet.number
            );


        case "red":

            return RED_NUMBERS.has(
                number
            );


        case "black":

            return BLACK_NUMBERS.has(
                number
            );


        case "odd":

            return (
                getParity(number) ===
                "odd"
            );


        case "even":

            return (
                getParity(number) ===
                "even"
            );


        case "low":

            return isLow(
                number
            );


        case "high":

            return isHigh(
                number
            );


        case "dozen":

            return isDozen(
                number,
                validBet.dozen
            );


        case "column":

            return isColumn(
                number,
                validBet.column
            );


        default:

            return false;
    }
}


/* =========================
   PAYOUT
========================= */

export function getPayoutMultiplier(
    bet
) {

    const validBet =
        validateBet(bet);


    switch (
        validBet.type
    ) {

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

            throw new Error(
                "No payout available"
            );
    }
}


/* =========================
   SETTLE BET
========================= */

export function settleBet(
    bet,
    result
) {

    const validBet =
        validateBet(bet);


    const won =
        isWinningBet(
            validBet,
            result
        );


    if (!won) {

        return {

            won:
                false,

            stake:
                validBet.amount,

            profit:
                0,

            returnAmount:
                0,

            multiplier:
                0
        };
    }


    const multiplier =
        getPayoutMultiplier(
            validBet
        );


    const profit =
        validBet.amount *
        multiplier;


    const returnAmount =
        validBet.amount +
        profit;


    return {

        won:
            true,

        stake:
            validBet.amount,

        profit,

        returnAmount,

        multiplier
    };
}


/* =========================
   SPIN
========================= */

export function spin() {

    /*
     * SERVER ONLY.
     */

    const number =
        randomNumber();


    return Object.freeze({

        number,

        color:
            getColor(number),

        parity:
            getParity(number),

        timestamp:
            new Date()
                .toISOString()
    });
}


/* =========================
   CREATE SLOT
========================= */

export function createSlot(
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
            `Roulette supports ${MIN_SLOTS} to ${MAX_SLOTS} slots`
        );
    }


    return {

        slot:
            number,

        bet:
            null,

        betAmount:
            0,

        placed:
            false,

        settled:
            false,

        result:
            null
    };
}


/* =========================
   DEFAULT TWO SLOTS
========================= */

export function createDefaultSlots() {

    return [

        createSlot(1),

        createSlot(2)

    ];
}


/* =========================
   CHANGE SLOT COUNT
========================= */

export function setSlotCount(
    requestedCount
) {

    const count =
        Number(requestedCount);


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
            `Roulette slot count must be between ${MIN_SLOTS} and ${MAX_SLOTS}`
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


/* =========================
   CREATE ROUND
========================= */

export function createRound() {

    const now =
        Date.now();


    return {

        game:
            GAME_NAME,

        status:
            "BETTING",

        /*
         * 40-second betting period.
         */

        bettingSeconds:
            BETTING_SECONDS,

        bettingStartedAt:
            new Date(now)
                .toISOString(),

        bettingEndsAt:
            now +
            BETTING_SECONDS *
            1000,

        /*
         * Slot configuration.
         */

        minSlots:
            MIN_SLOTS,

        defaultSlots:
            DEFAULT_SLOTS,

        maxSlots:
            MAX_SLOTS,

        /*
         * Server-generated result.
         *
         * NULL while betting.
         */

        result:
            null,

        number:
            null,

        color:
            null,

        parity:
            null,

        /*
         * Financial Audit Ledger
         */
        financials: null,

        /*
         * Players.
         */

        players:
            {},

        createdAt:
            new Date(now)
                .toISOString(),

        finishedAt:
            null
    };
}


/* =========================
   CAN PLACE BET
========================= */

export function canPlaceBet(
    round
) {

    if (!round) {
        return false;
    }


    if (
        round.status !==
        "BETTING"
    ) {

        return false;
    }


    return (
        Date.now() <
        round.bettingEndsAt
    );
}


/* =========================
   BETTING REMAINING
========================= */

export function getBettingRemainingSeconds(
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


/* =========================
   VALIDATE SLOT BET
========================= */

export function validateSlotBet(
    round,
    slotNumber,
    bet
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
                "WAITING FOR NEXT ROUND",

            errorAm:
                "ቀጣዩን ዙር በመጠበቅ ላይ"
        };
    }


    const slot =
        Number(slotNumber);


    if (
        !Number.isInteger(slot) ||
        slot < MIN_SLOTS ||
        slot > MAX_SLOTS
    ) {

        return {

            success:
                false,

            error:
                "Invalid slot"
        };
    }


    try {

        const validBet =
            validateBet(bet);


        return {

            success:
                true,

            slot,

            bet:
                validBet
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


/* =========================
   PLACE BET
========================= */

export function placeBet(
    round,
    playerId,
    slotNumber,
    bet
) {

    if (!round) {

        throw new Error(
            "Round not found"
        );
    }


    if (!playerId) {

        throw new Error(
            "Player ID is required"
        );
    }


    /*
     * Normalize player ID.
     */

    const safePlayerId =
        String(playerId);


    const validation =
        validateSlotBet(
            round,
            slotNumber,
            bet
        );


    if (
        !validation.success
    ) {

        throw new Error(
            validation.error
        );
    }


    /*
     * Player gets created
     * only when a valid bet
     * is being placed.
     */

    if (
        !round.players[
            safePlayerId
        ]
    ) {

        round.players[
            safePlayerId
        ] = {

            slots:
                {}
        };
    }


    const slot =
        Number(slotNumber);


    /*
     * Store only server-validated
     * bet data.
     */

    round.players[
        safePlayerId
    ].slots[
        slot
    ] = {

        slot,

        bet:
            validation.bet,

        betAmount:
            validation.bet.amount,

        placed:
            true,

        settled:
            false,

        result:
            null
    };


    return {

        success:
            true,

        slot,

        bet:
            validation.bet
    };
}


/* =========================
   SETTLE PLAYER
========================= */

export function settlePlayer(
    round,
    playerId
) {

    if (!round) {

        throw new Error(
            "Round not found"
        );
    }


    if (
        round.status !==
        "FINISHED"
    ) {

        throw new Error(
            "Round has not finished"
        );
    }


    if (
        !round.result
    ) {

        throw new Error(
            "Round has no server result"
        );
    }


    const player =
        round.players[
            String(playerId)
        ];


    if (!player) {
        return [];
    }


    const results = [];


    for (
        const slotKey
        of Object.keys(
            player.slots
        )
    ) {

        const slot =
            player.slots[
                slotKey
            ];


        if (
            !slot.placed ||
            !slot.bet
        ) {
            continue;
        }


        /*
         * Revalidate the stored bet
         * before settlement.
         */

        const settlement =
            settleBet(
                slot.bet,
                round.result
            );


        slot.settled =
            true;

        slot.result =
            settlement;


        results.push({

            slot:
                slot.slot,

            bet:
                slot.bet,

            ...settlement
        });
    }


    return results;
}


/* =========================
   FINISH ROUND
========================= */

export function finishRound(
    round
) {

    /*
     * Compatibility mode.
     */

    if (!round) {

        const result =
            spin();


        return {

            status:
                "FINISHED",

            result,

            finishedAt:
                new Date()
                    .toISOString()
        };
    }


    /*
     * Never generate another
     * result for a finished round.
     */

    if (
        round.status ===
        "FINISHED"
    ) {

        return round;
    }


    /*
     * Betting must be closed.
     */

    if (
        Date.now() <
        round.bettingEndsAt
    ) {

        throw new Error(
            "Betting period has not ended"
        );
    }


    /*
     * IMPORTANT:
     *
     * Generate the result exactly once.
     */

    if (
        round.result !== null
    ) {

        throw new Error(
            "Roulette result already exists"
        );
    }


    const result =
        spin();


    /*
     * Change state only after
     * the server has generated
     * the result.
     */

    round.result =
        result;

    round.number =
        result.number;

    round.color =
        result.color;

    round.parity =
        result.parity;

    round.status =
        "FINISHED";

    round.finishedAt =
        new Date()
            .toISOString();


    /*
     * Financial Ledger Audit Tracking (80% RTP / 20% House Edge Compliance)
     */
    let totalHandle = 0;
    let totalPayouts = 0;

    for (const [playerId, player] of Object.entries(round.players || {})) {
        for (const [slotKey, slot] of Object.entries(player.slots || {})) {
            if (slot.placed && slot.bet) {
                totalHandle += slot.bet.amount;
                const settlement = settleBet(slot.bet, result);
                slot.settled = true;
                slot.result = settlement;
                totalPayouts += settlement.returnAmount;
            }
        }
    }

    const houseRevenue = totalHandle - totalPayouts;
    const actualRTP = totalHandle > 0 ? (totalPayouts / totalHandle) * 100 : 0;

    round.financials = {
        totalHandle,
        totalPayouts,
        houseRevenue,
        targetRTP: TARGET_RTP_PERCENTAGE,
        targetHouseEdge: HOUSE_EDGE_PERCENTAGE,
        actualRTP: Math.round(actualRTP * 100) / 100,
        settledAt: new Date().toISOString()
    };


    return round;
}


/* =========================
   ROUND STATUS
========================= */

export function getRoundStatus(
    round
) {

    if (!round) {

        return {

            status:
                "UNKNOWN",

            remainingSeconds:
                0
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
                    0
            };
        }


        return {

            status:
                "BETTING",

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


/* =========================
   PUBLIC ROUND
========================= */

/*
 * NEVER expose private server data.
 *
 * During betting:
 *
 * result = null
 * number = null
 * color = null
 * parity = null
 */

export function publicRound(
    round
) {

    if (!round) {
        return null;
    }


    const status =
        getRoundStatus(
            round
        );


    const finished =
        round.status ===
        "FINISHED";


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
            status.remainingSeconds,

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
         * Result.
         *
         * ONLY expose after finish.
         */

        result:
            finished
                ? round.result
                : null,

        number:
            finished
                ? round.number
                : null,

        color:
            finished
                ? round.color
                : null,

        parity:
            finished
                ? round.parity
                : null,

        /*
         * Financial Summary Ledger
         */
        financials: finished
            ? round.financials
            : null,

        waitingMessage:
            "WAITING FOR NEXT ROUND",

        waitingMessageAm:
            "ቀጣዩን ዙር በመጠበቅ ላይ",

        createdAt:
            round.createdAt,

        finishedAt:
            round.finishedAt
    };
}
