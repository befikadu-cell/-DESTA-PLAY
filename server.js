/*
|--------------------------------------------------------------------------
| DESTA PLAY — 24/7 CONTINUOUS BACKEND ENGINE
|--------------------------------------------------------------------------
|
| Features:
|   - Multi-Tier PVP Bingo Loops (10 ETB to 500 ETB)
|   - Real-Time Pool Allocation: 90% Winner Payout / 10% Platform Rake
|   - 70% RTP (30% House Edge) Math Models for House Games
|   - Continuous 24/7 Auto-Reset Engine (BETTING -> DRAWING -> FINISHED -> BETTING)
|   - Supabase Wallet Ledger & Argon2id Authentication
|
|--------------------------------------------------------------------------
*/

"use strict";

const express = require("express");
const cors = require("cors");
const path = require("path");
const crypto = require("crypto");
const argon2 = require("argon2");
const { createClient } = require("@supabase/supabase-js");

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

if (!SUPABASE_URL) throw new Error("Missing SUPABASE_URL");
if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
if (!SESSION_SECRET) throw new Error("Missing SESSION_SECRET");

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
        autoRefreshToken: false,
        persistSession: false
    }
});

const app = express();

app.use(cors());
app.use(express.json({ limit: "100kb" }));
app.use(express.static(path.join(__dirname, "public")));

const games = {
    keno,
    roulette,
    aviator
};

const rounds = {};

/*
|--------------------------------------------------------------------------
| ENGINE TIMING CONFIGURATIONS
|--------------------------------------------------------------------------
|
| Keno:
|   40 seconds betting
|   3 seconds between drawn numbers
|
| Bingo:
|   40 seconds betting
|   3 seconds between drawn numbers
|
| Roulette:
|   40 seconds betting
|   3 seconds spinning
|
| Aviator:
|   10 seconds betting
|   continuous flight
|
|--------------------------------------------------------------------------
*/

const DRAW_INTERVALS = {
    keno: 3000,
    roulette: 3000,
    bingo: 3000
};

const BETTING_TIMERS = {
    bingo: 40,
    keno: 40,
    roulette: 40,
    aviator: 10
};

const NEXT_ROUND_DELAY = 5000; // 5 seconds wait before resetting loop

// Mathematical House Edge Definition
const TARGET_RTP = 0.70; // 70% Return-To-Player (30% House Edge)
const HOUSE_RAKE_PERCENT = 0.10; // 10% Platform Rake for PVP Bingo

/*
|--------------------------------------------------------------------------
| 24/7 PVP BINGO TIERS & POOL ENGINE
|--------------------------------------------------------------------------
*/

const BINGO_TIERS = [10, 20, 30, 50, 80, 100, 150, 200, 300, 500];
const bingoRooms = {};

function generateBingoDraw() {
    const numbers = Array.from({ length: 75 }, (_, i) => i + 1);
    const result = [];

    while (result.length < 75) {
        const randomIndex = crypto.randomInt(0, numbers.length);
        result.push(numbers.splice(randomIndex, 1)[0]);
    }

    return result;
}

function initBingoRooms() {
    BINGO_TIERS.forEach(tier => {
        startNewBingoRound(tier);
    });
}

function startNewBingoRound(tier) {
    const bettingEndsAt = Date.now() + BETTING_TIMERS.bingo * 1000;

    bingoRooms[tier] = {
        id: `bingo-${tier}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`,
        tierId: tier,
        entryFee: tier,
        status: "BETTING",
        createdAt: Date.now(),
        bettingStartedAt: Date.now(),
        bettingEndsAt,
        players: [],
        secretDraw: generateBingoDraw(),
        drawnNumbers: [],
        drawIndex: 0,
        currentNumber: null,
        winner: null,
        totalPool: 0,
        houseRake: 0,
        winnerPrize: 0
    };

    console.log(
        `[BINGO TIER ${tier}] New round started. Round ID: ${bingoRooms[tier].id}`
    );

    setTimeout(() => {
        const room = bingoRooms[tier];

        if (!room) return;
        if (room.status !== "BETTING") return;

        startBingoDrawPhase(tier);
    }, BETTING_TIMERS.bingo * 1000);
}

