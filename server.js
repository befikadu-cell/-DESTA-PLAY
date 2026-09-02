/*
|--------------------------------------------------------------------------
| DESTA PLAY — 24/7 CONTINUOUS BACKEND ENGINE
|--------------------------------------------------------------------------
|
| Features:
|   - Multi-Tier PVP Bingo
|   - Server-authoritative game rounds
|   - Permanent Supabase player/balance/transaction storage
|   - Argon2 password hashing
|   - Server-side authentication
|   - Server-synchronized countdowns
|   - Continuous 24/7 game loops
|   - Engine-defined minimum bet validation
|   - Keno / Bingo / Roulette / Aviator
|
|--------------------------------------------------------------------------
*/

"use strict";

import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";
import argon2 from "argon2";
import { createClient } from "@supabase/supabase-js";

import * as keno from "./games/keno.js";
import * as bingo from "./games/bingo.js";
import * as roulette from "./games/roulette.js";
import * as aviator from "./games/aviator.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/*
|--------------------------------------------------------------------------
| ENVIRONMENT
|--------------------------------------------------------------------------
*/

const PORT = Number(process.env.PORT || 10000);

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SESSION_SECRET = process.env.SESSION_SECRET;

if (!SUPABASE_URL) {
    throw new Error("Missing SUPABASE_URL");
}

if (!SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
}

if (!SESSION_SECRET) {
    throw new Error("Missing SESSION_SECRET");
}

/*
|--------------------------------------------------------------------------
| SUPABASE
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
| EXPRESS
|--------------------------------------------------------------------------
*/

const app = express();

app.use(cors());
app.use(express.json({ limit: "100kb" }));
app.use(express.static(path.join(__dirname, "public")));

/*
|--------------------------------------------------------------------------
| GAME ENGINES
|--------------------------------------------------------------------------
*/

const games = {
    keno,
    bingo,
    roulette,
    aviator
};

const rounds = {};

/*
|--------------------------------------------------------------------------
| ENGINE TIMING
|--------------------------------------------------------------------------
*/

const DRAW_INTERVALS = {
    bingo: 3000,
    keno: 3000,
    roulette: 3000,
    aviator: 100
};

const BETTING_TIMERS = {
    bingo: Number(bingo.BETTING_SECONDS || 40),
    keno: Number(keno.BETTING_SECONDS || 40),
    roulette: Number(roulette.BETTING_SECONDS || 40),
    aviator: Number(aviator.BETTING_SECONDS || 10)
};

const NEXT_ROUND_DELAY = 5000;

/*
|--------------------------------------------------------------------------
| PVP BINGO
|--------------------------------------------------------------------------
|
| IMPORTANT:
| The engine is authoritative for valid bingo bet amounts.
| We do NOT create another conflicting minimum-bet rule here.
|
|--------------------------------------------------------------------------
*/

const bingoRooms = {};

/*
|--------------------------------------------------------------------------
| GENERAL HELPERS
|--------------------------------------------------------------------------
*/

function nowIso() {
    return new Date().toISOString();
}

function makeId(prefix = "DP") {
    return (
        `${prefix}-` +
        Date.now() +
        "-" +
        crypto.randomBytes(4).toString("hex")
    );
}

function makePlayerId() {
    return (
        "DP-" +
        crypto.randomBytes(4).toString("hex").toUpperCase()
    );
}

function normalizeTelegramName(name) {
    if (typeof name !== "string") {
        return "Player";
    }

    return (
        name
            .trim()
            .replace(/\s+/g, " ")
            .slice(0, 80) || "Player"
    );
}

function validPassword(password) {
    return (
        typeof password === "string" &&
        password.length >= 8 &&
        password.length <= 128
    );
}

function numericAmount(value) {
    const amount = Number(value);

    if (!Number.isFinite(amount)) {
        throw new Error("Invalid amount");
    }

    return amount;
}

async function dbError(context, error) {
    console.error(`[DATABASE ERROR] ${context}:`, {
        message: error?.message,
        code: error?.code,
        details: error?.details,
        hint: error?.hint
    });
}

/*
|--------------------------------------------------------------------------
| PLAYER DATABASE
|--------------------------------------------------------------------------
|
| The canonical player ID is players.id.
|
|--------------------------------------------------------------------------
*/

async function findPlayerByTelegramId(telegramId) {
    const { data, error } = await supabase
        .from("players")
        .select("*")
        .eq("telegram_id", String(telegramId))
        .maybeSingle();

    if (error) {
        await dbError("findPlayerByTelegramId", error);
        throw new Error("Database error");
    }

    return data;
}

async function findPlayerById(playerId) {
    const { data, error } = await supabase
        .from("players")
        .select("*")
        .eq("id", playerId)
        .maybeSingle();

    if (error) {
        await dbError("findPlayerById", error);
        throw new Error("Database error");
    }

    return data;
}

/*
|--------------------------------------------------------------------------
| PUBLIC PLAYER OBJECT
|--------------------------------------------------------------------------
*/

function publicPlayer(player) {
    if (!player) {
        return null;
    }

    return {
        playerId: player.id,
        telegramId: player.telegram_id,
        telegramName: player.username || "Player",
        balance: Number(player.balance || 0),
        createdAt: player.created_at
    };
}

/*
|--------------------------------------------------------------------------
| TRANSACTION LEDGER
|--------------------------------------------------------------------------
*/

async function writeTransaction({
    playerId,
    type,
    amount,
    balanceBefore,
    balanceAfter,
    status = "SUCCESS",
    description = null,
    referenceId = null
}) {
    const { error } = await supabase
        .from("transactions")
        .insert({
            id: makeId("TX"),
            player_id: playerId,
            type,
            amount,
            balance_before: balanceBefore,
            balance_after: balanceAfter,
            status,
            description,
            reference_id: referenceId,
            created_at: nowIso()
        });

    if (error) {
        await dbError("writeTransaction", error);

        /*
        |------------------------------------------------------------------
        | IMPORTANT
        |------------------------------------------------------------------
        | The balance operation has already happened.
        | Do not reverse it automatically here.
        | The database ledger error is logged for investigation.
        |------------------------------------------------------------------
        */

        throw new Error("Transaction ledger error");
    }
}

/*
|--------------------------------------------------------------------------
| BALANCE ENGINE
|--------------------------------------------------------------------------
*/

