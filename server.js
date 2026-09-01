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
    auth: { autoRefreshToken: false, persistSession: false }
});

const app = express();
app.use(cors());
app.use(express.json({ limit: "100kb" }));
app.use(express.static(path.join(__dirname, "public")));

const games = { keno, roulette, aviator };
const rounds = {};

// Engine Timing Configurations (in milliseconds & seconds)
const DRAW_INTERVALS = { keno: 1800, roulette: 5000, bingo: 3000 };
const BETTING_TIMERS = { bingo: 30, keno: 30, roulette: 20, aviator: 10 };
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
        id: `bingo-${tier}-${Date.now()}`,
        tierId: tier,
        entryFee: tier,
        status: "BETTING",
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

    console.log(`[BINGO TIER ${tier}] New round started. Round ID: ${bingoRooms[tier].id}`);

    setTimeout(() => {
        startBingoDrawPhase(tier);
    }, BETTING_TIMERS.bingo * 1000);
}

function startBingoDrawPhase(tier) {
    const room = bingoRooms[tier];
    if (!room || room.status !== "BETTING") return;

    room.status = "DRAWING";
    room.drawIndex = 0;
    room.drawnNumbers = [];
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

    // Check if any registered player hit Bingo
    let winningPlayer = null;
    for (const player of room.players) {
        if (bingo.isWinningCard && bingo.isWinningCard(player.cartela, room.drawnNumbers)) {
            winningPlayer = player;
            break;
        }
    }

    if (winningPlayer) {
        resolveBingoWinner(tier, winningPlayer);
    } else {
        setTimeout(() => {
            revealNextBingoNumber(tier);
        }, DRAW_INTERVALS.bingo);
    }
}

async function resolveBingoWinner(tier, winnerObj = null) {
    const room = bingoRooms[tier];
    if (!room || room.status === "FINISHED") return;

    room.status = "FINISHED";
    
    // Pool distribution: 90% Winner / 10% House Rake
    const grossPool = room.players.length * room.entryFee;
    const houseRake = grossPool * HOUSE_RAKE_PERCENT;
    const winnerPrize = grossPool - houseRake;

    room.totalPool = grossPool;
    room.houseRake = houseRake;
    room.winnerPrize = winnerPrize;

    const winningPlayer = winnerObj || (room.players.length > 0 ? room.players[0] : null);

    if (winningPlayer) {
        room.winner = winningPlayer;
        try {
            await changeBalance({
                playerId: winningPlayer.playerId,
                amount: winnerPrize,
                type: "bingo_win",
                game: "bingo",
                roundId: room.id,
                metadata: { tier, grossPool, houseRake, winnerPrize }
            });
            console.log(`[BINGO TIER ${tier}] Winner: ${winningPlayer.telegramName} | Gross: ${grossPool} ETB | Winner (90%): ${winnerPrize} ETB | Rake (10%): ${houseRake} ETB`);
        } catch (error) {
            console.error(`[BINGO TIER ${tier}] Payout error:`, error);
        }
    }

    // Continuous Loop: Reset room after 5-second pause
    setTimeout(() => {
        startNewBingoRound(tier);
    }, NEXT_ROUND_DELAY);
}

/*
|--------------------------------------------------------------------------
| AUTHENTICATION & WALLET LEDGER ROUTINES
|--------------------------------------------------------------------------
*/

function nowIso() { return new Date().toISOString(); }
function makeId(prefix = "") { return prefix + crypto.randomBytes(16).toString("hex"); }
function makePlayerId() { return "DP-" + crypto.randomBytes(4).toString("hex").toUpperCase(); }

function normalizeTelegramName(name) {
    if (typeof name !== "string") return "Player";
    const clean = name.trim().replace(/\s+/g, " ");
    return clean.slice(0, 80) || "Player";
}

function validPassword(password) {
    return typeof password === "string" && password.length >= 8 && password.length <= 128;
}

async function dbError(context, error) { console.error(`[DATABASE ERROR] ${context}:`, error); }

async function findPlayerByTelegramId(telegramId) {
    const { data, error } = await supabase.from("players").select("*").eq("telegram_id", String(telegramId)).maybeSingle();
    if (error) { await dbError("findPlayerByTelegramId", error); throw new Error("Database error"); }
    return data;
}

async function findPlayerById(playerId) {
    const { data, error } = await supabase.from("players").select("*").eq("player_id", playerId).maybeSingle();
    if (error) { await dbError("findPlayerById", error); throw new Error("Database error"); }
    return data;
}