function startBingoDrawPhase(tier) {
    const room = bingoRooms[tier];

    if (!room || room.status !== "BETTING") return;

    room.status = "DRAWING";
    room.drawIndex = 0;
    room.drawnNumbers = [];

    saveBingoRound(tier).catch(console.error);

    revealNextBingoNumber(tier);
}

function revealNextBingoNumber(tier) {
    const room = bingoRooms[tier];

    if (!room || room.status !== "DRAWING") return;

    if (room.drawIndex >= room.secretDraw.length) {
        resolveBingoWinner(tier);
        return;
    }

    const number = room.secretDraw[room.drawIndex];

    room.currentNumber = number;
    room.drawnNumbers.push(number);
    room.drawIndex++;

    console.log(
        `[BINGO TIER ${tier}] DRAW ${room.drawIndex}/75 -> ${number}`
    );

    saveBingoRound(tier).catch(console.error);

    let winningPlayer = null;

    for (const player of room.players) {
        if (
            bingo.isWinningCard &&
            bingo.isWinningCard(
                player.cartela,
                room.drawnNumbers
            )
        ) {
            winningPlayer = player;
            break;
        }
    }

    if (winningPlayer) {
        resolveBingoWinner(tier, winningPlayer);
    } else {
        setTimeout(() => {
            const currentRoom = bingoRooms[tier];

            if (!currentRoom) return;
            if (currentRoom.status !== "DRAWING") return;

            revealNextBingoNumber(tier);
        }, DRAW_INTERVALS.bingo);
    }
}

async function resolveBingoWinner(tier, winnerObj = null) {
    const room = bingoRooms[tier];

    if (!room || room.status === "FINISHED") return;

    room.status = "FINISHED";

    const grossPool = room.players.length * room.entryFee;
    const houseRake = grossPool * HOUSE_RAKE_PERCENT;
    const winnerPrize = grossPool - houseRake;

    room.totalPool = grossPool;
    room.houseRake = houseRake;
    room.winnerPrize = winnerPrize;

    const winningPlayer =
        winnerObj ||
        (room.players.length > 0 ? room.players[0] : null);

    if (winningPlayer) {
        room.winner = winningPlayer;

        try {
            await changeBalance({
                playerId: winningPlayer.playerId,
                amount: winnerPrize,
                type: "bingo_win",
                game: "bingo",
                roundId: room.id,
                metadata: {
                    tier,
                    grossPool,
                    houseRake,
                    winnerPrize
                }
            });

            console.log(
                `[BINGO TIER ${tier}] Winner: ${winningPlayer.telegramName} | Gross: ${grossPool} ETB | Winner (90%): ${winnerPrize} ETB | Rake (10%): ${houseRake} ETB`
            );
        } catch (error) {
            console.error(
                `[BINGO TIER ${tier}] Payout error:`,
                error
            );
        }
    }

    await saveBingoRound(tier).catch(console.error);

    setTimeout(() => {
        startNewBingoRound(tier);
    }, NEXT_ROUND_DELAY);
}

/*
|--------------------------------------------------------------------------
| AUTHENTICATION & WALLET LEDGER ROUTINES
|--------------------------------------------------------------------------
*/

function nowIso() {
    return new Date().toISOString();
}

function makeId(prefix = "") {
    return prefix + crypto.randomBytes(16).toString("hex");
}

function makePlayerId() {
    return "DP-" + crypto.randomBytes(4).toString("hex").toUpperCase();
}

function normalizeTelegramName(name) {
    if (typeof name !== "string") return "Player";

    const clean = name.trim().replace(/\s+/g, " ");

    return clean.slice(0, 80) || "Player";
}

function validPassword(password) {
    return (
        typeof password === "string" &&
        password.length >= 8 &&
        password.length <= 128
    );
}

async function dbError(context, error) {
    console.error(`[DATABASE ERROR] ${context}:`, {
        message: error?.message,
        code: error?.code,
        details: error?.details,
        hint: error?.hint
    });
}