async function changeBalance({
    playerId,
    amount,
    type,
    game = null,
    roundId = null,
    description = null,
    metadata = {}
}) {
    const numeric = numericAmount(amount);

    const player = await findPlayerById(playerId);

    if (!player) {
        throw new Error("Player not found");
    }

    const before = Number(player.balance || 0);
    const after = before + numeric;

    if (after < 0) {
        throw new Error("Insufficient balance");
    }

    const { data, error } = await supabase
        .from("players")
        .update({
            balance: after,
            updated_at: nowIso()
        })
        .eq("id", playerId)
        .select("*")
        .maybeSingle();

    if (error) {
        await dbError("changeBalance update", error);
        throw new Error("Could not update balance");
    }

    if (!data) {
        throw new Error("Could not update player balance");
    }

    const finalDescription =
        description ||
        `${type}${game ? ` | ${game}` : ""}`;

    await writeTransaction({
        playerId,
        type,
        amount: numeric,
        balanceBefore: before,
        balanceAfter: after,
        status: "SUCCESS",
        description: finalDescription,
        referenceId: roundId
    });

    console.log(
        `[BALANCE] ${playerId} | ${before} -> ${after} | ${type}`
    );

    return after;
}

/*
|--------------------------------------------------------------------------
| SESSION SYSTEM
|--------------------------------------------------------------------------
|
| Sessions are intentionally kept in server memory.
|
| Permanent account data remains in Supabase.
|
| If Render restarts, users simply authenticate again.
|
|--------------------------------------------------------------------------
*/

const sessions = new Map();

function createSession(player) {
    const token = crypto.randomBytes(32).toString("hex");

    const tokenHash = crypto
        .createHmac("sha256", SESSION_SECRET)
        .update(token)
        .digest("hex");

    sessions.set(tokenHash, {
        playerId: player.id,
        createdAt: Date.now()
    });

    return token;
}

function getSessionPlayer(req) {
    const authorization =
        req.headers.authorization || "";

    if (!authorization.startsWith("Bearer ")) {
        return null;
    }

    const token = authorization
        .slice(7)
        .trim();

    if (!token) {
        return null;
    }

    const tokenHash = crypto
        .createHmac("sha256", SESSION_SECRET)
        .update(token)
        .digest("hex");

    return sessions.get(tokenHash) || null;
}

async function requirePlayer(req, res, next) {
    try {
        const session = getSessionPlayer(req);

        if (!session) {
            return res.status(401).json({
                success: false,
                error: "Unauthorized"
            });
        }

        const player =
            await findPlayerById(session.playerId);

        if (!player) {
            return res.status(401).json({
                success: false,
                error: "Player not found"
            });
        }

        req.player = player;

        next();
    } catch (error) {
        console.error("Authentication middleware error:", error);

        return res.status(401).json({
            success: false,
            error: "Authentication failed"
        });
    }
}

/*
|--------------------------------------------------------------------------
| ENGINE VALIDATION
|--------------------------------------------------------------------------
|
| The game files are authoritative for minimum bet amounts.
|
|--------------------------------------------------------------------------
*/

function validateEngineBet(engine, amount) {
    const value = Number(amount);

    if (!Number.isFinite(value) || value <= 0) {
        throw new Error("Invalid bet amount");
    }

    const validator =
        engine?.validateBetAmount ||
        engine?.default?.validateBetAmount;

    if (typeof validator === "function") {
        const result = validator(value);

        /*
        |--------------------------------------------------------------
        | Support validators that:
        |   - return boolean
        |   - return an object
        |   - throw an error
        |--------------------------------------------------------------
        */

        if (result === false) {
            throw new Error("Invalid bet amount");
        }

        if (
            result &&
            typeof result === "object" &&
            result.valid === false
        ) {
            throw new Error(
                result.error ||
                result.message ||
                "Invalid bet amount"
            );
        }

        return value;
    }

    /*
    |--------------------------------------------------------------
    | Do NOT invent a new minimum here.
    | If an engine doesn't expose a validator, the caller should
    | handle that engine-specific limitation.
    |--------------------------------------------------------------
    */

    return value;
}

/*
|--------------------------------------------------------------------------
| AUTH ROUTES
|--------------------------------------------------------------------------
*/

/*
|------------------------------------------------------------------
| REGISTER
|------------------------------------------------------------------
*/

async function registerHandler(req, res) {
    try {
        const {
            telegramId,
            telegramName,
            password
        } = req.body;

        if (
            telegramId === undefined ||
            telegramId === null ||
            String(telegramId).trim() === ""
        ) {
            return res.status(400).json({
                success: false,
                error: "Missing Telegram ID"
            });
        }

        if (!validPassword(password)) {
            return res.status(400).json({
                success: false,
                error:
                    "Password must be between 8 and 128 characters"
            });
        }

        const existing =
            await findPlayerByTelegramId(telegramId);

        if (existing) {
            return res.status(400).json({
                success: false,
                error:
                    "Account already exists. Please login."
            });
        }

        const passwordHash =
            await argon2.hash(password);

        const playerId = makePlayerId();

        const safeName =
            normalizeTelegramName(telegramName);

        const { data: insertedPlayer, error } =
            await supabase
                .from("players")
                .insert({
                    id: playerId,
                    telegram_id: String(telegramId),
                    username: safeName,
                    password_hash: passwordHash,
                    balance: 0,
                    created_at: nowIso(),
                    updated_at: nowIso()
                })
                .select("*")
                .single();

        if (error) {
            await dbError(
                "Register insert",
                error
            );

            return res.status(500).json({
                success: false,
                error:
                    "Failed to create player account"
            });
        }

        const token =
            createSession(insertedPlayer);

        return res.json({
            success: true,
            token,
            player: publicPlayer(insertedPlayer)
        });
    } catch (error) {
        console.error("Registration error:", error);

        return res.status(500).json({
            success: false,
            error:
                error.message ||
                "Registration failed"
        });
    }
}

app.post(
    "/api/auth/register",
    registerHandler
);

app.post(
    "/api/account/register",
    registerHandler
);

/*
|--------------------------------------------------------------------------
| LOGIN
|--------------------------------------------------------------------------
*/

