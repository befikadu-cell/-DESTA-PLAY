"use strict";

const crypto = require("node:crypto");

/*
|--------------------------------------------------------------------------
| DESTA PLAY - ROULETTE GAME ENGINE
|--------------------------------------------------------------------------
|
| Single-zero European-style roulette:
| 0 - 36
|
| Slots:
| Minimum: 1
| Default: 2
| Maximum: 2
|
|--------------------------------------------------------------------------
*/

const GAME_NAME = "roulette";

const BETTING_SECONDS = 60;

const MIN_SLOTS = 1;
const DEFAULT_SLOTS = 2;
const MAX_SLOTS = 2;


/*
|--------------------------------------------------------------------------
| WHEEL
|--------------------------------------------------------------------------
*/

const WHEEL = Array.from(
    { length: 37 },
    (_, i) => i
);


/*
|--------------------------------------------------------------------------
| COLORS
|--------------------------------------------------------------------------
*/

const RED_NUMBERS = new Set([
    1, 3, 5, 7, 9,
    12, 14, 16, 18,
    19, 21, 23, 25, 27,
    30, 32, 34, 36
]);

const BLACK_NUMBERS = new Set([
    2, 4, 6, 8, 10,
    11, 13, 15, 17,
    20, 22, 24, 26,
    28, 29, 31, 33, 35
]);


/*
|--------------------------------------------------------------------------
| CUSTOM PAYOUT MODEL
|--------------------------------------------------------------------------
|
| These are NET profit multipliers.
|
| Example:
|
| 10 ETB x 0.8 profit
| = 8 ETB profit
| + 10 ETB original stake
| = 18 ETB return
|
|--------------------------------------------------------------------------
*/

const PAYOUTS = {

    straight: 28.8,

    split: 14.4,

    street: 9.333333,

    corner: 6.6,

    sixLine: 4.333333,

    dozen: 1.666667,

    column: 1.666667,

    evenMoney: 0.8
};


/*
|--------------------------------------------------------------------------
| RANDOM NUMBER
|--------------------------------------------------------------------------
*/

function randomNumber() {

    return crypto.randomInt(
        0,
        37
    );
}


/*
|--------------------------------------------------------------------------
| RESULT INFORMATION
|--------------------------------------------------------------------------
*/

function getColor(number) {

    if (number === 0) {
        return "green";
    }

    if (
        RED_NUMBERS.has(number)
    ) {
        return "red";
    }

    return "black";
}


function getParity(number) {

    if (number === 0) {
        return null;
    }

    return number % 2 === 0
        ? "even"
        : "odd";
}


function isLow(number) {

    return (
        number >= 1 &&
        number <= 18
    );
}


function isHigh(number) {

    return (
        number >= 19 &&
        number <= 36
    );
}


function isDozen(
    number,
    dozen
) {

    if (number === 0) {
        return false;
    }

    if (dozen === 1) {
        return (
            number >= 1 &&
            number <= 12
        );
    }

    if (dozen === 2) {
        return (
            number >= 13 &&
            number <= 24
        );
    }

    if (dozen === 3) {
        return (
            number >= 25 &&
            number <= 36
        );
    }

    return false;
}


function isColumn(
    number,
    column
) {

    if (number === 0) {
        return false;
    }

    return (
        (number - column) % 3 === 0
    );
}


/*
|--------------------------------------------------------------------------
| BET TYPES
|--------------------------------------------------------------------------
*/