async function findPlayerByTelegramId(telegramId) {
    const {
        data,
        error
    } = await supabase
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
    const {
        data,
        error
    } = await supabase
        .from("players")
        .select("*")
        .eq("player_id", playerId)
        .maybeSingle();

    if (error) {
        await dbError("findPlayerById", error);
        throw new Error("Database error");
    }

    return data;
}

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
        throw new Error("Telegram ID is required");
    }

    if (!validPassword(password)) {
        throw new Error("Password must be 8–128 characters");
    }

    const normalizedTelegramId =
        String(telegramId).trim();

    const existing =
        await findPlayerByTelegramId(
            normalizedTelegramId
        );

    if (existing) {
        throw new Error("Player already exists");
    }

    const passwordHash = await argon2.hash(
        password,
        {
            type: argon2.argon2id,
            memoryCost: 19456,
            timeCost: 2,
            parallelism: 1
        }
    );

    const playerId = makePlayerId();
    const name = normalizeTelegramName(telegramName);

    const {
        data,
        error
    } = await supabase
        .from("players")
        .insert({
            player_id: playerId,
            telegram_id: normalizedTelegramId,
            telegram_name: name,
            password_hash: passwordHash,
            balance: 0,
            created_at: nowIso(),
            updated_at: nowIso()
        })
        .select("*")
        .single();

    if (error) {
        await dbError("createPlayer", error);

        if (error.code === "23505") {
            throw new Error("Player already exists");
        }

        throw new Error("Could not create account");
    }

    return data;
}

async function authenticatePlayer(telegramId, password) {
    const player =
        await findPlayerByTelegramId(
            telegramId
        );

    if (!player) {
        throw new Error("Invalid Telegram ID or password");
    }

    const valid =
        await argon2.verify(
            player.password_hash,
            password
        );

    if (!valid) {
        throw new Error("Invalid Telegram ID or password");
    }

    return {
        id: player.id,
        playerId: player.player_id,
        telegramId: player.telegram_id,
        telegramName: player.telegram_name,
        balance: Number(player.balance || 0)
    };
}

const sessions = new Map();

function createSession(player) {
    const token =
        crypto.randomBytes(32).toString("hex");

    sessions.set(token, {
        playerId: player.playerId,
        createdAt: Date.now()
    });

    return token;
}

function getSessionPlayer(req) {
    const header =
        req.headers.authorization || "";

    if (!header.startsWith("Bearer ")) {
        return null;
    }

    return sessions.get(
        header.slice(7).trim()
    ) || null;
}

async function requirePlayer(req, res, next) {
    try {
        const session =
            getSessionPlayer(req);

        if (!session) {
            return res.status(401).json({
                success: false,
                error: "Authentication required"
            });
        }

        const player =
            await findPlayerById(
                session.playerId
            );

        if (!player) {
            return res.status(401).json({
                success: false,
                error: "Player account not found"
            });
        }

        req.player = player;
        next();
    } catch (error) {
        res.status(500).json({
            success: false,
            error: "Authentication error"
        });
    }
}

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
            transaction_id: makeId("TX-"),
            player_id: playerId,
            type,
            amount: Number(amount),
            balance_before: Number(balanceBefore),
            balance_after: Number(balanceAfter),
            game,
            round_id: roundId,
            status,
            reference,
            metadata,
            created_at: nowIso()
        })
        .select()
        .single();

    if (error) {
        await dbError("recordTransaction", error);
        throw new Error("Could not save transaction");
    }

    return data;
}

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
    const numericAmount = Number(amount);

    if (!Number.isFinite(numericAmount)) {
        throw new Error("Invalid amount");
    }

    const player =
        await findPlayerById(playerId);

    if (!player) {
        throw new Error("Player not found");
    }

    const before =
        Number(player.balance || 0);

    const after =
        before + numericAmount;

    if (after < 0) {
        throw new Error("Insufficient balance");
    }

    const {
        data,
        error
    } = await supabase
        .from("players")
        .update({
            balance: after,
            updated_at: nowIso()
        })
        .eq("player_id", playerId)
        .eq("balance", before)
        .select("player_id,balance")
        .maybeSingle();

    if (error) {
        await dbError("changeBalance", error);
        throw new Error("Could not update balance");
    }

    if (!data) {
        throw new Error(
            "Balance changed by another transaction. Please try again."
        );
    }

    await recordTransaction({
        playerId,
        type,
        amount: numericAmount,
        balanceBefore: before,
        balanceAfter: after,
        game,
        roundId,
        status,
        reference,
        metadata
    });

    return data;
}

