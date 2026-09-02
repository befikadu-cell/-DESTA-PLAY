/*
|--------------------------------------------------------------------------
| DESTA PLAY — 24/7 CONTINUOUS BACKEND ENGINE
|--------------------------------------------------------------------------
|
| Features:
|   - Multi-Tier PVP Bingo Loops (10 ETB to 500 ETB)
|   - Real-Time Pool Allocation: 90% Winner Payout / 10% Platform Rake
|   - House Game Engines: Keno, Roulette, Aviator
|   - Continuous 24/7 Auto-Reset Engine
|   - Server-authoritative round timestamps for frontend synchronization
|   - Supabase Wallet Ledger
|   - Argon2id Authentication
|   - Signed session tokens that survive server restarts
|   - Safer concurrent wallet updates
|
|--------------------------------------------------------------------------
*/

"use strict";

/*
|--------------------------------------------------------------------------
| CORE MODULES
|--------------------------------------------------------------------------
*/

const express = require("express");
const cors = require("cors");
const path = require("path");
const crypto = require("crypto");
const argon2 = require("argon2");
const { createClient } = require("@supabase/supabase-js");

/*
|--------------------------------------------------------------------------
| GAME MODULES
|--------------------------------------------------------------------------
|
| Make sure these files exist:
|
|   /games/keno.js
|   /games/bingo.js
|   /games/roulette.js
|   /games/aviator.js
|
|--------------------------------------------------------------------------
*/

const keno = require("./games/keno");
const bingo = require("./games/bingo");
const roulette = require("./games/roulette");
const aviator = require("./games/aviator");

/*
|--------------------------------------------------------------------------
| ENVIRONMENT & DATABASE SETUP
|--------------------------------------------------------------------------
*/

const PORT = Number(process.env.PORT || 10000);

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SESSION_SECRET = process.env.SESSION_SECRET;

/*
|--------------------------------------------------------------------------
| REQUIRED ENVIRONMENT VARIABLES
|--------------------------------------------------------------------------
*/

if (!SUPABASE_URL) {
    throw new Error("Missing SUPABASE_URL environment variable");
}

if (!SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY environment variable");
}

if (!SESSION_SECRET || SESSION_SECRET.length < 32) {
    throw new Error(
        "SESSION_SECRET is missing or too short. Use a random secret of at least 32 characters."
    );
}

/*
|--------------------------------------------------------------------------
| SUPABASE CLIENT
|--------------------------------------------------------------------------
*/

const supabase = createClient(
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    {
        auth: {
            autoRefreshToken: false,
            persistSession: false
        }
    }
);

/*
|--------------------------------------------------------------------------
| EXPRESS APPLICATION
|--------------------------------------------------------------------------
*/

const app = express();

app.disable("x-powered-by");

app.use(
    cors({
        origin: true,
        credentials: true
    })
);

app.use(
    express.json({
        limit: "100kb"
    })
);

app.use(
    express.static(
        path.join(__dirname, "public")
    )
);

/*
|--------------------------------------------------------------------------
| GAME REGISTRY
|--------------------------------------------------------------------------
*/

const games = {
    keno,
    roulette,
    aviator
};

/*
|--------------------------------------------------------------------------
| ACTIVE HOUSE GAME ROUNDS
|--------------------------------------------------------------------------
*/

const rounds = {};

/*
|--------------------------------------------------------------------------
| ENGINE TIMING CONFIGURATION
|--------------------------------------------------------------------------
|
| IMPORTANT:
|
| The frontend should NOT calculate the official countdown from its own
| timer. The backend sends bettingEndsAt / serverTime and the frontend
| calculates the remaining time from those timestamps.
|
|--------------------------------------------------------------------------
*/

const DRAW_INTERVALS = {
    keno: 1800,
    roulette: 5000,
    bingo: 3000
};

const BETTING_TIMERS = {
    bingo: 30,
    keno: 30,
    roulette: 20,
    aviator: 10
};

const NEXT_ROUND_DELAY = 5000;

/*
|--------------------------------------------------------------------------
| PVP BINGO ECONOMICS
|--------------------------------------------------------------------------
*/

const HOUSE_RAKE_PERCENT = 0.10;

/*
|--------------------------------------------------------------------------
| HOUSE GAME RTP CONFIGURATION
|--------------------------------------------------------------------------
|
| IMPORTANT:
|
| RTP is a mathematical target/configuration, not a guarantee that every
| individual player or round receives exactly this percentage.
|
| Aviator-style games especially depend on player cash-out behavior, so
| the old formula did NOT mathematically guarantee 70% RTP.
|
|--------------------------------------------------------------------------
*/

const TARGET_RTP = 0.70;

/*
|--------------------------------------------------------------------------
| PVP BINGO TIERS
|--------------------------------------------------------------------------
*/

const BINGO_TIERS = [
    10,
    20,
    30,
    50,
    80,
    100,
    150,
    200,
    300,
    500
];

/*
|--------------------------------------------------------------------------
| BINGO ROOM STORAGE
|--------------------------------------------------------------------------
*/

const bingoRooms = {};

/*
|--------------------------------------------------------------------------
| PLAYER OPERATION LOCKS
|--------------------------------------------------------------------------
|
| This prevents two requests from changing the same player's balance
| simultaneously inside this Node.js process.
|
| NOTE:
| For a multi-server deployment, use a Supabase/PostgreSQL RPC transaction
| as the final source of truth.
|
|--------------------------------------------------------------------------
*/

const playerLocks = new Map();

async function withPlayerLock(playerId, operation) {
    const previous = playerLocks.get(playerId) || Promise.resolve();

    let release;

    const current = new Promise(resolve => {
        release = resolve;
    });

    playerLocks.set(
        playerId,
        previous.then(() => current)
    );

    try {
        await previous;
        return await operation();
    } finally {
        release();

        if (playerLocks.get(playerId) === current) {
            playerLocks.delete(playerId);
        }
    }
}

/*
|--------------------------------------------------------------------------
| GENERAL HELPERS
|--------------------------------------------------------------------------
*/

function nowIso() {
    return new Date().toISOString();
}

function makeId(prefix = "") {
    return prefix + crypto.randomBytes(16).toString("hex");
}

function makePlayerId() {
    return (
        "DP-" +
        crypto.randomBytes(4).toString("hex").toUpperCase()
    );
}

/*
|--------------------------------------------------------------------------
| SAFE TELEGRAM NAME
|--------------------------------------------------------------------------
*/

function normalizeTelegramName(name) {
    if (typeof name !== "string") {
        return "Player";
    }

    const clean = name
        .trim()
        .replace(/\s+/g, " ");

    return clean.slice(0, 80) || "Player";
}

/*
|--------------------------------------------------------------------------
| PASSWORD VALIDATION
|--------------------------------------------------------------------------
*/

function validPassword(password) {
    return (
        typeof password === "string" &&
        password.length >= 8 &&
        password.length <= 128
    );
}

/*
|--------------------------------------------------------------------------
| NUMBER VALIDATION
|--------------------------------------------------------------------------
*/