async function createPlayer({ telegramId, telegramName, password }) {
    if (telegramId === undefined || telegramId === null) throw new Error("Telegram ID is required");
    if (!validPassword(password)) throw new Error("Password must be 8–128 characters");

    const existing = await findPlayerByTelegramId(telegramId);
    if (existing) throw new Error("Player already exists");

    const passwordHash = await argon2.hash(password, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
    const playerId = makePlayerId();
    const name = normalizeTelegramName(telegramName);

    const { data, error } = await supabase.from("players").insert({
        player_id: playerId, telegram_id: String(telegramId), telegram_name: name, password_hash: passwordHash, balance: 0, created_at: nowIso(), updated_at: nowIso()
    }).select("id,player_id,telegram_id,telegram_name,balance,created_at").single();

    if (error) { await dbError("createPlayer", error); throw new Error("Could not create account"); }
    return data;
}

async function authenticatePlayer(telegramId, password) {
    const player = await findPlayerByTelegramId(telegramId);
    if (!player) throw new Error("Invalid Telegram ID or password");
    const valid = await argon2.verify(player.password_hash, password);
    if (!valid) throw new Error("Invalid Telegram ID or password");

    return { id: player.id, playerId: player.player_id, telegramId: player.telegram_id, telegramName: player.telegram_name, balance: Number(player.balance || 0) };
}

const sessions = new Map();

function createSession(player) {
    const token = crypto.randomBytes(32).toString("hex");
    sessions.set(token, { playerId: player.playerId, createdAt: Date.now() });
    return token;
}

function getSessionPlayer(req) {
    const header = req.headers.authorization || "";
    if (!header.startsWith("Bearer ")) return null;
    return sessions.get(header.slice(7).trim()) || null;
}

async function requirePlayer(req, res, next) {
    try {
        const session = getSessionPlayer(req);
        if (!session) return res.status(401).json({ success: false, error: "Authentication required" });
        const player = await findPlayerById(session.playerId);
        if (!player) return res.status(401).json({ success: false, error: "Player account not found" });
        req.player = player;
        next();
    } catch (error) {
        res.status(500).json({ success: false, error: "Authentication error" });
    }
}

async function recordTransaction({ playerId, type, amount, balanceBefore, balanceAfter, game = null, roundId = null, status = "completed", reference = null, metadata = {} }) {
    const { data, error } = await supabase.from("wallet_transactions").insert({
        transaction_id: makeId("TX-"), player_id: playerId, type, amount: Number(amount), balance_before: Number(balanceBefore), balance_after: Number(balanceAfter), game, round_id: roundId, status, reference, metadata, created_at: nowIso()
    }).select().single();

    if (error) { await dbError("recordTransaction", error); throw new Error("Could not save transaction"); }
    return data;
}

async function changeBalance({ playerId, amount, type, game = null, roundId = null, status = "completed", reference = null, metadata = {} }) {
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount)) throw new Error("Invalid amount");

    const player = await findPlayerById(playerId);
    if (!player) throw new Error("Player not found");

    const before = Number(player.balance || 0);
    const after = before + numericAmount;
    if (after < 0) throw new Error("Insufficient balance");

    const { data, error } = await supabase.from("players").update({ balance: after, updated_at: nowIso() }).eq("player_id", playerId).select("player_id,balance").single();
    if (error) { await dbError("changeBalance", error); throw new Error("Could not update balance"); }

    await recordTransaction({ playerId, type, amount: numericAmount, balanceBefore: before, balanceAfter: after, game, roundId, status, reference, metadata });
    return data;
}

/*
|--------------------------------------------------------------------------
| REST APIs (ACCOUNT, WALLET, PVP BINGO)
|--------------------------------------------------------------------------
*/

app.post("/api/account/register", async (req, res) => {
    try {
        const { telegramId, telegramName, password } = req.body;
        const player = await createPlayer({ telegramId, telegramName, password });
        const token = createSession(player);
        res.json({ success: true, token, player });
    } catch (error) { res.status(400).json({ success: false, error: error.message }); }
});

app.post("/api/account/login", async (req, res) => {
    try {
        const { telegramId, password } = req.body;
        const player = await authenticatePlayer(telegramId, password);
        const token = createSession(player);
        res.json({ success: true, token, player });
    } catch (error) { res.status(401).json({ success: false, error: error.message }); }
});

app.get("/api/account/me", requirePlayer, async (req, res) => {
    res.json({
        success: true,
        player: { playerId: req.player.player_id, telegramId: req.player.telegram_id, telegramName: req.player.telegram_name, balance: Number(req.player.balance || 0) }
    });
});

app.get("/api/wallet", requirePlayer, async (req, res) => {
    try {
        const { data } = await supabase.from("wallet_transactions").select("amount,type,status,created_at").eq("player_id", req.player.player_id).order("created_at", { ascending: false }).limit(100);
        res.json({ success: true, balance: Number(req.player.balance || 0), transactions: data || [] });
    } catch (error) { res.status(500).json({ success: false, error: "Could not load wallet" }); }
});