/*
|--------------------------------------------------------------------------
| REST APIs (ACCOUNT, WALLET, PVP BINGO)
|--------------------------------------------------------------------------
*/

app.post("/api/account/register", async (req, res) => {
    try {
        const {
            telegramId,
            telegramName,
            password
        } = req.body;

        const player =
            await createPlayer({
                telegramId,
                telegramName,
                password
            });

        const token =
            createSession(player);

        res.json({
            success: true,
            token,
            player
        });
    } catch (error) {
        console.error(
            "[REGISTER ERROR]",
            error
        );

        res.status(400).json({
            success: false,
            error: error.message
        });
    }
});

app.post("/api/account/login", async (req, res) => {
    try {
        const {
            telegramId,
            password
        } = req.body;

        const player =
            await authenticatePlayer(
                telegramId,
                password
            );

        const token =
            createSession(player);

        res.json({
            success: true,
            token,
            player
        });
    } catch (error) {
        res.status(401).json({
            success: false,
            error: error.message
        });
    }
});

app.get(
    "/api/account/me",
    requirePlayer,
    async (req, res) => {
        res.json({
            success: true,
            player: {
                playerId:
                    req.player.player_id,

                telegramId:
                    req.player.telegram_id,

                telegramName:
                    req.player.telegram_name,

                balance:
                    Number(
                        req.player.balance || 0
                    )
            }
        });
    }
);

app.get(
    "/api/wallet",
    requirePlayer,
    async (req, res) => {
        try {
            const {
                data,
                error
            } = await supabase
                .from("wallet_transactions")
                .select(
                    "amount,type,status,created_at"
                )
                .eq(
                    "player_id",
                    req.player.player_id
                )
                .order(
                    "created_at",
                    {
                        ascending: false
                    }
                )
                .limit(100);

            if (error) {
                await dbError(
                    "wallet",
                    error
                );

                throw new Error(
                    "Could not load wallet"
                );
            }

            const freshPlayer =
                await findPlayerById(
                    req.player.player_id
                );

            res.json({
                success: true,
                balance:
                    Number(
                        freshPlayer?.balance || 0
                    ),
                transactions:
                    data || []
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                error: "Could not load wallet"
            });
        }
    }
);

/*
|--------------------------------------------------------------------------
| BINGO ROUND DATABASE STATE
|--------------------------------------------------------------------------
*/

async function saveBingoRound(tier) {
    const room = bingoRooms[tier];

    if (!room) return;

    const {
        error
    } = await supabase
        .from("game_rounds")
        .upsert({
            round_id: room.id,
            game: "bingo",
            status: room.status,
            betting_seconds: BETTING_TIMERS.bingo,
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
                    ? room.winner.telegramName
                    : null,
            multiplier: null,
            crash_point: null,
            engine_state: {
                tier: room.tierId,
                entryFee: room.entryFee,
                secretDraw: room.secretDraw,
                drawIndex: room.drawIndex,
                currentNumber: room.currentNumber,
                players: room.players,
                winner: room.winner,
                totalPool: room.totalPool,
                houseRake: room.houseRake,
                winnerPrize: room.winnerPrize
            },
            updated_at: nowIso()
        }, {
            onConflict: "round_id"
        });

    if (error) {
        await dbError(
            `saveBingoRound ${tier}`,
            error
        );
    }
}

/*
|--------------------------------------------------------------------------
| BINGO ROOMS API
|--------------------------------------------------------------------------
*/