async function loginHandler(req, res) {
    try {
        const {
            telegramId,
            password
        } = req.body;

        if (
            telegramId === undefined ||
            telegramId === null ||
            !password
        ) {
            return res.status(400).json({
                success: false,
                error: "Missing credentials"
            });
        }

        const player =
            await findPlayerByTelegramId(telegramId);

        if (!player) {
            return res.status(404).json({
                success: false,
                error:
                    "Account not found. Please register first."
            });
        }

        if (!player.password_hash) {
            return res.status(401).json({
                success: false,
                error:
                    "This account does not have a valid password. Please contact support."
            });
        }

        const valid =
            await argon2.verify(
                player.password_hash,
                password
            );

        if (!valid) {
            return res.status(401).json({
                success: false,
                error: "Incorrect password"
            });
        }

        const token =
            createSession(player);

        return res.json({
            success: true,
            token,
            player: publicPlayer(player)
        });
    } catch (error) {
        console.error("Login error:", error);

        return res.status(500).json({
            success: false,
            error:
                error.message ||
                "Login failed"
        });
    }
}

app.post(
    "/api/auth/login",
    loginHandler
);

app.post(
    "/api/account/login",
    loginHandler
);

/*
|--------------------------------------------------------------------------
| CURRENT ACCOUNT
|--------------------------------------------------------------------------
*/

async function meHandler(req, res) {
    return res.json({
        success: true,
        player: publicPlayer(req.player)
    });
}

app.get(
    "/api/auth/me",
    requirePlayer,
    meHandler
);

app.get(
    "/api/account/me",
    requirePlayer,
    meHandler
);

/*
|--------------------------------------------------------------------------
| LOGOUT
|--------------------------------------------------------------------------
*/

app.post(
    "/api/auth/logout",
    requirePlayer,
    (req, res) => {
        const authorization =
            req.headers.authorization || "";

        const token =
            authorization.slice(7).trim();

        if (token) {
            const tokenHash =
                crypto
                    .createHmac(
                        "sha256",
                        SESSION_SECRET
                    )
                    .update(token)
                    .digest("hex");

            sessions.delete(tokenHash);
        }

        res.json({
            success: true
        });
    }
);

app.post(
    "/api/account/logout",
    requirePlayer,
    (req, res) => {
        const authorization =
            req.headers.authorization || "";

        const token =
            authorization.slice(7).trim();

        if (token) {
            const tokenHash =
                crypto
                    .createHmac(
                        "sha256",
                        SESSION_SECRET
                    )
                    .update(token)
                    .digest("hex");

            sessions.delete(tokenHash);
        }

        res.json({
            success: true
        });
    }
);

/*
|--------------------------------------------------------------------------
| BALANCE
|--------------------------------------------------------------------------
*/

app.get(
    "/api/account/balance",
    requirePlayer,
    (req, res) => {
        res.json({
            success: true,
            balance: Number(
                req.player.balance || 0
            )
        });
    }
);

/*
|--------------------------------------------------------------------------
| BINGO ENGINE HELPERS
|--------------------------------------------------------------------------
*/

function getBingoCartela(number) {
    const value = Number(number);

    const getCartela =
        bingo.getCartela ||
        bingo.default?.getCartela;

    if (typeof getCartela !== "function") {
        throw new Error(
            "Bingo cartela engine is unavailable"
        );
    }

    return getCartela(value);
}

function bingoBetIsValid(amount) {
    return validateEngineBet(
        bingo,
        amount
    );
}

function isWinningBingoCard(
    card,
    drawnNumbers
) {
    const checkWinningPatterns =
        bingo.checkWinningPatterns ||
        bingo.default?.checkWinningPatterns;

    if (
        typeof checkWinningPatterns !==
        "function"
    ) {
        return false;
    }

    const numberSet =
        drawnNumbers instanceof Set
            ? drawnNumbers
            : new Set(drawnNumbers);

    return Boolean(
        checkWinningPatterns(
            card,
            numberSet
        )
    );
}

/*
|--------------------------------------------------------------------------
| BINGO DRAW
|--------------------------------------------------------------------------
*/

function generateBingoDraw() {
    const numbers =
        Array.from(
            { length: 75 },
            (_, index) => index + 1
        );

    const result = [];

    while (numbers.length > 0) {
        const index =
            crypto.randomInt(
                0,
                numbers.length
            );

        result.push(
            numbers.splice(index, 1)[0]
        );
    }

    return result;
}

/*
|--------------------------------------------------------------------------
| SAVE BINGO ROUND
|--------------------------------------------------------------------------
*/

async function saveBingoRound(tier) {
    const room =
        bingoRooms[tier];

    if (!room) {
        return;
    }

    const payload = {
        id: room.id,
        round_id: room.id,
        game: "bingo",
        tier_id: tier,
        status: room.status,
        betting_seconds:
            BETTING_TIMERS.bingo,
        betting_started_at:
            new Date(
                room.bettingStartedAt
            ).toISOString(),
        betting_ends_at:
            new Date(
                room.bettingEndsAt
            ).toISOString(),
        drawn_numbers:
            room.drawnNumbers,
        current_number:
            room.currentNumber,
        result:
            room.winner
                ? {
                    winner:
                        room.winner.playerId,
                    prize:
                        room.winnerPrize
                }
                : null,
        engine_state: {
            drawIndex:
                room.drawIndex,

            players:
                room.players.map(
                    player => ({
                        playerId:
                            player.playerId,
                        telegramName:
                            player.telegramName,
                        cartelaNumber:
                            player.cartelaNumber,
                        cartela:
                            player.cartela
                    })
                ),

            winner:
                room.winner
                    ? {
                        playerId:
                            room.winner.playerId,
                        telegramName:
                            room.winner.telegramName,
                        cartelaNumber:
                            room.winner.cartelaNumber
                    }
                    : null,

            totalPool:
                room.totalPool,

            houseRake:
                room.houseRake,

            winnerPrize:
                room.winnerPrize
        },
        updated_at: nowIso()
    };

    const { error } =
        await supabase
            .from("game_rounds")
            .upsert(
                payload,
                {
                    onConflict: "id"
                }
            );

    if (error) {
        await dbError(
            `saveBingoRound tier ${tier}`,
            error
        );
    }
}

/*
|--------------------------------------------------------------------------
| START BINGO ROUND
|--------------------------------------------------------------------------
*/