const ALLOWED_BET_TYPES = [
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


/*
|--------------------------------------------------------------------------
| VALIDATE BET
|--------------------------------------------------------------------------
*/

function validateBet(bet) {

    if (
        !bet ||
        typeof bet !== "object"
    ) {
        throw new Error(
            "Invalid roulette bet"
        );
    }


    const amount =
        Number(bet.amount);


    if (
        !Number.isFinite(amount) ||
        amount <= 0
    ) {
        throw new Error(
            "Invalid bet amount"
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
     * Straight number.
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


    return {

        ...bet,

        amount
    };
}


/*
|--------------------------------------------------------------------------
| CHECK WIN
|--------------------------------------------------------------------------
*/

function isWinningBet(
    bet,
    result
) {

    const number =
        Number(result.number);


    switch (bet.type) {

        case "straight":
            return (
                number ===
                Number(bet.number)
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
                Number(bet.dozen)
            );


        case "column":
            return isColumn(
                number,
                Number(bet.column)
            );


        default:
            return false;
    }
}


/*
|--------------------------------------------------------------------------
| PAYOUT
|--------------------------------------------------------------------------
*/

function getPayoutMultiplier(
    bet
) {

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
            throw new Error(
                "No payout available"
            );
    }
}


/*
|--------------------------------------------------------------------------
| SETTLE ONE BET
|--------------------------------------------------------------------------
*/

function settleBet(
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

            won: false,

            stake:
                validBet.amount,

            profit: 0,

            returnAmount: 0,

            multiplier: 0
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

        won: true,

        stake:
            validBet.amount,

        profit,

        returnAmount,

        multiplier
    };
}


/*
|--------------------------------------------------------------------------
| SPIN
|--------------------------------------------------------------------------
*/

function spin() {

    const number =
        randomNumber();


    return {

        number,

        color:
            getColor(number),

        parity:
            getParity(number),

        timestamp:
            new Date()
                .toISOString()
    };
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


/*
|--------------------------------------------------------------------------
| DEFAULT SLOTS
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
*/

function setSlotCount(
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
         * Slots.
         */

        minSlots:
            MIN_SLOTS,

        defaultSlots:
            DEFAULT_SLOTS,

        maxSlots:
            MAX_SLOTS,

        /*
         * Result.
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


/*
|--------------------------------------------------------------------------
| CAN PLACE BET
|--------------------------------------------------------------------------
*/

function canPlaceBet(
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


/*
|--------------------------------------------------------------------------
| BETTING REMAINING
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
| VALIDATE SLOT BET
|--------------------------------------------------------------------------
*/

function validateSlotBet(
    round,
    slotNumber,
    bet
) {

    if (!round) {

        return {

            success: false,

            error:
                "Round not found"
        };
    }


    if (
        !canPlaceBet(round)
    ) {

        return {

            success: false,

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

            success: false,

            error:
                "Invalid slot"
        };
    }


    try {

        const validBet =
            validateBet(bet);


        return {

            success: true,

            slot,

            bet:
                validBet
        };

    } catch (error) {

        return {

            success: false,

            error:
                error.message
        };
    }
}


/*
|--------------------------------------------------------------------------
| PLACE BET IN ROUND
|--------------------------------------------------------------------------
*/

function placeBet(
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


    if (
        !round.players[
            playerId
        ]
    ) {

        round.players[
            playerId
        ] = {

            slots:
                {}
        };
    }


    round.players[
        playerId
    ].slots[
        slotNumber
    ] = {

        slot:
            Number(slotNumber),

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

        slot:
            Number(slotNumber),

        bet:
            validation.bet
    };
}


/*
|--------------------------------------------------------------------------
| SETTLE PLAYER
|--------------------------------------------------------------------------
*/

function settlePlayer(
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


    const player =
        round.players[
            playerId
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


/*
|--------------------------------------------------------------------------
| FINISH ROUND
|--------------------------------------------------------------------------
*/

function finishRound(
    round
) {

    if (!round) {

        /*
         * Compatibility with:
         *
         * roulette.createRound()
         * roulette.spin()
         */

        return {

            status:
                "FINISHED",

            result:
                spin(),

            finishedAt:
                new Date()
                    .toISOString()
        };
    }


    if (
        round.status ===
        "FINISHED"
    ) {

        return round;
    }


    if (
        Date.now() <
        round.bettingEndsAt
    ) {

        throw new Error(
            "Betting period has not ended"
        );
    }


    const result =
        spin();


    round.status =
        "FINISHED";


    round.result =
        result;


    round.number =
        result.number;


    round.color =
        result.color;


    round.parity =
        result.parity;


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


/*
|--------------------------------------------------------------------------
| PUBLIC ROUND
|--------------------------------------------------------------------------
|
| This is safe for the frontend.
|
| The frontend can display:
|
| - countdown
| - betting state
| - result
| - slots
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
         * Result is only available
         * after the round finishes.
         */

        result:
            round.status ===
            "FINISHED"
                ? round.result
                : null,

        number:
            round.status ===
            "FINISHED"
                ? round.number
                : null,

        color:
            round.status ===
            "FINISHED"
                ? round.color
                : null,

        parity:
            round.status ===
            "FINISHED"
                ? round.parity
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


/*
|--------------------------------------------------------------------------
| EXPORTS
|--------------------------------------------------------------------------
*/

module.exports = {

    GAME_NAME,

    BETTING_SECONDS,

    MIN_SLOTS,

    DEFAULT_SLOTS,

    MAX_SLOTS,

    WHEEL,

    RED_NUMBERS,

    BLACK_NUMBERS,

    PAYOUTS,

    ALLOWED_BET_TYPES,

    randomNumber,

    getColor,

    getParity,

    isLow,

    isHigh,

    isDozen,

    isColumn,

    validateBet,

    isWinningBet,

    getPayoutMultiplier,

    settleBet,

    spin,

    createSlot,

    createDefaultSlots,

    setSlotCount,

    createRound,

    canPlaceBet,

    getBettingRemainingSeconds,

    validateSlotBet,

    placeBet,

    settlePlayer,

    finishRound,

    getRoundStatus,

    publicRound
};