function validPositiveNumber(value) {
    const n = Number(value);

    return (
        Number.isFinite(n) &&
        n > 0
    );
}

/*
|--------------------------------------------------------------------------
| DATABASE ERROR LOGGER
|--------------------------------------------------------------------------
*/

function dbError(context, error) {
    console.error(
        `[DATABASE ERROR] ${context}:`,
        error
    );
}

/*
|--------------------------------------------------------------------------
| CONSTANT-TIME STRING COMPARISON
|--------------------------------------------------------------------------
*/

function safeEqual(a, b) {
    const aBuffer = Buffer.from(String(a));
    const bBuffer = Buffer.from(String(b));

    if (aBuffer.length !== bBuffer.length) {
        return false;
    }

    return crypto.timingSafeEqual(
        aBuffer,
        bBuffer
    );
}

/*
|--------------------------------------------------------------------------
| SIGNED SESSION TOKEN
|--------------------------------------------------------------------------
|
| The old server stored sessions in:
|
|     const sessions = new Map()
|
| That meant every Render/server restart logged everyone out.
|
| This version creates a signed token:
|
|     base64(payload).signature
|
| No password is stored inside the token.
|
|--------------------------------------------------------------------------
*/

const SESSION_DURATION_MS =
    1000 * 60 * 60 * 24 * 7;

function base64UrlEncode(value) {
    return Buffer
        .from(value)
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=/g, "");
}

function base64UrlDecode(value) {
    return Buffer
        .from(
            value
                .replace(/-/g, "+")
                .replace(/_/g, "/"),
            "base64"
        )
        .toString("utf8");
}