function startNewBingoRound(tier) {
    let entryFee;

    try {
        entryFee =
            bingoBetIsValid(tier);
    } catch (error) {
        console.error(
            `[BINGO] Engine rejected configured tier ${tier}:`,
            error.message
        );

        return;
    }

    const now =
        Date.now();

    const bettingEndsAt =
        now +
        BETTING_TIMERS.bingo *
        1000;

    const room = {
        id:
            `bingo-${entryFee}-${now}-` +
            crypto
                .randomBytes(4)
                .toString("hex"),

        tierId: entryFee,

        entryFee,

        status: "BETTING",

        createdAt: now,

        bettingStartedAt: now,

        bettingEndsAt,

        players: [],

        secretDraw:
            generateBingoDraw(),

        drawnNumbers: [],

        drawIndex: 0,

        currentNumber: null,

        winner: null,

        totalPool: 0,

        houseRake: 0,

        winnerPrize: 0
    };

    bingoRooms[entryFee] =
        room;

    console.log(
        `[BINGO ${entryFee}] NEW ROUND ${room.id}`
    );

    saveBingoRound(
        entryFee
    ).catch(console.error);

    setTimeout(
        () => {
            const current =
                bingoRooms[entryFee];

            if (
                !current ||
                current.id !== room.id ||
                current.status !==
                    "BETTING"
            ) {
                return;
            }

            startBingoDrawPhase(
                entryFee
            );
        },
        BETTING_TIMERS.bingo *
            1000
    );
}

/*
|--------------------------------------------------------------------------
| START BINGO DRAWING
|--------------------------------------------------------------------------
*/

function startBingoDrawPhase(tier) {
    const room =
        bingoRooms[tier];

    if (
        !room ||
        room.status !== "BETTING"
    ) {
        return;
    }

    room.status = "DRAWING";
    room.drawIndex = 0;
    room.drawnNumbers = [];
    room.currentNumber = null;

    saveBingoRound(
        tier
    ).catch(console.error);

    revealNextBingoNumber(
        tier
    );
}

/*
|--------------------------------------------------------------------------
| REVEAL BINGO NUMBER
|--------------------------------------------------------------------------
*/

function revealNextBingoNumber(tier) {
    const room =
        bingoRooms[tier];

    if (
        !room ||
        room.status !== "DRAWING"
    ) {
        return;
    }

    if (
        room.drawIndex >=
        room.secretDraw.length
    ) {
        resolveBingoWinner(
            tier
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

    console.log(
        `[BINGO ${tier}] DRAW ${room.drawIndex}/75 -> ${number}`
    );

    saveBingoRound(
        tier
    ).catch(console.error);

    let winningPlayer = null;

    for (
        const player of room.players
    ) {
        if (
            isWinningBingoCard(
                player.cartela,
                room.drawnNumbers
            )
        ) {
            winningPlayer =
                player;

            break;
        }
    }

    if (winningPlayer) {
        resolveBingoWinner(
            tier,
            winningPlayer
        );

        return;
    }

    setTimeout(
        () => {
            const current =
                bingoRooms[tier];

            if (
                !current ||
                current.id !== room.id ||
                current.status !==
                    "DRAWING"
            ) {
                return;
            }

            revealNextBingoNumber(
                tier
            );
        },
        DRAW_INTERVALS.bingo
    );
}

/*
|--------------------------------------------------------------------------
| RESOLVE BINGO
|--------------------------------------------------------------------------
*/

async function resolveBingoWinner(
    tier,
    winnerObj = null
) {
    const room =
        bingoRooms[tier];

    if (
        !room ||
        room.status === "FINISHED"
    ) {
        return;
    }

    room.status = "FINISHED";

    const grossPool =
        room.players.length *
        room.entryFee;

    /*
    |--------------------------------------------------------------
    | Existing rule:
    | 90% player pool
    | 10% platform rake
    |--------------------------------------------------------------
    */

    const houseRake =
        grossPool * 0.10;

    const winnerPrize =
        grossPool - houseRake;

    room.totalPool =
        grossPool;

    room.houseRake =
        houseRake;

    room.winnerPrize =
        winnerPrize;

    const winningPlayer =
        winnerObj;

    if (winningPlayer) {
        room.winner =
            winningPlayer;

        try {
            await changeBalance({
                playerId:
                    winningPlayer.playerId,

                amount:
                    winnerPrize,

                type:
                    "bingo_win",

                game:
                    "bingo",

                roundId:
                    room.id,

                description:
                    `Bingo prize - tier ${tier}`,

                metadata: {
                    tier,
                    grossPool,
                    houseRake,
                    winnerPrize
                }
            });

            console.log(
                `[BINGO ${tier}] WINNER ${winningPlayer.playerId} -> ${winnerPrize} ETB`
            );
        } catch (error) {
            console.error(
                `[BINGO ${tier}] PAYOUT ERROR:`,
                error
            );
        }
    } else {
        console.log(
            `[BINGO ${tier}] No winning card`
        );
    }

    await saveBingoRound(
        tier
    ).catch(console.error);

    setTimeout(
        () => {
            startNewBingoRound(
                tier
            );
        },
        NEXT_ROUND_DELAY
    );
}

/*
|--------------------------------------------------------------------------
| BINGO JOIN
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
            } = req.body;

            const selectedTier =
                Number(tier);

            const selectedCartela =
                Number(cartelaNumber);

            /*
            |----------------------------------------------------------
            | ENGINE VALIDATES BET AMOUNT
            |----------------------------------------------------------
            */

            let entryFee;

            try {
                entryFee =
                    bingoBetIsValid(
                        selectedTier
                    );
            } catch (error) {
                return res.status(400).json({
                    success: false,
                    error:
                        error.message ||
                        "Invalid bingo bet amount"
                });
            }

            const room =
                bingoRooms[entryFee];

            if (
                !room ||
                room.status !== "BETTING"
            ) {
                return res.status(400).json({
                    success: false,
                    error:
                        "Betting is closed for this room"
                });
            }

            if (
                !Number.isInteger(
                    selectedCartela
                ) ||
                selectedCartela < 1 ||
                selectedCartela > 120
            ) {
                return res.status(400).json({
                    success: false,
                    error:
                        "Cartela number must be between 1 and 120"
                });
            }

            const alreadyJoined =
                room.players.some(
                    player =>
                        player.playerId ===
                        req.player.id
                );

            if (alreadyJoined) {
                return res.status(400).json({
                    success: false,
                    error:
                        "Player already joined this round"
                });
            }

            const playerCartela =
                getBingoCartela(
                    selectedCartela
                );

            if (
                !playerCartela ||
                !Array.isArray(
                    playerCartela
                ) ||
                playerCartela.length === 0
            ) {
                return res.status(400).json({
                    success: false,
                    error:
                        "Could not generate cartela"
                });
            }

            /*
            |----------------------------------------------------------
            | DEBIT PLAYER
            |----------------------------------------------------------
            */

            await changeBalance({
                playerId:
                    req.player.id,

                amount:
                    -entryFee,

                type:
                    "bingo_entry",

                game:
                    "bingo",

                roundId:
                    room.id,

                description:
                    `Bingo entry - tier ${entryFee}`,

                metadata: {
                    tier:
                        entryFee,

                    cartelaNumber:
                        selectedCartela
                }
            });

            room.players.push({
                playerId:
                    req.player.id,

                telegramName:
                    req.player.username ||
                    "Player",

                cartelaNumber:
                    selectedCartela,

                cartela:
                    playerCartela
            });

            await saveBingoRound(
                entryFee
            );

            const grossPool =
                room.players.length *
                room.entryFee;

            const winnerPrize =
                grossPool * 0.90;

            return res.json({
                success: true,

                tier:
                    entryFee,

                roundId:
                    room.id,

                playersInRoom:
                    room.players.length,

                grossPool,

                winnerPrize,

                serverTime:
                    Date.now(),

                bettingEndsAt:
                    room.bettingEndsAt,

                bettingRemainingMilliseconds:
                    Math.max(
                        0,
                        room.bettingEndsAt -
                            Date.now()
                    ),

                cartela:
                    playerCartela
            });
        } catch (error) {
            console.error(
                "Bingo join error:",
                error
            );

            return res.status(400).json({
                success: false,
                error:
                    error.message ||
                    "Could not join bingo"
            });
        }
    }
);