app.get("/api/bingo/rooms", (req, res) => {
    const roomState = {};
    BINGO_TIERS.forEach(tier => {
        const room = bingoRooms[tier];
        if (room) {
            const grossPool = room.players.length * room.entryFee;
            roomState[tier] = {
                tier,
                entryFee: room.entryFee,
                status: room.status,
                remainingSeconds: Math.max(0, Math.ceil((room.bettingEndsAt - Date.now()) / 1000)),
                totalPlayers: room.players.length,
                grossPool: grossPool,
                winnerPrize: grossPool * (1 - HOUSE_RAKE_PERCENT), // 90% Pool Share
                currentNumber: room.currentNumber,
                drawnNumbers: room.drawnNumbers,
                winner: room.winner ? room.winner.telegramName : null
            };
        }
    });
    res.json({ success: true, rooms: roomState });
});

app.post("/api/bingo/join", requirePlayer, async (req, res) => {
    try {
        const { tier, cartelaNumber } = req.body;
        const selectedTier = Number(tier);
        const room = bingoRooms[selectedTier];

        if (!room) return res.status(404).json({ success: false, error: "Invalid bingo room tier" });
        if (room.status !== "BETTING") return res.status(400).json({ success: false, error: "Betting closed for active round" });

        await changeBalance({
            playerId: req.player.player_id,
            amount: -selectedTier,
            type: "bingo_entry",
            game: "bingo",
            roundId: room.id,
            metadata: { tier: selectedTier, cartelaNumber }
        });

        const playerCartela = bingo.generateCartela ? bingo.generateCartela(Number(cartelaNumber) || 1) : [];
        room.players.push({
            playerId: req.player.player_id,
            telegramName: req.player.telegram_name,
            cartelaNumber,
            cartela: playerCartela
        });

        const grossPool = room.players.length * room.entryFee;
        res.json({
            success: true,
            tier: selectedTier,
            playersInRoom: room.players.length,
            grossPool: grossPool,
            winnerPrize: grossPool * (1 - HOUSE_RAKE_PERCENT)
        });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

app.get("/api/bingo/cartela/:number", (req, res) => {
    try {
        const number = Number(req.params.number);
        if (!Number.isInteger(number) || number < 1 || number > 120) {
            return res.status(400).json({ success: false, error: "Cartela number must be between 1 and 120" });
        }
        const cartela = bingo.generateCartela ? bingo.generateCartela(number) : [];
        res.json({ success: true, cartela });
    } catch (error) { res.status(400).json({ success: false, error: error.message }); }
});

/*
|--------------------------------------------------------------------------
| HOUSE CONTINUOUS LOOPS & 70% RTP MATH ENGINES (KENO, ROULETTE, AVIATOR)
|--------------------------------------------------------------------------
*/

function generateKenoDraw() {
    const numbers = Array.from({ length: 80 }, (_, i) => i + 1);
    const result = [];
    while (result.length < 20) {
        const randomIndex = crypto.randomInt(0, numbers.length);
        result.push(numbers.splice(randomIndex, 1)[0]);
    }
    return result;
}

// Aviator crash calculation mathematically enforcing 70% RTP (30% House Edge)
function generateCrashPoint() {
    const rand = Math.random();
    if (rand < (1 - TARGET_RTP)) return 1.00; // 30% instant crash probability
    return Math.max(1.00, parseFloat((TARGET_RTP / (1 - rand)).toFixed(2)));
}

function startHouseRound(gameName) {
    const bettingSeconds = BETTING_TIMERS[gameName] || 20;
    const now = Date.now();

    const round = {
        id: `${gameName}-${now}-${crypto.randomBytes(4).toString("hex")}`,
        game: gameName,
        status: "BETTING",
        createdAt: nowIso(),
        startedAt: nowIso(),
        bettingSeconds,
        bettingStartedAt: now,
        bettingEndsAt: now + bettingSeconds * 1000,
        drawnNumbers: [],
        drawIndex: 0,
        currentNumber: null,
        result: null,
        crashPoint: null,
        multiplier: 1.00
    };

    if (gameName === "keno") round.secretDraw = generateKenoDraw();
    if (gameName === "aviator") round.secretCrashPoint = generateCrashPoint();

    rounds[gameName] = round;
    saveRound(round).catch(console.error);

    setTimeout(() => {
        if (gameName === "keno") startKenoDraw(gameName);
        if (gameName === "roulette") startRouletteSpin();
        if (gameName === "aviator") startAviatorFlight();
    }, bettingSeconds * 1000);
}

async function saveRound(round) {
    const payload = {
        round_id: round.id, game: round.game, status: round.status, betting_seconds: round.bettingSeconds,
        betting_started_at: new Date(round.bettingStartedAt).toISOString(), betting_ends_at: new Date(round.bettingEndsAt).toISOString(),
        drawn_numbers: round.drawnNumbers, current_number: round.currentNumber, result: round.result, multiplier: round.multiplier,
        crash_point: round.crashPoint, updated_at: nowIso()
    };
    await supabase.from("game_rounds").upsert(payload, { onConflict: "round_id" });
}

function getPublicRound(gameName) {
    const round = rounds[gameName];
    if (!round) return null;
    return {
        id: round.id, game: round.game, status: round.status, bettingSeconds: round.bettingSeconds,
        remainingSeconds: Math.max(0, Math.ceil((round.bettingEndsAt - Date.now()) / 1000)),
        drawnNumbers: [...round.drawnNumbers], result: round.result, multiplier: round.multiplier, crashPoint: round.status === "CRASHED" ? round.crashPoint : null
    };
}

function startKenoDraw(gameName) {
    const round = rounds[gameName];
    if (!round || round.status !== "BETTING") return;
    round.status = "DRAWING";
    round.drawIndex = 0;
    round.drawnNumbers = [];
    revealNextKenoNumber(gameName);
}

function revealNextKenoNumber(gameName) {
    const round = rounds[gameName];
    if (!round || round.status !== "DRAWING") return;
    if (round.drawIndex >= round.secretDraw.length) { finishHouseRound(gameName); return; }

    const number = round.secretDraw[round.drawIndex];
    round.currentNumber = number;
    round.drawnNumbers.push(number);
    round.drawIndex++;
    saveRound(round).catch(console.error);
    setTimeout(() => revealNextKenoNumber(gameName), DRAW_INTERVALS.keno);
}

function startRouletteSpin() {
    const round = rounds.roulette;
    if (!round || round.status !== "BETTING") return;
    round.status = "SPINNING";
    saveRound(round).catch(console.error);

    setTimeout(async () => {
        round.result = roulette.spin ? roulette.spin() : Math.floor(Math.random() * 37);
        round.status = "FINISHED";
        await saveRound(round);
        finishHouseRound("roulette");
    }, DRAW_INTERVALS.roulette);
}

function startAviatorFlight() {
    const round = rounds.aviator;
    if (!round || round.status !== "BETTING") return;
    round.status = "FLYING";
    round.flyingStartedAt = Date.now();
    updateAviator(round.id);
}

function updateAviator(roundId) {
    const round = rounds.aviator;
    if (!round || round.id !== roundId || round.status !== "FLYING") return;

    const elapsed = (Date.now() - round.flyingStartedAt) / 1000;
    const calculated = Math.pow(1.12, elapsed);

    if (calculated >= round.secretCrashPoint) {
        round.multiplier = round.secretCrashPoint;
        round.crashPoint = round.secretCrashPoint;
        round.status = "CRASHED";
        saveRound(round).catch(console.error);
        finishHouseRound("aviator");
        return;
    }
    round.multiplier = Number(calculated.toFixed(2));
    setTimeout(() => updateAviator(roundId), 100);
}

function finishHouseRound(gameName) {
    const round = rounds[gameName];
    if (!round) return;
    if (round.status !== "CRASHED") round.status = "FINISHED";
    saveRound(round).catch(console.error);

    // Continuous 24/7 Engine Auto-Reset
    setTimeout(() => {
        startHouseRound(gameName);
    }, NEXT_ROUND_DELAY);
}

/*
|--------------------------------------------------------------------------
| STATUS & SYSTEM ROUTES
|--------------------------------------------------------------------------
*/

app.get("/api/status", (req, res) => {
    const houseState = {};
    for (const g of Object.keys(games)) houseState[g] = getPublicRound(g);
    res.json({ success: true, status: "online", serverTime: nowIso(), games: houseState });
});

app.get("/api/game/:game/round", (req, res) => {
    const gameName = req.params.game;
    if (!games[gameName]) return res.status(404).json({ success: false, error: "Game not found" });
    res.json({ success: true, round: getPublicRound(gameName) });
});

app.get("/health", (req, res) => res.json({ success: true, status: "healthy" }));

/*
|--------------------------------------------------------------------------
| LAUNCH ENGINES
|--------------------------------------------------------------------------
*/

app.listen(PORT, "0.0.0.0", async () => {
    console.log("========================================");
    console.log("       DESTA PLAY BACKEND SERVER        ");
    console.log("========================================");
    console.log(`Port: ${PORT}`);
    console.log("Bingo PVP Rooms: 10 ETB - 500 ETB Active (90% Pool / 10% Rake)");
    console.log("House Game Engines: Keno, Roulette, Aviator Active (70% Target RTP)");
    console.log("========================================");

    initBingoRooms();

    for (const gameName of Object.keys(games)) {
        startHouseRound(gameName);
    }
});