function signSessionPayload(payload) {
    return crypto
        .createHmac(
            "sha256",
            SESSION_SECRET
        )
        .update(payload)
        .digest("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=/g, "");
}

function createSession(player) {
    const payload = JSON.stringify({
        playerId: player.playerId,
        issuedAt: Date.now(),
        expiresAt:
            Date.now() + SESSION_DURATION_MS,
        nonce: crypto
            .randomBytes(16)
            .toString("hex")
    });

    const encoded = base64UrlEncode(payload);

    const signature =
        signSessionPayload(encoded);

    return `${encoded}.${signature}`;
}

function verifySession(token) {
    try {
        if (
            typeof token !== "string" ||
            !token.includes(".")
        ) {
            return null;
        }

        const parts = token.split(".");

        if (parts.length !== 2) {
            return null;
        }

        const encoded = parts[0];
        const signature = parts[1];

        const expected =
            signSessionPayload(encoded);

        if (!safeEqual(signature, expected)) {
            return null;
        }

        const payload =
            JSON.parse(
                base64UrlDecode(encoded)
            );

        if (
            !payload.playerId ||
            !payload.expiresAt
        ) {
            return null;
        }

        if (
            Date.now() >
            Number(payload.expiresAt)
        ) {
            return null;
        }

        return payload;
    } catch (error) {
        return null;
    }
}

/*
|--------------------------------------------------------------------------
| PLAYER DATABASE FUNCTIONS
|--------------------------------------------------------------------------
*/

async function findPlayerByTelegramId(
    telegramId
) {
    const {
        data,
        error
    } = await supabase
        .from("players")
        .select("*")
        .eq(
            "telegram_id",
            String(telegramId)
        )
        .maybeSingle();

    if (error) {
        dbError(
            "findPlayerByTelegramId",
            error
        );

        throw new Error(
            "Database error"
        );
    }

    return data;
}

async function findPlayerById(playerId) {
    const {
        data,
        error
    } = await supabase
        .from("players")
        .select("*")
        .eq(
            "player_id",
            playerId
        )
        .maybeSingle();

    if (error) {
        dbError(
            "findPlayerById",
            error
        );

        throw new Error(
            "Database error"
        );
    }

    return data;
}

/*
|--------------------------------------------------------------------------
| CREATE PLAYER
|--------------------------------------------------------------------------
*/

async function createPlayer({
    telegramId,
    telegramName,
    password
}) {
    if (
        telegramId === undefined ||
        telegramId === null ||
        String(telegramId).trim() === ""
    ) {
        throw new Error(
            "Telegram ID is required"
        );
    }

    if (!validPassword(password)) {
        throw new Error(
            "Password must be 8–128 characters"
        );
    }

    const existing =
        await findPlayerByTelegramId(
            telegramId
        );

    if (existing) {
        throw new Error(
            "Player already exists"
        );
    }

    /*
    |--------------------------------------------------------------------------
    | ARGON2ID PASSWORD HASH
    |--------------------------------------------------------------------------
    */

    const passwordHash =
        await argon2.hash(
            password,
            {
                type: argon2.argon2id,
                memoryCost: 19456,
                timeCost: 2,
                parallelism: 1
            }
        );

    const playerId =
        makePlayerId();

    const name =
        normalizeTelegramName(
            telegramName
        );

    const {
        data,
        error
    } = await supabase
        .from("players")
        .insert({
            player_id: playerId,
            telegram_id:
                String(telegramId),
            telegram_name: name,
            password_hash:
                passwordHash,
            balance: 0,
            created_at: nowIso(),
            updated_at: nowIso()
        })
        .select(
            "id,player_id,telegram_id,telegram_name,balance,created_at"
        )
        .single();

    if (error) {
        dbError(
            "createPlayer",
            error
        );

        /*
        |--------------------------------------------------------------------------
        | UNIQUE CONSTRAINT FRIENDLY ERROR
        |--------------------------------------------------------------------------
        */

        if (
            error.code === "23505"
        ) {
            throw new Error(
                "Player already exists"
            );
        }

        throw new Error(
            "Could not create account"
        );
    }

    return data;
}

/*
|--------------------------------------------------------------------------
| AUTHENTICATE PLAYER
|--------------------------------------------------------------------------
*/

async function authenticatePlayer(
    telegramId,
    password
) {
    if (
        telegramId === undefined ||
        telegramId === null ||
        typeof password !== "string"
    ) {
        throw new Error(
            "Invalid Telegram ID or password"
        );
    }

    const player =
        await findPlayerByTelegramId(
            telegramId
        );

    if (!player) {
        throw new Error(
            "Invalid Telegram ID or password"
        );
    }

    const valid =
        await argon2.verify(
            player.password_hash,
            password
        );

    if (!valid) {
        throw new Error(
            "Invalid Telegram ID or password"
        );
    }

    return {
        id: player.id,
        playerId: player.player_id,
        telegramId:
            player.telegram_id,
        telegramName:
            player.telegram_name,
        balance:
            Number(player.balance || 0)
    };
}

/*
|--------------------------------------------------------------------------
| GET SESSION PLAYER
|--------------------------------------------------------------------------
*/

function getSessionPlayer(req) {
    const header =
        req.headers.authorization || "";

    if (
        !header.startsWith(
            "Bearer "
        )
    ) {
        return null;
    }

    const token =
        header
            .slice(7)
            .trim();

    return verifySession(token);
}

/*
|--------------------------------------------------------------------------
| AUTHENTICATION MIDDLEWARE
|--------------------------------------------------------------------------
*/

async function requirePlayer(
    req,
    res,
    next
) {
    try {
        const session =
            getSessionPlayer(req);

        if (!session) {
            return res
                .status(401)
                .json({
                    success: false,
                    error:
                        "Authentication required"
                });
        }

        const player =
            await findPlayerById(
                session.playerId
            );

        if (!player) {
            return res
                .status(401)
                .json({
                    success: false,
                    error:
                        "Player account not found"
                });
        }

        req.player = player;

        next();
    } catch (error) {
        console.error(
            "Authentication error:",
            error
        );

        return res
            .status(500)
            .json({
                success: false,
                error:
                    "Authentication error"
            });
    }
}

/*
|--------------------------------------------------------------------------
| WALLET TRANSACTION LEDGER
|--------------------------------------------------------------------------
*/

async function recordTransaction({
    playerId,
    type,
    amount,
    balanceBefore,
    balanceAfter,
    game = null,
    roundId = null,
    status = "completed",
    reference = null,
    metadata = {}
}) {
    const {
        data,
        error
    } = await supabase
        .from("wallet_transactions")
        .insert({
            transaction_id:
                makeId("TX-"),
            player_id:
                playerId,
            type,
            amount:
                Number(amount),
            balance_before:
                Number(balanceBefore),
            balance_after:
                Number(balanceAfter),
            game,
            round_id:
                roundId,
            status,
            reference,
            metadata,
            created_at:
                nowIso()
        })
        .select()
        .single();

    if (error) {
        dbError(
            "recordTransaction",
            error
        );

        throw new Error(
            "Could not save transaction"
        );
    }

    return data;
}

/*
|--------------------------------------------------------------------------
| CHANGE PLAYER BALANCE
|--------------------------------------------------------------------------
|
| IMPORTANT:
|
| The previous version did:
|
|   SELECT balance
|   UPDATE balance
|
| Without checking whether somebody else changed the balance between those
| two operations.
|
| This version performs the update conditionally using the balance that was
| read. Combined with the per-player lock, this prevents the common
| double-spend problem inside a single backend process.
|
|--------------------------------------------------------------------------
*/

async function changeBalance({
    playerId,
    amount,
    type,
    game = null,
    roundId = null,
    status = "completed",
    reference = null,
    metadata = {}
}) {
    const numericAmount =
        Number(amount);

    if (
        !Number.isFinite(
            numericAmount
        )
    ) {
        throw new Error(
            "Invalid amount"
        );
    }

    return withPlayerLock(
        playerId,
        async () => {
            const player =
                await findPlayerById(
                    playerId
                );

            if (!player) {
                throw new Error(
                    "Player not found"
                );
            }

            const before =
                Number(
                    player.balance || 0
                );

            const after =
                Number(
                    (
                        before +
                        numericAmount
                    ).toFixed(2)
                );

            if (
                after < 0
            ) {
                throw new Error(
                    "Insufficient balance"
                );
            }

            /*
            |--------------------------------------------------------------------------
            | CONDITIONAL BALANCE UPDATE
            |--------------------------------------------------------------------------
            */

            const {
                data,
                error
            } = await supabase
                .from("players")
                .update({
                    balance:
                        after,
                    updated_at:
                        nowIso()
                })
                .eq(
                    "player_id",
                    playerId
                )
                .eq(
                    "balance",
                    before
                )
                .select(
                    "player_id,balance"
                )
                .maybeSingle();

            if (error) {
                dbError(
                    "changeBalance",
                    error
                );

                throw new Error(
                    "Could not update balance"
                );
            }

            if (!data) {
                throw new Error(
                    "Balance changed. Please try again."
                );
            }

            /*
            |--------------------------------------------------------------------------
            | SAVE LEDGER TRANSACTION
            |--------------------------------------------------------------------------
            */

            try {
                await recordTransaction({
                    playerId,
                    type,
                    amount:
                        numericAmount,
                    balanceBefore:
                        before,
                    balanceAfter:
                        after,
                    game,
                    roundId,
                    status,
                    reference,
                    metadata
                });
            } catch (ledgerError) {
                /*
                |--------------------------------------------------------------------------
                | IMPORTANT:
                |
                | The balance update already happened. We therefore report the
                | ledger problem clearly instead of pretending the transaction
                | was fully successful.
                |--------------------------------------------------------------------------
                */

                console.error(
                    "CRITICAL WALLET LEDGER ERROR:",
                    ledgerError
                );

                throw new Error(
                    "Balance changed but transaction ledger failed. Contact administrator."
                );
            }

            return data;
        }
    );
}

/*
|--------------------------------------------------------------------------
| BINGO DRAW GENERATOR
|--------------------------------------------------------------------------
*/

function generateBingoDraw() {
    const numbers =
        Array.from(
            {
                length: 75
            },
            (_, i) => i + 1
        );

    const result = [];

    while (
        result.length < 75
    ) {
        const randomIndex =
            crypto.randomInt(
                0,
                numbers.length
            );

        result.push(
            numbers.splice(
                randomIndex,
                1
            )[0]
        );
    }

    return result;
}

/*
|--------------------------------------------------------------------------
| INITIALIZE ALL BINGO ROOMS
|--------------------------------------------------------------------------
*/

function initBingoRooms() {
    BINGO_TIERS.forEach(
        tier => {
            startNewBingoRound(
                tier
            );
        }
    );
}

/*
|--------------------------------------------------------------------------
| START NEW BINGO ROUND
|--------------------------------------------------------------------------
*/

function startNewBingoRound(tier) {
    const bettingEndsAt =
        Date.now() +
        BETTING_TIMERS.bingo *
            1000;

    const room = {
        id:
            `bingo-${tier}-${Date.now()}-${crypto
                .randomBytes(4)
                .toString("hex")}`,

        tierId:
            tier,

        entryFee:
            tier,

        status:
            "BETTING",

        createdAt:
            nowIso(),

        bettingStartedAt:
            Date.now(),

        bettingEndsAt,

        players: [],

        secretDraw:
            generateBingoDraw(),

        drawnNumbers: [],

        drawIndex: 0,

        currentNumber:
            null,

        winner:
            null,

        totalPool:
            0,

        houseRake:
            0,

        winnerPrize:
            0
    };

    bingoRooms[tier] =
        room;

    console.log(
        `[BINGO TIER ${tier}] New round started. Round ID: ${room.id}`
    );

    /*
    |--------------------------------------------------------------------------
    | SERVER-AUTHORITATIVE TIMER
    |--------------------------------------------------------------------------
    */

    setTimeout(
        () => {
            startBingoDrawPhase(
                tier,
                room.id
            );
        },
        BETTING_TIMERS.bingo *
            1000
    );
}

/*
|--------------------------------------------------------------------------
| START BINGO DRAWING PHASE
|--------------------------------------------------------------------------
*/

function startBingoDrawPhase(
    tier,
    roundId
) {
    const room =
        bingoRooms[tier];

    /*
    |--------------------------------------------------------------------------
    | DO NOT CHANGE A NEWER ROUND
    |--------------------------------------------------------------------------
    */

    if (
        !room ||
        room.id !== roundId ||
        room.status !== "BETTING"
    ) {
        return;
    }

    room.status =
        "DRAWING";

    room.drawIndex =
        0;

    room.drawnNumbers =
        [];

    room.currentNumber =
        null;

    revealNextBingoNumber(
        tier,
        roundId
    );
}

/*
|--------------------------------------------------------------------------
| REVEAL NEXT BINGO NUMBER
|--------------------------------------------------------------------------
*/

function revealNextBingoNumber(
    tier,
    roundId
) {
    const room =
        bingoRooms[tier];

    if (
        !room ||
        room.id !== roundId ||
        room.status !== "DRAWING"
    ) {
        return;
    }

    /*
    |--------------------------------------------------------------------------
    | ALL 75 NUMBERS DRAWN
    |--------------------------------------------------------------------------
    */

    if (
        room.drawIndex >=
        room.secretDraw.length
    ) {
        resolveBingoWinner(
            tier,
            roundId,
            null
        );

        return;
    }

    const number =
        room.secretDraw[
            room.drawIndex
        ];

    room.currentNumber =
        number;

    room.drawnNumbers.push(
        number
    );

    room.drawIndex++;

    /*
    |--------------------------------------------------------------------------
    | CHECK PLAYERS
    |--------------------------------------------------------------------------
    */

    let winningPlayer =
        null;

    for (
        const player of room.players
    ) {
        try {
            if (
                typeof bingo.isWinningCard ===
                "function" &&
                bingo.isWinningCard(
                    player.cartela,
                    room.drawnNumbers
                )
            ) {
                winningPlayer =
                    player;

                break;
            }
        } catch (error) {
            console.error(
                "Bingo card validation error:",
                error
            );
        }
    }

    /*
    |--------------------------------------------------------------------------
    | WINNER FOUND
    |--------------------------------------------------------------------------
    */

    if (winningPlayer) {
        resolveBingoWinner(
            tier,
            roundId,
            winningPlayer
        );

        return;
    }

    /*
    |--------------------------------------------------------------------------
    | CONTINUE DRAWING
    |--------------------------------------------------------------------------
    */

    setTimeout(
        () => {
            revealNextBingoNumber(
                tier,
                roundId
            );
        },
        DRAW_INTERVALS.bingo
    );
}

/*
|--------------------------------------------------------------------------
| RESOLVE BINGO WINNER
|--------------------------------------------------------------------------
*/

async function resolveBingoWinner(
    tier,
    roundId,
    winnerObj = null
) {
    const room =
        bingoRooms[tier];

    if (
        !room ||
        room.id !== roundId ||
        room.status === "FINISHED"
    ) {
        return;
    }

    room.status =
        "FINISHED";

    /*
    |--------------------------------------------------------------------------
    | CALCULATE POOL
    |--------------------------------------------------------------------------
    */

    const grossPool =
        Number(
            (
                room.players.length *
                room.entryFee
            ).toFixed(2)
        );

    const houseRake =
        Number(
            (
                grossPool *
                HOUSE_RAKE_PERCENT
            ).toFixed(2)
        );

    const winnerPrize =
        Number(
            (
                grossPool -
                houseRake
            ).toFixed(2)
        );

    room.totalPool =
        grossPool;

    room.houseRake =
        houseRake;

    room.winnerPrize =
        winnerPrize;

    /*
    |--------------------------------------------------------------------------
    | IMPORTANT:
    |
    | NEVER GIVE THE MONEY TO THE FIRST PLAYER JUST BECAUSE THERE IS NO
    | WINNER.
    |--------------------------------------------------------------------------
    */

    if (!winnerObj) {
        room.winner =
            null;

        console.log(
            `[BINGO TIER ${tier}] Round ${roundId} finished without a Bingo winner. Pool: ${grossPool} ETB`
        );
    } else {
        room.winner =
            winnerObj;

        try {
            await changeBalance({
                playerId:
                    winnerObj.playerId,

                amount:
                    winnerPrize,

                type:
                    "bingo_win",

                game:
                    "bingo",

                roundId:
                    room.id,

                metadata: {
                    tier,
                    grossPool,
                    houseRake,
                    winnerPrize
                }
            });

            console.log(
                `[BINGO TIER ${tier}] Winner: ${winnerObj.telegramName} | Gross: ${grossPool} ETB | Winner: ${winnerPrize} ETB | Rake: ${houseRake} ETB`
            );
        } catch (error) {
            console.error(
                `[BINGO TIER ${tier}] Payout error:`,
                error
            );
        }
    }

    /*
    |--------------------------------------------------------------------------
    | CONTINUOUS LOOP
    |--------------------------------------------------------------------------
    */

    setTimeout(
        () => {
            /*
            |--------------------------------------------------------------------------
            | Only create the next round if this is still the finished round.
            |--------------------------------------------------------------------------
            */

            const current =
                bingoRooms[tier];

            if (
                current &&
                current.id === roundId &&
                current.status ===
                    "FINISHED"
            ) {
                startNewBingoRound(
                    tier
                );
            }
        },
        NEXT_ROUND_DELAY
    );
}

/*
|--------------------------------------------------------------------------
| HOUSE GAME — KENO DRAW
|--------------------------------------------------------------------------
*/

function generateKenoDraw() {
    const numbers =
        Array.from(
            {
                length: 80
            },
            (_, i) => i + 1
        );

    const result = [];

    while (
        result.length < 20
    ) {
        const randomIndex =
            crypto.randomInt(
                0,
                numbers.length
            );

        result.push(
            numbers.splice(
                randomIndex,
                1
            )[0]
        );
    }

    return result;
}

/*
|--------------------------------------------------------------------------
| AVIATOR CRASH GENERATOR
|--------------------------------------------------------------------------
|
| IMPORTANT:
|
| The previous formula claimed to mathematically enforce 70% RTP:
|
|   TARGET_RTP / (1 - rand)
|
| That is NOT a valid exact 70% RTP guarantee because the distribution has
| problematic expectation behavior and RTP depends on player cash-out
| strategy.
|
| This version creates a bounded, cryptographically random crash point.
|
| If you want a formally audited RTP model, the exact probability
| distribution should be designed and tested separately before real-money
| deployment.
|
|--------------------------------------------------------------------------
*/

function generateCrashPoint() {
    const randomBytes =
        crypto.randomBytes(8);

    const randomValue =
        randomBytes.readBigUInt64BE(
            0
        );

    const max =
        BigInt(
            "18446744073709551615"
        );

    const rand =
        Number(randomValue) /
        Number(max);

    /*
    |--------------------------------------------------------------------------
    | Heavy-tail style distribution.
    |
    | Minimum multiplier = 1.00
    |--------------------------------------------------------------------------
    */

    let crash;

    if (rand < 0.30) {
        crash = 1.00;
    } else {
        /*
        |--------------------------------------------------------------------------
        | Prevent infinite/unbounded values.
        |--------------------------------------------------------------------------
        */

        const normalized =
            (rand - 0.30) /
            0.70;

        crash =
            1 +
            Math.pow(
                normalized,
                1.8
            ) *
            49;
    }

    return Number(
        Math.max(
            1,
            Math.min(
                50,
                crash
            )
        ).toFixed(2)
    );
}

/*
|--------------------------------------------------------------------------
| START HOUSE ROUND
|--------------------------------------------------------------------------
*/

function startHouseRound(
    gameName
) {
    const bettingSeconds =
        BETTING_TIMERS[
            gameName
        ] || 20;

    const now =
        Date.now();

    const round = {
        id:
            `${gameName}-${now}-${crypto
                .randomBytes(4)
                .toString("hex")}`,

        game:
            gameName,

        status:
            "BETTING",

        createdAt:
            nowIso(),

        startedAt:
            nowIso(),

        bettingSeconds,

        bettingStartedAt:
            now,

        bettingEndsAt:
            now +
            bettingSeconds *
                1000,

        drawnNumbers: [],

        drawIndex:
            0,

        currentNumber:
            null,

        result:
            null,

        crashPoint:
            null,

        multiplier:
            1.00
    };

    /*
    |--------------------------------------------------------------------------
    | KENO SECRET DRAW
    |--------------------------------------------------------------------------
    */

    if (
        gameName === "keno"
    ) {
        round.secretDraw =
            generateKenoDraw();
    }

    /*
    |--------------------------------------------------------------------------
    | AVIATOR SECRET CRASH POINT
    |--------------------------------------------------------------------------
    */

    if (
        gameName === "aviator"
    ) {
        round.secretCrashPoint =
            generateCrashPoint();
    }

    /*
    |--------------------------------------------------------------------------
    | SET ACTIVE ROUND
    |--------------------------------------------------------------------------
    */

    rounds[gameName] =
        round;

    saveRound(
        round
    ).catch(error => {
        console.error(
            "Initial round save error:",
            error
        );
    });

    /*
    |--------------------------------------------------------------------------
    | SERVER TIMER
    |--------------------------------------------------------------------------
    */

    setTimeout(
        () => {
            const current =
                rounds[gameName];

            /*
            |--------------------------------------------------------------------------
            | NEVER START A NEW ROUND'S DRAWING PHASE BY ACCIDENT
            |--------------------------------------------------------------------------
            */

            if (
                !current ||
                current.id !==
                    round.id ||
                current.status !==
                    "BETTING"
            ) {
                return;
            }

            if (
                gameName === "keno"
            ) {
                startKenoDraw(
                    gameName,
                    round.id
                );
            }

            if (
                gameName ===
                "roulette"
            ) {
                startRouletteSpin(
                    round.id
                );
            }

            if (
                gameName ===
                "aviator"
            ) {
                startAviatorFlight(
                    round.id
                );
            }
        },
        bettingSeconds * 1000
    );
}

/*
|--------------------------------------------------------------------------
| SAVE HOUSE ROUND
|--------------------------------------------------------------------------
*/

async function saveRound(
    round
) {
    const payload = {
        round_id:
            round.id,

        game:
            round.game,

        status:
            round.status,

        betting_seconds:
            round.bettingSeconds,

        betting_started_at:
            new Date(
                round.bettingStartedAt
            ).toISOString(),

        betting_ends_at:
            new Date(
                round.bettingEndsAt
            ).toISOString(),

        drawn_numbers:
            round.drawnNumbers,

        current_number:
            round.currentNumber,

        result:
            round.result,

        multiplier:
            round.multiplier,

        crash_point:
            round.crashPoint,

        updated_at:
            nowIso()
    };

    const {
        error
    } = await supabase
        .from("game_rounds")
        .upsert(
            payload,
            {
                onConflict:
                    "round_id"
            }
        );

    if (error) {
        dbError(
            "saveRound",
            error
        );

        throw error;
    }
}

/*
|--------------------------------------------------------------------------
| PUBLIC ROUND STATE
|--------------------------------------------------------------------------
|
| This is the important part for frontend countdown synchronization.
|
| The frontend receives:
|
|   serverTime
|   bettingStartedAt
|   bettingEndsAt
|   remainingSeconds
|
| The frontend should calculate the countdown from bettingEndsAt instead
| of creating its own independent 30-second round.
|
|--------------------------------------------------------------------------
*/

function getPublicRound(
    gameName
) {
    const round =
        rounds[gameName];

    if (!round) {
        return null;
    }

    const now =
        Date.now();

    const remainingMilliseconds =
        Math.max(
            0,
            round.bettingEndsAt -
                now
        );

    return {
        id:
            round.id,

        game:
            round.game,

        status:
            round.status,

        createdAt:
            round.createdAt,

        serverTime:
            nowIso(),

        bettingSeconds:
            round.bettingSeconds,

        bettingStartedAt:
            new Date(
                round.bettingStartedAt
            ).toISOString(),

        bettingEndsAt:
            new Date(
                round.bettingEndsAt
            ).toISOString(),

        remainingMilliseconds,

        remainingSeconds:
            Math.ceil(
                remainingMilliseconds /
                    1000
            ),

        drawnNumbers:
            [...round.drawnNumbers],

        currentNumber:
            round.currentNumber,

        result:
            round.result,

        multiplier:
            round.multiplier,

        /*
        |--------------------------------------------------------------------------
        | DO NOT REVEAL THE AVIATOR CRASH POINT BEFORE THE CRASH.
        |--------------------------------------------------------------------------
        */

        crashPoint:
            round.status ===
            "CRASHED"
                ? round.crashPoint
                : null
    };
}

/*
|--------------------------------------------------------------------------
| START KENO DRAW
|--------------------------------------------------------------------------
*/

function startKenoDraw(
    gameName,
    roundId
) {
    const round =
        rounds[gameName];

    if (
        !round ||
        round.id !== roundId ||
        round.status !==
            "BETTING"
    ) {
        return;
    }

    round.status =
        "DRAWING";

    round.drawIndex =
        0;

    round.drawnNumbers =
        [];

    round.currentNumber =
        null;

    saveRound(
        round
    ).catch(console.error);

    revealNextKenoNumber(
        gameName,
        roundId
    );
}

/*
|--------------------------------------------------------------------------
| REVEAL KENO NUMBER
|--------------------------------------------------------------------------
*/

function revealNextKenoNumber(
    gameName,
    roundId
) {
    const round =
        rounds[gameName];

    if (
        !round ||
        round.id !== roundId ||
        round.status !==
            "DRAWING"
    ) {
        return;
    }

    if (
        round.drawIndex >=
        round.secretDraw.length
    ) {
        finishHouseRound(
            gameName,
            roundId
        );

        return;
    }

    const number =
        round.secretDraw[
            round.drawIndex
        ];

    round.currentNumber =
        number;

    round.drawnNumbers.push(
        number
    );

    round.drawIndex++;

    saveRound(
        round
    ).catch(console.error);

    setTimeout(
        () => {
            revealNextKenoNumber(
                gameName,
                roundId
            );
        },
        DRAW_INTERVALS.keno
    );
}

/*
|--------------------------------------------------------------------------
| START ROULETTE
|--------------------------------------------------------------------------
*/

function startRouletteSpin(
    roundId
) {
    const round =
        rounds.roulette;

    if (
        !round ||
        round.id !== roundId ||
        round.status !==
            "BETTING"
    ) {
        return;
    }

    round.status =
        "SPINNING";

    saveRound(
        round
    ).catch(console.error);

    setTimeout(
        async () => {
            const current =
                rounds.roulette;

            if (
                !current ||
                current.id !==
                    roundId ||
                current.status !==
                    "SPINNING"
            ) {
                return;
            }

            try {
                current.result =
                    typeof roulette.spin ===
                    "function"
                        ? roulette.spin()
                        : crypto.randomInt(
                              0,
                              37
                          );

                current.status =
                    "FINISHED";

                await saveRound(
                    current
                );

                finishHouseRound(
                    "roulette",
                    roundId
                );
            } catch (error) {
                console.error(
                    "Roulette round error:",
                    error
                );

                finishHouseRound(
                    "roulette",
                    roundId
                );
            }
        },
        DRAW_INTERVALS.roulette
    );
}

/*
|--------------------------------------------------------------------------
| START AVIATOR FLIGHT
|--------------------------------------------------------------------------
*/

function startAviatorFlight(
    roundId
) {
    const round =
        rounds.aviator;

    if (
        !round ||
        round.id !== roundId ||
        round.status !==
            "BETTING"
    ) {
        return;
    }

    round.status =
        "FLYING";

    round.flyingStartedAt =
        Date.now();

    saveRound(
        round
    ).catch(console.error);

    updateAviator(
        roundId
    );
}

/*
|--------------------------------------------------------------------------
| UPDATE AVIATOR
|--------------------------------------------------------------------------
*/

function updateAviator(
    roundId
) {
    const round =
        rounds.aviator;

    if (
        !round ||
        round.id !== roundId ||
        round.status !==
            "FLYING"
    ) {
        return;
    }

    const elapsed =
        (
            Date.now() -
            round.flyingStartedAt
        ) / 1000;

    /*
    |--------------------------------------------------------------------------
    | MULTIPLIER CURVE
    |--------------------------------------------------------------------------
    */

    const calculated =
        Math.pow(
            1.12,
            elapsed
        );

    /*
    |--------------------------------------------------------------------------
    | CRASH
    |--------------------------------------------------------------------------
    */

    if (
        calculated >=
        round.secretCrashPoint
    ) {
        round.multiplier =
            round.secretCrashPoint;

        round.crashPoint =
            round.secretCrashPoint;

        round.status =
            "CRASHED";

        saveRound(
            round
        ).catch(console.error);

        finishHouseRound(
            "aviator",
            roundId
        );

        return;
    }

    round.multiplier =
        Number(
            calculated.toFixed(2)
        );

    /*
    |--------------------------------------------------------------------------
    | SEND UPDATED STATE TO FRONTEND THROUGH POLLING
    |--------------------------------------------------------------------------
    */

    setTimeout(
        () => {
            updateAviator(
                roundId
            );
        },
        100
    );
}

/*
|--------------------------------------------------------------------------
| FINISH HOUSE ROUND
|--------------------------------------------------------------------------
*/

function finishHouseRound(
    gameName,
    roundId
) {
    const round =
        rounds[gameName];

    if (
        !round ||
        round.id !== roundId
    ) {
        return;
    }

    if (
        round.status !==
        "CRASHED"
    ) {
        round.status =
            "FINISHED";
    }

    saveRound(
        round
    ).catch(console.error);

    /*
    |--------------------------------------------------------------------------
    | CONTINUOUS 24/7 AUTO-RESET
    |--------------------------------------------------------------------------
    */

    setTimeout(
        () => {
            const current =
                rounds[gameName];

            if (
                !current ||
                current.id !==
                    roundId
            ) {
                return;
            }

            startHouseRound(
                gameName
            );
        },
        NEXT_ROUND_DELAY
    );
}

/*
|--------------------------------------------------------------------------
| REST API — ACCOUNT REGISTER
|--------------------------------------------------------------------------
*/

app.post(
    "/api/account/register",
    async (req, res) => {
        try {
            const {
                telegramId,
                telegramName,
                password
            } = req.body || {};

            const player =
                await createPlayer({
                    telegramId,
                    telegramName,
                    password
                });

            const token =
                createSession(
                    player
                );

            res.json({
                success: true,
                token,
                player
            });
        } catch (error) {
            console.error(
                "Register error:",
                error
            );

            res
                .status(400)
                .json({
                    success: false,
                    error:
                        error.message ||
                        "Registration failed"
                });
        }
    }
);

/*
|--------------------------------------------------------------------------
| REST API — ACCOUNT LOGIN
|--------------------------------------------------------------------------
*/

app.post(
    "/api/account/login",
    async (req, res) => {
        try {
            const {
                telegramId,
                password
            } = req.body || {};

            const player =
                await authenticatePlayer(
                    telegramId,
                    password
                );

            const token =
                createSession(
                    player
                );

            res.json({
                success: true,
                token,
                player
            });
        } catch (error) {
            console.error(
                "Login error:",
                error
            );

            res
                .status(401)
                .json({
                    success: false,
                    error:
                        error.message ||
                        "Login failed"
                });
        }
    }
);

/*
|--------------------------------------------------------------------------
| REST API — CURRENT ACCOUNT
|--------------------------------------------------------------------------
*/

app.get(
    "/api/account/me",
    requirePlayer,
    async (req, res) => {
        res.json({
            success: true,

            player: {
                playerId:
                    req.player
                        .player_id,

                telegramId:
                    req.player
                        .telegram_id,

                telegramName:
                    req.player
                        .telegram_name,

                balance:
                    Number(
                        req.player
                            .balance ||
                            0
                    )
            }
        });
    }
);

/*
|--------------------------------------------------------------------------
| REST API — WALLET
|--------------------------------------------------------------------------
*/

app.get(
    "/api/wallet",
    requirePlayer,
    async (req, res) => {
        try {
            const {
                data,
                error
            } = await supabase
                .from(
                    "wallet_transactions"
                )
                .select(
                    "amount,type,status,game,round_id,created_at"
                )
                .eq(
                    "player_id",
                    req.player
                        .player_id
                )
                .order(
                    "created_at",
                    {
                        ascending:
                            false
                    }
                )
                .limit(100);

            if (error) {
                dbError(
                    "wallet",
                    error
                );

                throw new Error(
                    "Could not load wallet"
                );
            }

            /*
            |--------------------------------------------------------------------------
            | GET FRESH PLAYER BALANCE
            |--------------------------------------------------------------------------
            */

            const freshPlayer =
                await findPlayerById(
                    req.player
                        .player_id
                );

            res.json({
                success: true,

                balance:
                    Number(
                        freshPlayer
                            ?.balance ||
                            0
                    ),

                transactions:
                    data || []
            });
        } catch (error) {
            console.error(
                "Wallet error:",
                error
            );

            res
                .status(500)
                .json({
                    success: false,
                    error:
                        "Could not load wallet"
                });
        }
    }
);

/*
|--------------------------------------------------------------------------
| REST API — BINGO ROOMS
|--------------------------------------------------------------------------
*/

app.get(
    "/api/bingo/rooms",
    (req, res) => {
        const roomState =
            {};

        BINGO_TIERS.forEach(
            tier => {
                const room =
                    bingoRooms[
                        tier
                    ];

                if (!room) {
                    return;
                }

                const grossPool =
                    Number(
                        (
                            room.players
                                .length *
                            room.entryFee
                        ).toFixed(2)
                    );

                const remainingMs =
                    room.status ===
                    "BETTING"
                        ? Math.max(
                              0,
                              room.bettingEndsAt -
                                  Date.now()
                          )
                        : 0;

                roomState[
                    tier
                ] = {
                    tier,

                    entryFee:
                        room.entryFee,

                    status:
                        room.status,

                    serverTime:
                        nowIso(),

                    bettingStartedAt:
                        new Date(
                            room.bettingStartedAt
                        ).toISOString(),

                    bettingEndsAt:
                        new Date(
                            room.bettingEndsAt
                        ).toISOString(),

                    remainingMilliseconds:
                        remainingMs,

                    remainingSeconds:
                        Math.ceil(
                            remainingMs /
                                1000
                        ),

                    totalPlayers:
                        room.players
                            .length,

                    grossPool,

                    winnerPrize:
                        Number(
                            (
                                grossPool *
                                (
                                    1 -
                                    HOUSE_RAKE_PERCENT
                                )
                            ).toFixed(2)
                        ),

                    currentNumber:
                        room.currentNumber,

                    drawnNumbers:
                        room.drawnNumbers,

                    winner:
                        room.winner
                            ? room
                                  .winner
                                  .telegramName
                            : null
                };
            }
        );

        res.json({
            success: true,
            serverTime:
                nowIso(),
            rooms:
                roomState
        });
    }
);

/*
|--------------------------------------------------------------------------
| REST API — JOIN BINGO
|--------------------------------------------------------------------------
*/

app.post(
    "/api/bingo/join",
    requirePlayer,
    async (req, res) => {
        try {
            const {
                tier,
                cartelaNumber
            } = req.body || {};

            const selectedTier =
                Number(tier);

            const room =
                bingoRooms[
                    selectedTier
                ];

            /*
            |--------------------------------------------------------------------------
            | VALIDATE ROOM
            |--------------------------------------------------------------------------
            */

            if (!room) {
                return res
                    .status(404)
                    .json({
                        success: false,
                        error:
                            "Invalid bingo room tier"
                    });
            }

            /*
            |--------------------------------------------------------------------------
            | BETTING MUST STILL BE OPEN
            |--------------------------------------------------------------------------
            */

            if (
                room.status !==
                "BETTING"
            ) {
                return res
                    .status(400)
                    .json({
                        success: false,
                        error:
                            "Betting closed for active round"
                    });
            }

            /*
            |--------------------------------------------------------------------------
            | SERVER-SIDE TIME CHECK
            |--------------------------------------------------------------------------
            */

            if (
                Date.now() >=
                room.bettingEndsAt
            ) {
                return res
                    .status(400)
                    .json({
                        success: false,
                        error:
                            "Betting time has expired"
                    });
            }

            /*
            |--------------------------------------------------------------------------
            | VALIDATE CARTELA NUMBER
            |--------------------------------------------------------------------------
            */

            const selectedCartela =
                Number(
                    cartelaNumber
                );

            if (
                !Number.isInteger(
                    selectedCartela
                ) ||
                selectedCartela <
                    1 ||
                selectedCartela >
                    120
            ) {
                return res
                    .status(400)
                    .json({
                        success: false,
                        error:
                            "Cartela number must be between 1 and 120"
                    });
            }

            /*
            |--------------------------------------------------------------------------
            | PREVENT SAME PLAYER JOINING SAME ROOM TWICE
            |--------------------------------------------------------------------------
            */

            const alreadyJoined =
                room.players.some(
                    player =>
                        player.playerId ===
                        req.player
                            .player_id
                );

            if (alreadyJoined) {
                return res
                    .status(400)
                    .json({
                        success: false,
                        error:
                            "You have already joined this round"
                    });
            }

            /*
            |--------------------------------------------------------------------------
            | GENERATE CARTELA
            |--------------------------------------------------------------------------
            */

            if (
                typeof bingo.generateCartela !==
                "function"
            ) {
                throw new Error(
                    "Bingo cartela generator is unavailable"
                );
            }

            const playerCartela =
                bingo.generateCartela(
                    selectedCartela
                );

            /*
            |--------------------------------------------------------------------------
            | CHARGE ENTRY FEE
            |--------------------------------------------------------------------------
            |
            | Money is removed BEFORE the player is added to the room.
            | If charging fails, the player is not added.
            |--------------------------------------------------------------------------
            */

            await changeBalance({
                playerId:
                    req.player
                        .player_id,

                amount:
                    -selectedTier,

                type:
                    "bingo_entry",

                game:
                    "bingo",

                roundId:
                    room.id,

                metadata: {
                    tier:
                        selectedTier,

                    cartelaNumber:
                        selectedCartela
                }
            });

            /*
            |--------------------------------------------------------------------------
            | RE-CHECK ROOM AFTER WALLET OPERATION
            |--------------------------------------------------------------------------
            |
            | This protects against the room changing while the database
            | operation was happening.
            |--------------------------------------------------------------------------
            */

            if (
                bingoRooms[
                    selectedTier
                ] !== room ||
                room.status !==
                    "BETTING" ||
                Date.now() >=
                    room.bettingEndsAt
            ) {
                /*
                |--------------------------------------------------------------------------
                | REFUND IF ROUND CLOSED DURING OPERATION
                |--------------------------------------------------------------------------
                */

                try {
                    await changeBalance({
                        playerId:
                            req.player
                                .player_id,

                        amount:
                            selectedTier,

                        type:
                            "bingo_entry_refund",

                        game:
                            "bingo",

                        roundId:
                            room.id,

                        metadata: {
                            reason:
                                "Round closed during join"
                        }
                    });
                } catch (
                    refundError
                ) {
                    console.error(
                        "CRITICAL BINGO REFUND ERROR:",
                        refundError
                    );
                }

                return res
                    .status(400)
                    .json({
                        success: false,
                        error:
                            "Round closed. Entry fee refunded if possible."
                    });
            }

            /*
            |--------------------------------------------------------------------------
            | ADD PLAYER
            |--------------------------------------------------------------------------
            */

            room.players.push({
                playerId:
                    req.player
                        .player_id,

                telegramName:
                    req.player
                        .telegram_name,

                cartelaNumber:
                    selectedCartela,

                cartela:
                    playerCartela
            });

            const grossPool =
                Number(
                    (
                        room.players
                            .length *
                        room.entryFee
                    ).toFixed(2)
                );

            res.json({
                success: true,

                tier:
                    selectedTier,

                roundId:
                    room.id,

                playersInRoom:
                    room.players
                        .length,

                grossPool,

                winnerPrize:
                    Number(
                        (
                            grossPool *
                            (
                                1 -
                                HOUSE_RAKE_PERCENT
                            )
                        ).toFixed(2)
                    )
            });
        } catch (error) {
            console.error(
                "Bingo join error:",
                error
            );

            res
                .status(400)
                .json({
                    success: false,
                    error:
                        error.message ||
                        "Could not join Bingo"
                });
        }
    }
);

/*
|--------------------------------------------------------------------------
| REST API — GET BINGO CARTELA
|--------------------------------------------------------------------------
*/

app.get(
    "/api/bingo/cartela/:number",
    (req, res) => {
        try {
            const number =
                Number(
                    req.params.number
                );

            if (
                !Number.isInteger(
                    number
                ) ||
                number < 1 ||
                number > 120
            ) {
                return res
                    .status(400)
                    .json({
                        success: false,
                        error:
                            "Cartela number must be between 1 and 120"
                    });
            }

            if (
                typeof bingo.generateCartela !==
                "function"
            ) {
                return res
                    .status(500)
                    .json({
                        success: false,
                        error:
                            "Bingo cartela generator unavailable"
                    });
            }

            const cartela =
                bingo.generateCartela(
                    number
                );

            res.json({
                success: true,
                cartela
            });
        } catch (error) {
            console.error(
                "Cartela error:",
                error
            );

            res
                .status(400)
                .json({
                    success: false,
                    error:
                        error.message ||
                        "Could not generate cartela"
                });
        }
    }
);

/*
|--------------------------------------------------------------------------
| REST API — ALL HOUSE GAME STATUS
|--------------------------------------------------------------------------
*/

app.get(
    "/api/status",
    (req, res) => {
        const houseState =
            {};

        for (
            const gameName of
            Object.keys(games)
        ) {
            houseState[
                gameName
            ] =
                getPublicRound(
                    gameName
                );
        }

        res.json({
            success: true,

            status:
                "online",

            serverTime:
                nowIso(),

            serverTimestamp:
                Date.now(),

            games:
                houseState
        });
    }
);

/*
|--------------------------------------------------------------------------
| REST API — SINGLE GAME ROUND
|--------------------------------------------------------------------------
*/

app.get(
    "/api/game/:game/round",
    (req, res) => {
        const gameName =
            req.params.game;

        if (
            !games[
                gameName
            ]
        ) {
            return res
                .status(404)
                .json({
                    success: false,
                    error:
                        "Game not found"
                });
        }

        res.json({
            success: true,

            serverTime:
                nowIso(),

            serverTimestamp:
                Date.now(),

            round:
                getPublicRound(
                    gameName
                )
        });
    }
);

/*
|--------------------------------------------------------------------------
| HEALTH CHECK
|--------------------------------------------------------------------------
*/

app.get(
    "/health",
    (req, res) => {
        res.json({
            success: true,
            status:
                "healthy",
            serverTime:
                nowIso()
        });
    }
);

/*
|--------------------------------------------------------------------------
| 404 API HANDLER
|--------------------------------------------------------------------------
*/

app.use(
    "/api",
    (req, res) => {
        res
            .status(404)
            .json({
                success: false,
                error:
                    "API endpoint not found"
            });
    }
);

/*
|--------------------------------------------------------------------------
| GLOBAL ERROR HANDLER
|--------------------------------------------------------------------------
*/

app.use(
    (error, req, res, next) => {
        console.error(
            "Unhandled Express error:",
            error
        );

        if (
            res.headersSent
        ) {
            return next(
                error
            );
        }

        res
            .status(500)
            .json({
                success: false,
                error:
                    "Internal server error"
            });
    }
);

/*
|--------------------------------------------------------------------------
| GRACEFUL SHUTDOWN
|--------------------------------------------------------------------------
*/

let server = null;

async function gracefulShutdown(
    signal
) {
    console.log(
        `[SERVER] ${signal} received. Shutting down...`
    );

    if (!server) {
        process.exit(0);
    }

    server.close(
        () => {
            console.log(
                "[SERVER] HTTP server closed."
            );

            process.exit(0);
        }
    );

    /*
    |--------------------------------------------------------------------------
    | FORCE EXIT AFTER 10 SECONDS
    |--------------------------------------------------------------------------
    */

    setTimeout(
        () => {
            console.error(
                "[SERVER] Forced shutdown."
            );

            process.exit(1);
        },
        10000
    );
}

process.on(
    "SIGTERM",
    () => {
        gracefulShutdown(
            "SIGTERM"
        );
    }
);

process.on(
    "SIGINT",
    () => {
        gracefulShutdown(
            "SIGINT"
        );
    }
);

/*
|--------------------------------------------------------------------------
| UNHANDLED PROMISE/EXCEPTION LOGGING
|--------------------------------------------------------------------------
*/

process.on(
    "unhandledRejection",
    error => {
        console.error(
            "[UNHANDLED REJECTION]",
            error
        );
    }
);

process.on(
    "uncaughtException",
    error => {
        console.error(
            "[UNCAUGHT EXCEPTION]",
            error
        );
    }
);

/*
|--------------------------------------------------------------------------
| LAUNCH SERVER & ENGINES
|--------------------------------------------------------------------------
*/

server = app.listen(
    PORT,
    "0.0.0.0",
    async () => {
        console.log(
            "========================================"
        );

        console.log(
            "       DESTA PLAY BACKEND SERVER        "
        );

        console.log(
            "========================================"
        );

        console.log(
            `Port: ${PORT}`
        );

        console.log(
            "Server: 0.0.0.0"
        );

        console.log(
            "Bingo PVP Rooms: 10 ETB - 500 ETB"
        );

        console.log(
            "Bingo Pool: 90% Winner / 10% Platform Rake"
        );

        console.log(
            "House Games: Keno, Roulette, Aviator"
        );

        console.log(
            `Configured RTP Target: ${
                TARGET_RTP * 100
            }%`
        );

        console.log(
            "========================================"
        );

        /*
        |--------------------------------------------------------------------------
        | START BINGO ROOMS
        |--------------------------------------------------------------------------
        */

        initBingoRooms();

        /*
        |--------------------------------------------------------------------------
        | START HOUSE GAMES
        |--------------------------------------------------------------------------
        */

        for (
            const gameName of
            Object.keys(games)
        ) {
            startHouseRound(
                gameName
            );
        }

        console.log(
            "========================================"
        );

        console.log(
            "       ALL GAME ENGINES STARTED         "
        );

        console.log(
            "========================================"
        );
    }
);