/*
|--------------------------------------------------------------------------
| BINGO CARTELA
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
                return res.status(400).json({
                    success: false,
                    error:
                        "Cartela number must be between 1 and 120"
                });
            }

            const cartela =
                getBingoCartela(
                    number
                );

            return res.json({
                success: true,
                cartela
            });
        } catch (error) {
            return res.status(400).json({
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
| PUBLIC BINGO ROUND
|--------------------------------------------------------------------------
*/

function getPublicBingoRound(
    tier
) {
    const room =
        bingoRooms[tier];

    if (!room) {
        return null;
    }

    const now =
        Date.now();

    const remaining =
        Math.max(
            0,
            room.bettingEndsAt -
                now
        );

    return {
        id:
            room.id,

        game:
            "bingo",

        tier:
            room.entryFee,

        status:
            room.status,

        serverTime:
            now,

        bettingStartedAt:
            room.bettingStartedAt,

        bettingEndsAt:
            room.bettingEndsAt,

        remainingMilliseconds:
            remaining,

        remainingSeconds:
            Math.ceil(
                remaining / 1000
            ),

        drawnNumbers:
            [...room.drawnNumbers],

        drawIndex:
            room.drawIndex,

        currentNumber:
            room.currentNumber,

        playersInRoom:
            room.players.length,

        grossPool:
            room.totalPool ||
            room.players.length *
                room.entryFee,

        winnerPrize:
            room.winnerPrize ||
            (
                room.players.length *
                room.entryFee *
                0.90
            ),

        winner:
            room.winner
                ? {
                    playerId:
                        room.winner.playerId,
                    telegramName:
                        room.winner.telegramName
                }
                : null
    };
}

/*
|--------------------------------------------------------------------------
| BINGO ROUND ROUTES
|--------------------------------------------------------------------------
*/

app.get(
    "/api/bingo/round",
    (req, res) => {
        const tier =
            Number(
                req.query.tier
            );

        if (
            Number.isInteger(tier) &&
            bingoRooms[tier]
        ) {
            return res.json({
                success: true,
                serverTime:
                    Date.now(),
                round:
                    getPublicBingoRound(
                        tier
                    )
            });
        }

        const rooms = {};

        for (
            const [roomTier, room]
            of Object.entries(
                bingoRooms
            )
        ) {
            rooms[roomTier] =
                getPublicBingoRound(
                    Number(roomTier)
                );
        }

        return res.json({
            success: true,
            serverTime:
                Date.now(),
            rooms
        });
    }
);

/*
|--------------------------------------------------------------------------
| GENERIC HOUSE GAME HELPERS
|--------------------------------------------------------------------------
*/

function generateKenoDraw() {
    const engineGenerator =
        keno.createDraw ||
        keno.generateDraw ||
        keno.default?.createDraw ||
        keno.default?.generateDraw;

    if (
        typeof engineGenerator ===
        "function"
    ) {
        const generated =
            engineGenerator();

        if (
            Array.isArray(generated) &&
            generated.length > 0
        ) {
            return generated;
        }
    }

    /*
    |--------------------------------------------------------------
    | Secure fallback.
    |--------------------------------------------------------------
    */

    const numbers =
        Array.from(
            { length: 80 },
            (_, index) => index + 1
        );

    const result = [];

    while (
        result.length < 20
    ) {
        const index =
            crypto.randomInt(
                0,
                numbers.length
            );

        result.push(
            numbers.splice(
                index,
                1
            )[0]
        );
    }

    return result;
}

/*
|--------------------------------------------------------------------------
| AVIATOR CRASH POINT
|--------------------------------------------------------------------------
*/

function generateCrashPoint(round = null) {
    const generator =
        aviator.generateSecureBalancedCrashPoint ||
        aviator.default
            ?.generateSecureBalancedCrashPoint;

    if (
        typeof generator ===
        "function"
    ) {
        const safeRound =
            round || {
                bets: []
            };

        if (
            !Array.isArray(
                safeRound.bets
            )
        ) {
            safeRound.bets = [];
        }

        const value =
            Number(
                generator(
                    safeRound,
                    10000
                )
            );

        if (
            Number.isFinite(value) &&
            value >= 1
        ) {
            return Number(
                value.toFixed(2)
            );
        }
    }

    /*
    |--------------------------------------------------------------
    | Compatibility fallback.
    | Prefer the secure engine function above whenever available.
    |--------------------------------------------------------------
    */

    const legacyGenerator =
        aviator.generateCrashPoint ||
        aviator.default?.generateCrashPoint;

    if (
        typeof legacyGenerator ===
        "function"
    ) {
        const value =
            Number(
                legacyGenerator()
            );

        if (
            Number.isFinite(value) &&
            value >= 1
        ) {
            return Number(
                value.toFixed(2)
            );
        }
    }

    /*
    |--------------------------------------------------------------
    | Cryptographically random fallback.
    |--------------------------------------------------------------
    */

    const cents =
        crypto.randomInt(
            100,
            10001
        );

    return Number(
        (cents / 100).toFixed(2)
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
        id:
            round.id,

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

        engine_state: {
            secretDraw:
                round.secretDraw ||
                null,

            drawIndex:
                round.drawIndex ||
                0,

            secretCrashPoint:
                round.secretCrashPoint ||
                null,

            flyingStartedAt:
                round.flyingStartedAt ||
                null,

            multiplier:
                round.multiplier,

            currentNumber:
                round.currentNumber
        },

        updated_at:
            nowIso()
    };

    const { error } =
        await supabase
            .from("game_rounds")
            .upsert(
                payload,
                {
                    onConflict: "id"
                }
            );

    if (error) {
        await dbError(
            "saveRound",
            error
        );

        throw new Error(
            "Could not save game round"
        );
    }
}