app.get("/api/bingo/rooms", (req, res) => {
    const roomState = {};

    BINGO_TIERS.forEach(tier => {
        const room =
            bingoRooms[tier];

        if (room) {
            const now =
                Date.now();

            const remaining =
                Math.max(
                    0,
                    room.bettingEndsAt -
                    now
                );

            const grossPool =
                room.players.length *
                room.entryFee;

            roomState[tier] = {
                tier,
                roomId: room.id,
                entryFee: room.entryFee,
                status: room.status,

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

                totalPlayers:
                    room.players.length,

                grossPool,

                winnerPrize:
                    grossPool *
                    (1 - HOUSE_RAKE_PERCENT),

                currentNumber:
                    room.currentNumber,

                drawnNumbers:
                    room.drawnNumbers,

                drawIndex:
                    room.drawIndex,

                winner:
                    room.winner
                        ? room.winner.telegramName
                        : null
            };
        }
    });

    res.json({
        success: true,
        serverTime: Date.now(),
        rooms: roomState
    });
});

app.post("/api/bingo/join", requirePlayer, async (req, res) => {
    try {
        const {
            tier,
            cartelaNumber
        } = req.body;

        const selectedTier =
            Number(tier);

        const room =
            bingoRooms[selectedTier];

        if (!room) {
            return res.status(404).json({
                success: false,
                error: "Invalid bingo room tier"
            });
        }

        if (room.status !== "BETTING") {
            return res.status(400).json({
                success: false,
                error:
                    "Betting closed for active round"
            });
        }

        const selectedCartela =
            Number(cartelaNumber);

        if (
            !Number.isInteger(selectedCartela) ||
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
                    req.player.player_id
            );

        if (alreadyJoined) {
            return res.status(400).json({
                success: false,
                error: "Player already joined this round"
            });
        }
                const playerCartela =
            bingo.generateCartela
                ? bingo.generateCartela(
                    selectedCartela
                )
                : [];

        if (
            !playerCartela ||
            playerCartela.length === 0
        ) {
            return res.status(400).json({
                success: false,
                error:
                    "Could not generate cartela"
            });
        }

        await changeBalance({
            playerId:
                req.player.player_id,

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

        room.players.push({
            playerId:
                req.player.player_id,

            telegramName:
                req.player.telegram_name,

            cartelaNumber:
                selectedCartela,

            cartela:
                playerCartela
        });

        await saveBingoRound(
            selectedTier
        );

        const grossPool =
            room.players.length *
            room.entryFee;

        res.json({
            success: true,
            tier: selectedTier,
            playersInRoom:
                room.players.length,
            grossPool,
            winnerPrize:
                grossPool *
                (1 - HOUSE_RAKE_PERCENT),

            serverTime:
                Date.now(),

            bettingEndsAt:
                room.bettingEndsAt
        });
    } catch (error) {
        res.status(400).json({
            success: false,
            error: error.message
        });
    }
});

app.get(
    "/api/bingo/cartela/:number",
    (req, res) => {
        try {
            const number =
                Number(
                    req.params.number
                );

            if (
                !Number.isInteger(number) ||
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
                bingo.generateCartela
                    ? bingo.generateCartela(number)
                    : [];

            res.json({
                success: true,
                cartela
            });
        } catch (error) {
            res.status(400).json({
                success: false,
                error: error.message
            });
        }
    }
);

/*
|--------------------------------------------------------------------------
| HOUSE CONTINUOUS LOOPS & 70% RTP MATH ENGINES
|--------------------------------------------------------------------------
*/

function generateKenoDraw() {
    if (
        typeof keno.generateDraw ===
        "function"
    ) {
        const generated =
            keno.generateDraw();

        if (
            Array.isArray(generated) &&
            generated.length > 0
        ) {
            return generated;
        }
    }

    const numbers =
        Array.from(
            { length: 80 },
            (_, i) => i + 1
        );

    const result = [];

    while (result.length < 20) {
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

// Aviator crash calculation mathematically enforcing 70% RTP (30% House Edge)
function generateCrashPoint() {
    if (
        typeof aviator.generateCrashPoint ===
        "function"
    ) {
        const value =
            Number(
                aviator.generateCrashPoint()
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

    const rand = Math.random();

    if (
        rand <
        (1 - TARGET_RTP)
    ) {
        return 1.00;
    }

    return Math.max(
        1.00,
        parseFloat(
            (
                TARGET_RTP /
                (1 - rand)
            ).toFixed(2)
        )
    );
}

/*
|--------------------------------------------------------------------------
| HOUSE ROUND DATABASE SAVE
|--------------------------------------------------------------------------
*/

async function saveRound(round) {
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

        engine_state: {
            secretDraw:
                round.secretDraw || null,

            drawIndex:
                round.drawIndex || 0,

            secretCrashPoint:
                round.secretCrashPoint || null,

            flyingStartedAt:
                round.flyingStartedAt || null,

            multiplier:
                round.multiplier,

            currentNumber:
                round.currentNumber
        },

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
| GET PUBLIC ROUND
|--------------------------------------------------------------------------
*/

function getPublicRound(gameName) {
    const round =
        rounds[gameName];

    if (!round) return null;

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

        remainingMilliseconds,

        remainingSeconds:
            Math.ceil(
                remainingMilliseconds /
                1000
            ),

        drawnNumbers:
            [...round.drawnNumbers],

        drawIndex:
            round.drawIndex,

        currentNumber:
            round.currentNumber,

        result:
            round.result,

        multiplier:
            round.multiplier,

        crashPoint:
            round.status === "CRASHED"
                ? round.crashPoint
                : null
    };
}

/*
|--------------------------------------------------------------------------
| START HOUSE ROUND
|--------------------------------------------------------------------------
*/

function startHouseRound(gameName) {
    const bettingSeconds =
        BETTING_TIMERS[gameName] || 40;

    const now =
        Date.now();

    const round = {
        id:
            `${gameName}-${now}-${crypto.randomBytes(4).toString("hex")}`,

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

        drawnNumbers:
            [],

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

    if (gameName === "keno") {
        round.secretDraw =
            generateKenoDraw();
    }

    if (gameName === "aviator") {
        round.secretCrashPoint =
            generateCrashPoint();
    }

    rounds[gameName] =
        round;

    console.log(
        `[${gameName.toUpperCase()}] NEW ROUND ${round.id} | BETTING ${bettingSeconds}s`
    );

    saveRound(
        round
    ).catch(console.error);

    setTimeout(() => {
        const current =
            rounds[gameName];

        if (!current) return;

        if (
            current.id !==
            round.id
        ) {
            return;
        }

        if (
            current.status !==
            "BETTING"
        ) {
            return;
        }

        if (gameName === "keno") {
            startKenoDraw(
                gameName,
                round.id
            );
        }

        if (gameName === "roulette") {
            startRouletteSpin(
                round.id
            );
        }

        if (gameName === "aviator") {
            startAviatorFlight(
                round.id
            );
        }
    }, bettingSeconds * 1000);
}

/*
|--------------------------------------------------------------------------
| KENO
|--------------------------------------------------------------------------
*/

function startKenoDraw(
    gameName,
    roundId
) {
    const round =
        rounds[gameName];

    if (!round) return;

    if (
        round.id !==
        roundId
    ) {
        return;
    }

    if (
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
        `[KENO] DRAWING STARTED | ${round.id}`
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

    if (!round) return;

    if (
        round.id !==
        roundId
    ) {
        return;
    }

    if (
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

    setTimeout(() => {
        revealNextKenoNumber(
            gameName,
            roundId
        );
    }, DRAW_INTERVALS.keno);
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

    if (!round) return;

    if (
        round.id !==
        roundId
    ) {
        return;
    }

    if (
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
        `[ROULETTE] SPINNING | ${round.id}`
    );

    setTimeout(
        async () => {
            const current =
                rounds.roulette;

            if (!current) return;

            if (
                current.id !==
                roundId
            ) {
                return;
            }

            if (
                current.status !==
                "SPINNING"
            ) {
                return;
            }

            current.result =
                roulette.spin
                    ? roulette.spin()
                    : Math.floor(
                        Math.random() *
                        37
                    );

            current.status =
                "FINISHED";

            console.log(
                `[ROULETTE] RESULT -> ${current.result}`
            );

            await saveRound(
                current
            ).catch(console.error);

            finishHouseRound(
                "roulette",
                roundId
            );
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

    if (!round) return;

    if (
        round.id !==
        roundId
    ) {
        return;
    }

    if (
        round.status !==
        "BETTING"
    ) {
        return;
    }

    round.status =
        "FLYING";

    round.flyingStartedAt =
        Date.now();

    console.log(
        `[AVIATOR] FLIGHT STARTED | ${round.id}`
    );

    saveRound(
        round
    ).catch(console.error);

    updateAviator(
        round.id
    );
}

function updateAviator(
    roundId
) {
    const round =
        rounds.aviator;

    if (!round) return;

    if (
        round.id !==
        roundId
    ) {
        return;
    }

    if (
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

    const calculated =
        Math.pow(
            1.12,
            elapsed
        );

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

        console.log(
            `[AVIATOR] CRASH -> ${round.crashPoint}x`
        );

        saveRound(
            round
        ).catch(console.error);

        finishHouseRound(
            "aviator",
            round.id
        );

        return;
    }

    round.multiplier =
        Number(
            calculated.toFixed(2)
        );

    setTimeout(() => {
        updateAviator(
            roundId
        );
    }, 100);
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

    if (!round) return;

    if (
        roundId &&
        round.id !==
        roundId
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

    setTimeout(() => {
        const current =
            rounds[gameName];

        if (!current) return;

        if (
            current.id !==
            finishedRoundId
        ) {
            return;
        }

        startHouseRound(
            gameName
        );
    }, NEXT_ROUND_DELAY);
}

/*
|--------------------------------------------------------------------------
| RESTORE LAST ACTIVE HOUSE ROUND
|--------------------------------------------------------------------------
*/

async function restoreHouseRound(gameName) {
    try {
        const {
            data,
            error
        } = await supabase
            .from("game_rounds")
            .select("*")
            .eq("game", gameName)
            .order(
                "updated_at",
                {
                    ascending: false
                }
            )
            .limit(1)
            .maybeSingle();

        if (error) {
            await dbError(
                `restoreHouseRound ${gameName}`,
                error
            );

            startHouseRound(
                gameName
            );

            return;
        }

        if (!data) {
            console.log(
                `[${gameName.toUpperCase()}] No previous round found. Starting first round.`
            );

            startHouseRound(
                gameName
            );

            return;
        }

        const state =
            data.engine_state || {};

        const bettingStartedAt =
            new Date(
                data.betting_started_at
            ).getTime();

        const bettingEndsAt =
            new Date(
                data.betting_ends_at
            ).getTime();

        /*
        |--------------------------------------------------------------------------
        | If the old round was already finished, start a new round.
        |--------------------------------------------------------------------------
        */

        if (
            data.status ===
                "FINISHED" ||
            data.status ===
                "CRASHED"
        ) {
            console.log(
                `[${gameName.toUpperCase()}] Previous round finished. Starting next round.`
            );

            startHouseRound(
                gameName
            );

            return;
        }
                    startHouseRound(
                gameName
            );

            return;
        }

        /*
        |--------------------------------------------------------------------------
        | Restore exact saved round.
        |--------------------------------------------------------------------------
        */

        const round = {
            id:
                data.round_id,

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
                    state.drawIndex ||
                    data.drawn_numbers?.length ||
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

        if (gameName === "keno") {
            round.secretDraw =
                Array.isArray(
                    state.secretDraw
                )
                    ? state.secretDraw
                    : generateKenoDraw();
        }

        if (gameName === "aviator") {
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
                    generateCrashPoint();
            }

            /*
            |--------------------------------------------------------------------------
            | Recalculate Aviator multiplier after server restart.
            |--------------------------------------------------------------------------
            */

            if (
                round.status ===
                "FLYING" &&
                round.flyingStartedAt
            ) {
                const elapsed =
                    (
                        Date.now() -
                        round.flyingStartedAt
                    ) / 1000;

                const calculated =
                    Math.pow(
                        1.12,
                        Math.max(
                            0,
                            elapsed
                        )
                    );

                round.multiplier =
                    Number(
                        calculated.toFixed(2)
                    );
            }
        }

        rounds[gameName] =
            round;

        console.log(
            `[${gameName.toUpperCase()}] RESTORED ROUND ${round.id} | STATUS: ${round.status}`
        );

        /*
        |--------------------------------------------------------------------------
        | Continue the exact round.
        |--------------------------------------------------------------------------
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

            setTimeout(() => {
                const current =
                    rounds[gameName];

                if (!current) return;

                if (
                    current.id !==
                    round.id
                ) {
                    return;
                }

                if (
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
            }, remaining);

            return;
        }

        if (
            gameName === "keno" &&
            round.status ===
                "DRAWING"
        ) {
            revealNextKenoNumber(
                gameName,
                round.id
            );

            return;
        }

        if (
            gameName === "roulette" &&
            round.status ===
                "SPINNING"
        ) {
            startRouletteSpin(
                round.id
            );

            return;
        }

        if (
            gameName === "aviator" &&
            round.status ===
                "FLYING"
        ) {
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
            `[${gameName.toUpperCase()}] Restore error:`,
            error
        );

        startHouseRound(
            gameName
        );
    }
}

/*
|--------------------------------------------------------------------------
| STATUS & SYSTEM ROUTES
|--------------------------------------------------------------------------
*/

app.get("/api/status", (req, res) => {
    const houseState = {};

    for (
        const g of Object.keys(games)
    ) {
        houseState[g] =
            getPublicRound(g);
    }

    res.json({
        success: true,
        status: "online",

        serverTime:
            Date.now(),

        serverTimeIso:
            nowIso(),

        games:
            houseState
    });
});

app.get(
    "/api/game/:game/round",
    (req, res) => {
        const gameName =
            req.params.game;

        if (!games[gameName]) {
            return res.status(404).json({
                success: false,
                error: "Game not found"
            });
        }

        res.json({
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

app.get(
    "/health",
    (req, res) =>
        res.json({
            success: true,
            status: "healthy",
            serverTime:
                Date.now()
        })
);

/*
|--------------------------------------------------------------------------
| DATABASE CONNECTION CHECK
|--------------------------------------------------------------------------
*/

async function testDatabaseConnection() {
    try {
        const {
            error
        } = await supabase
            .from("players")
            .select("player_id")
            .limit(1);

        if (error) {
            await dbError(
                "Supabase connection test",
                error
            );

            return false;
        }

        console.log(
            "[SUPABASE] Database connection OK"
        );

        return true;
    } catch (error) {
        console.error(
            "[SUPABASE] Connection test failed:",
            error
        );

        return false;
    }
}

/*
|--------------------------------------------------------------------------
| LAUNCH ENGINES
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
            "       DESTA PLAY BACKEND SERVER        "
        );
                console.log(
            "========================================"
        );

        console.log(
            `Port: ${PORT}`
        );

        console.log(
            "Bingo PVP Rooms: 10 ETB - 500 ETB Active (90% Pool / 10% Rake)"
        );

        console.log(
            "House Game Engines: Keno, Roulette, Aviator Active (70% Target RTP)"
        );

        console.log(
            "Keno: 40s Betting / 3s Draw Interval"
        );

        console.log(
            "Bingo: 40s Betting / 3s Draw Interval"
        );

        console.log(
            "Roulette: 40s Betting / 3s Spin"
        );

        console.log(
            "Aviator: 10s Betting / Continuous Flight"
        );

        console.log(
            "24/7 Continuous Engine: ACTIVE"
        );

        console.log(
            "Supabase Round Persistence: ACTIVE"
        );

        console.log(
            "========================================"
        );

        await testDatabaseConnection();

        /*
        |--------------------------------------------------------------------------
        | Restore Bingo rooms
        |--------------------------------------------------------------------------
        */

        initBingoRooms();

        /*
        |--------------------------------------------------------------------------
        | Restore or start House Game rounds
        |--------------------------------------------------------------------------
        */

        for (
            const gameName of Object.keys(games)
        ) {
            await restoreHouseRound(
                gameName
            );
        }
    }
);