/*
|--------------------------------------------------------------------------
| PUBLIC HOUSE ROUND
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

    const remaining =
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

        serverTime:
            now,

        serverTimeIso:
            new Date(
                now
            ).toISOString(),

        bettingSeconds:
            round.bettingSeconds,

        bettingStartedAt:
            round.bettingStartedAt,

        bettingEndsAt:
            round.bettingEndsAt,

        bettingEndsAtIso:
            new Date(
                round.bettingEndsAt
            ).toISOString(),

        remainingMilliseconds:
            remaining,

        remainingSeconds:
            Math.ceil(
                remaining / 1000
            ),

        drawnNumbers:
            [
                ...(round.drawnNumbers ||
                    [])
            ],

        drawIndex:
            round.drawIndex || 0,

        currentNumber:
            round.currentNumber,

        result:
            round.result,

        multiplier:
            round.multiplier,

        crashPoint:
            (
                round.status ===
                    "CRASHED" ||
                round.status ===
                    "FINISHED"
            )
                ? round.crashPoint
                : null
    };
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
        Number(
            BETTING_TIMERS[
                gameName
            ] || 40
        );

    const now =
        Date.now();

    const round = {
        id:
            `${gameName}-${now}-` +
            crypto
                .randomBytes(4)
                .toString("hex"),

        game:
            gameName,

        status:
            "BETTING",

        createdAt:
            now,

        startedAt:
            now,

        bettingSeconds,

        bettingStartedAt:
            now,

        bettingEndsAt:
            now +
            bettingSeconds *
                1000,

        drawnNumbers: [],

        drawIndex: 0,

        currentNumber: null,

        result: null,

        crashPoint: null,

        multiplier: 1.00
    };

    /*
    |--------------------------------------------------------------
    | KENO
    |--------------------------------------------------------------
    */

    if (
        gameName === "keno"
    ) {
        round.secretDraw =
            generateKenoDraw();
    }

    /*
    |--------------------------------------------------------------
    | AVIATOR
    |--------------------------------------------------------------
    |
    | ONLY FIX:
    | The Aviator engine expects round.bets to exist.
    |--------------------------------------------------------------
    */

    if (
        gameName === "aviator"
    ) {
        round.bets = [];

        round.secretCrashPoint =
            generateCrashPoint(
                round
            );
    }

    rounds[gameName] =
        round;

    console.log(
        `[${gameName.toUpperCase()}] NEW ROUND ${round.id} | BETTING ${bettingSeconds}s`
    );

    saveRound(
        round
    ).catch(console.error);

    setTimeout(
        () => {
            const current =
                rounds[gameName];

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
                gameName ===
                "keno"
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
        bettingSeconds *
            1000
    );
}

/*
|--------------------------------------------------------------------------
| KENO DRAW
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

    console.log(
        `[KENO] DRAWING STARTED ${round.id}`
    );

    revealNextKenoNumber(
        gameName,
        round.id
    );
}

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
            round.id
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

    console.log(
        `[KENO] DRAW ${round.drawIndex}/20 -> ${number}`
    );

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
| ROULETTE
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

    console.log(
        `[ROULETTE] SPINNING ${round.id}`
    );

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
                const spinFn =
                    roulette.spin ||
                    roulette.default
                        ?.spin;

                if (
                    typeof spinFn !==
                    "function"
                ) {
                    throw new Error(
                        "Roulette engine spin function unavailable"
                    );
                }

                current.result =
                    spinFn();

                current.status =
                    "FINISHED";

                console.log(
                    `[ROULETTE] RESULT ${current.result}`
                );

                await saveRound(
                    current
                );

                finishHouseRound(
                    "roulette",
                    roundId
                );
            } catch (error) {
                console.error(
                    "[ROULETTE] Spin error:",
                    error
                );

                current.status =
                    "FINISHED";

                await saveRound(
                    current
                ).catch(
                    console.error
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
| AVIATOR
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

    round.multiplier =
        1.00;

    saveRound(
        round
    ).catch(console.error);

    console.log(
        `[AVIATOR] FLIGHT ${round.id} | CRASH ${round.secretCrashPoint}x`
    );

    updateAviator(
        round.id
    );
}

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
        Date.now() -
        round.flyingStartedAt;

    const seconds =
        elapsed / 1000;

    /*
    |--------------------------------------------------------------
    | Existing multiplier curve preserved.
    |--------------------------------------------------------------
    */

    round.multiplier =
        Number(
            Math.max(
                1,
                Math.pow(
                    1.18,
                    seconds
                )
            ).toFixed(2)
        );

    if (
        round.multiplier >=
        round.secretCrashPoint
    ) {
        round.multiplier =
            round.secretCrashPoint;

        round.crashPoint =
            round.secretCrashPoint;

        round.status =
            "CRASHED";

        console.log(
            `[AVIATOR] CRASH ${round.crashPoint}x`
        );

        saveRound(
            round
        ).catch(console.error);

        setTimeout(
            () => {
                finishHouseRound(
                    "aviator",
                    round.id
                );
            },
            DRAW_INTERVALS.aviator
        );

        return;
    }

    /*
    |--------------------------------------------------------------
    | Persist current server state.
    |--------------------------------------------------------------
    */

    saveRound(
        round
    ).catch(console.error);

    setTimeout(
        () => {
            updateAviator(
                roundId
            );
        },
        DRAW_INTERVALS.aviator
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
        (
            roundId &&
            round.id !==
                roundId
        )
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

    console.log(
        `[${gameName.toUpperCase()}] FINISHED -> NEW ROUND IN 5 SECONDS`
    );

    const finishedRoundId =
        round.id;

    setTimeout(
        () => {
            const current =
                rounds[gameName];

            if (
                !current ||
                current.id !==
                    finishedRoundId
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
| RESTORE HOUSE ROUND
|--------------------------------------------------------------------------
*/

async function restoreHouseRound(
    gameName
) {
    try {
        const {
            data,
            error
        } = await supabase
            .from("game_rounds")
            .select("*")
            .eq(
                "game",
                gameName
            )
            .order(
                "updated_at",
                {
                    ascending:
                        false
                }
            )
            .limit(1)
            .maybeSingle();

        if (
            error ||
            !data
        ) {
            console.log(
                `[${gameName}] No saved round. Starting new round.`
            );

            startHouseRound(
                gameName
            );

            return;
        }

        if (
            data.status ===
                "FINISHED" ||
            data.status ===
                "CRASHED"
        ) {
            startHouseRound(
                gameName
            );

            return;
        }

        const state =
            data.engine_state ||
            {};

        const bettingStartedAt =
            new Date(
                data.betting_started_at
            ).getTime();

        const bettingEndsAt =
            new Date(
                data.betting_ends_at
            ).getTime();

        if (
            !Number.isFinite(
                bettingStartedAt
            ) ||
            !Number.isFinite(
                bettingEndsAt
            )
        ) {
            startHouseRound(
                gameName
            );

            return;
        }

        const round = {
            id:
                data.round_id ||
                data.id,

            game:
                data.game,

            status:
                data.status,

            createdAt:
                bettingStartedAt,

            startedAt:
                bettingStartedAt,

            bettingSeconds:
                Number(
                    data.betting_seconds ||
                    BETTING_TIMERS[
                        gameName
                    ]
                ),

            bettingStartedAt,

            bettingEndsAt,

            drawnNumbers:
                Array.isArray(
                    data.drawn_numbers
                )
                    ? data.drawn_numbers
                    : [],

            drawIndex:
                Number(
                    state.drawIndex ??
                    data.drawn_numbers
                        ?.length ??
                    0
                ),

            currentNumber:
                state.currentNumber ??
                data.current_number ??
                null,

            result:
                data.result,

            crashPoint:
                data.crash_point,

            multiplier:
                Number(
                    state.multiplier ??
                    data.multiplier ??
                    1
                )
        };

        if (
            gameName ===
            "keno"
        ) {
            round.secretDraw =
                Array.isArray(
                    state.secretDraw
                )
                    ? state.secretDraw
                    : generateKenoDraw();
        }

        if (
            gameName ===
            "aviator"
        ) {
            round.bets = [];

            round.secretCrashPoint =
                Number(
                    state.secretCrashPoint
                );

            round.flyingStartedAt =
                state.flyingStartedAt;

            if (
                !Number.isFinite(
                    round.secretCrashPoint
                )
            ) {
                round.secretCrashPoint =
                    generateCrashPoint(
                        round
                    );
            }
        }

        rounds[gameName] =
            round;

        console.log(
            `[${gameName.toUpperCase()}] RESTORED ${round.id} | ${round.status}`
        );

        /*
        |--------------------------------------------------------------
        | BETTING
        |--------------------------------------------------------------
        */

        if (
            round.status ===
            "BETTING"
        ) {
            const remaining =
                Math.max(
                    0,
                    round.bettingEndsAt -
                        Date.now()
                );

            setTimeout(
                () => {
                    const current =
                        rounds[
                            gameName
                        ];

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
                        gameName ===
                        "keno"
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
                remaining
            );

            return;
        }

        /*
        |--------------------------------------------------------------
        | KENO DRAWING
        |--------------------------------------------------------------
        */

        if (
            gameName ===
                "keno" &&
            round.status ===
                "DRAWING"
        ) {
            revealNextKenoNumber(
                gameName,
                round.id
            );

            return;
        }

        /*
        |--------------------------------------------------------------
        | ROULETTE SPINNING
        |--------------------------------------------------------------
        */

        if (
            gameName ===
                "roulette" &&
            round.status ===
                "SPINNING"
        ) {
            startRouletteSpin(
                round.id
            );

            return;
        }

        /*
        |--------------------------------------------------------------
        | AVIATOR FLYING
        |--------------------------------------------------------------
        */

        if (
            gameName ===
                "aviator" &&
            round.status ===
                "FLYING"
        ) {
            /*
            |----------------------------------------------------------
            | Recalculate the multiplier from the original start time.
            | This prevents a Render restart from resetting the flight
            | timer.
            |----------------------------------------------------------
            */

            if (
                !round.flyingStartedAt
            ) {
                round.flyingStartedAt =
                    Date.now();
            }

            updateAviator(
                round.id
            );

            return;
        }

        startHouseRound(
            gameName
        );
    } catch (error) {
        console.error(
            `[${gameName.toUpperCase()}] RESTORE ERROR:`,
            error
        );

        startHouseRound(
            gameName
        );
    }
}

/*
|--------------------------------------------------------------------------
| GAME HISTORY
|--------------------------------------------------------------------------
*/

app.get(
    "/api/game/:game/history",
    async (req, res) => {
        try {
            const gameName =
                String(
                    req.params.game ||
                    ""
                ).toLowerCase();

            if (
                !games[gameName]
            ) {
                return res.status(404).json({
                    success: false,
                    error:
                        "Game not found"
                });
            }

            const limit =
                Math.min(
                    Math.max(
                        Number(
                            req.query.limit ||
                            20
                        ),
                        1
                    ),
                    100
                );

            const {
                data,
                error
            } = await supabase
                .from("game_rounds")
                .select(
                    "id,round_id,game,status,result,drawn_numbers,current_number,multiplier,crash_point,created_at,updated_at"
                )
                .eq(
                    "game",
                    gameName
                )
                .order(
                    "created_at",
                    {
                        ascending:
                            false
                    }
                )
                .limit(limit);

            if (error) {
                await dbError(
                    "Game history",
                    error
                );

                return res.status(500).json({
                    success: false,
                    error:
                        "Could not load game history"
                });
            }

            return res.json({
                success: true,
                game:
                    gameName,
                history:
                    data || []
            });
        } catch (error) {
            console.error(
                "History error:",
                error
            );

            return res.status(500).json({
                success: false,
                error:
                    "Could not load history"
            });
        }
    }
);

/*
|--------------------------------------------------------------------------
| STATUS
|--------------------------------------------------------------------------
*/

app.get(
    "/api/status",
    (req, res) => {
        const houseState = {};

        for (
            const gameName
            of Object.keys(
                games
            )
        ) {
            houseState[
                gameName
            ] =
                getPublicRound(
                    gameName
                );
        }

        const bingoState = {};

        for (
            const tier
            of Object.keys(
                bingoRooms
            )
        ) {
            bingoState[tier] =
                getPublicBingoRound(
                    Number(tier)
                );
        }

        return res.json({
            success: true,

            status:
                "online",

            serverTime:
                Date.now(),

            serverTimeIso:
                nowIso(),

            games:
                houseState,

            bingo:
                bingoState
        });
    }
);

/*
|--------------------------------------------------------------------------
| GENERIC ROUND API
|--------------------------------------------------------------------------
*/

app.get(
    "/api/game/:game/round",
    (req, res) => {
        const gameName =
            String(
                req.params.game ||
                ""
            ).toLowerCase();

        /*
        |--------------------------------------------------------------
        | Bingo uses tier rooms rather than one global room.
        |--------------------------------------------------------------
        */

        if (
            gameName ===
            "bingo"
        ) {
            const tier =
                Number(
                    req.query.tier
                );

            if (
                Number.isInteger(
                    tier
                ) &&
                bingoRooms[tier]
            ) {
                return res.json({
                    success: true,
                    serverTime:
                        Date.now(),
                    serverTimeIso:
                        nowIso(),
                    round:
                        getPublicBingoRound(
                            tier
                        )
                });
            }

            const rooms = {};

            for (
                const roomTier
                of Object.keys(
                    bingoRooms
                )
            ) {
                rooms[
                    roomTier
                ] =
                    getPublicBingoRound(
                        Number(
                            roomTier
                        )
                    );
            }

            return res.json({
                success: true,
                serverTime:
                    Date.now(),
                serverTimeIso:
                    nowIso(),
                rooms
            });
        }

        if (
            !games[gameName]
        ) {
            return res.status(404).json({
                success: false,
                error:
                    "Game not found"
            });
        }

        return res.json({
            success: true,

            serverTime:
                Date.now(),

            serverTimeIso:
                nowIso(),

            round:
                getPublicRound(
                    gameName
                )
        });
    }
);

/*
|--------------------------------------------------------------------------
| SERVER TIME
|--------------------------------------------------------------------------
*/

app.get(
    "/api/server-time",
    (req, res) => {
        const now =
            Date.now();

        res.json({
            success: true,
            serverTime:
                now,
            serverTimeIso:
                new Date(
                    now
                ).toISOString()
        });
    }
);

/*
|--------------------------------------------------------------------------
| HEALTH
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
                Date.now()
        });
    }
);

/*
|--------------------------------------------------------------------------
| DATABASE TEST
|--------------------------------------------------------------------------
*/

async function testDatabaseConnection() {
    try {
        const {
            data,
            error
        } = await supabase
            .from("players")
            .select("id")
            .limit(1);

        if (error) {
            await dbError(
                "Supabase connection test",
                error
            );

            return false;
        }

        console.log(
            "[SUPABASE] DATABASE CONNECTION OK"
        );

        return true;
    } catch (error) {
        console.error(
            "[SUPABASE] CONNECTION TEST FAILED:",
            error
        );

        return false;
    }
}

/*
|--------------------------------------------------------------------------
| BOOT
|--------------------------------------------------------------------------
*/

app.listen(
    PORT,
    "0.0.0.0",
    async () => {
        console.log(
            "========================================"
        );

        console.log(
            "       DESTA PLAY BACKEND SERVER"
        );

        console.log(
            "========================================"
        );

        console.log(
            `Port: ${PORT}`
        );

        console.log(
            "Keno / Bingo / Roulette / Aviator"
        );

        console.log(
            "Permanent Supabase Storage"
        );

        console.log(
            "Argon2 Authentication"
        );

        console.log(
            "Server-Authoritative Round Engine"
        );

        console.log(
            "========================================"
        );

        const databaseOK =
            await testDatabaseConnection();

        if (!databaseOK) {
            console.error(
                "[BOOT] Database connection failed."
            );

            /*
            |----------------------------------------------------------
            | Do not pretend the database is working.
            | The server remains alive for Render health checks,
            | but game/account operations requiring Supabase will fail.
            |----------------------------------------------------------
            */
        }

        /*
        |--------------------------------------------------------------
        | START BINGO ROOMS
        |--------------------------------------------------------------
        |
        | IMPORTANT:
        | We ask the Bingo engine for its fixed bet amounts.
        | No old hard-coded [10,20,30...] list is used here.
        |
        |--------------------------------------------------------------
        */

        const engineBingoAmounts =
            bingo.FIXED_BET_AMOUNTS ||
            bingo.default
                ?.FIXED_BET_AMOUNTS;

        if (
            Array.isArray(
                engineBingoAmounts
            ) &&
            engineBingoAmounts.length
        ) {
            console.log(
                "[BINGO] Engine bet amounts:",
                engineBingoAmounts
            );

            for (
                const tier
                of engineBingoAmounts
            ) {
                try {
                    bingoBetIsValid(
                        tier
                    );

                    startNewBingoRound(
                        tier
                    );
                } catch (error) {
                    console.error(
                        `[BINGO] Skipping invalid engine tier ${tier}:`,
                        error.message
                    );
                }
            }
        } else {
            /*
            |----------------------------------------------------------
            | Compatibility fallback.
            |----------------------------------------------------------
            | The currently audited Bingo engine is expected to expose
            | FIXED_BET_AMOUNTS. If it does not, no invented tiers are
            | created.
            |----------------------------------------------------------
            */

            console.error(
                "[BINGO] FIXED_BET_AMOUNTS not exported by bingo engine. No Bingo rooms started."
            );
        }

        /*
        |--------------------------------------------------------------
        | RESTORE HOUSE GAMES
        |--------------------------------------------------------------
        */

        for (
            const gameName
            of Object.keys(
                games
            )
        ) {
            await restoreHouseRound(
                gameName
            );
        }

        console.log(
            "========================================"
        );

        console.log(
            "       DESTA PLAY ENGINE ONLINE"
        );

        console.log(
            "========================================"
        );
    }
);
