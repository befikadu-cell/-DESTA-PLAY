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
import { createVoiceRouter } from "./voice.js";
import PVP_ENGINES from "./pvp/engines/index.js";
import PVPManager, { PVP_ENTRY_FEES as MANAGER_ENTRY_FEES } from "./pvp/PVPManager.js";
import PoolEngine from "./pvp/PoolEngine.js";
import PVP_AUTHORITY from "./pvp/PVPAuthority.js";

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

/*
|--------------------------------------------------------------------------
| DESTA PLAY — EDITIONS 2–8 SERVER CONFIGURATION
|--------------------------------------------------------------------------
|
| Keep private administrator IDs and bot secrets on Render environment
| variables. Payment display values may be supplied here as placeholders
| until the real values are configured.
|
| IMPORTANT: Minimum deposit is 50 ETB.
|--------------------------------------------------------------------------
*/

const ADMIN_TELEGRAM_ID =
    String(process.env.ADMIN_TELEGRAM_ID || "").trim();

const ADMIN_PRIVATE_GROUP_ID =
    String(process.env.ADMIN_PRIVATE_GROUP_ID || "").trim();

const TELEGRAM_BOT_TOKEN =
    String(process.env.TELEGRAM_BOT_TOKEN || "").trim();

const TELEGRAM_WEBHOOK_SECRET =
    String(process.env.TELEGRAM_WEBHOOK_SECRET || "").trim();

const PUBLIC_APP_URL =
    String(process.env.PUBLIC_APP_URL || "https://desta-play.onrender.com/").trim().replace(/\/$/, "");

const SMS_WEBHOOK_SECRET =
    String(process.env.SMS_WEBHOOK_SECRET || "").trim();

const PAYMENT_OWNER_NAME =
    String(process.env.PAYMENT_OWNER_NAME || "TEST PAYMENT OWNER").trim();

const PAYMENT_PHONE =
    String(process.env.PAYMENT_PHONE || "TEST PAYMENT PHONE").trim();

const TELEBIRR_ACCOUNT =
    String(process.env.TELEBIRR_ACCOUNT || "TEST TELEBIRR ACCOUNT").trim();

const MIN_DEPOSIT_AMOUNT = 50;

const SUPPORTED_DEPOSIT_METHODS = {
    telebirr: true,
    mpesa: false,
    cbe_birr: false
};

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
app.use(express.static(__dirname));

/* SERVER AUDIO VOICE — game engines remain untouched. */
createVoiceRouter(app, { publicDir: path.join(__dirname, "public") });

/*
|--------------------------------------------------------------------------
| TELEGRAM REGISTRATION CONTACT CACHE
|--------------------------------------------------------------------------
| Telegram WebApp requestContact() tells the browser that sharing was
| accepted, while the actual phone contact arrives at the bot webhook.
| Keep that verified contact briefly so the Mini App can retrieve it.
|--------------------------------------------------------------------------
*/

const pendingRegistrationContacts = new Map();

function storeRegistrationContact(telegramId, phone) {
    const id = String(telegramId || "").trim();
    const normalized = normalizePhone(phone);
    if (!id || !normalized) return false;

    pendingRegistrationContacts.set(id, {
        phone: normalized,
        createdAt: Date.now()
    });

    return true;
}

function getRegistrationContact(telegramId) {
    const id = String(telegramId || "").trim();
    const entry = pendingRegistrationContacts.get(id);

    if (!entry) return null;

    if (Date.now() - entry.createdAt > 10 * 60 * 1000) {
        pendingRegistrationContacts.delete(id);
        return null;
    }

    return entry.phone;
}

/*
|--------------------------------------------------------------------------
| GAME ENGINES
|--------------------------------------------------------------------------
*/

const games = {}; // Legacy house games disabled. PVP engines are the active game system.

/*
|--------------------------------------------------------------------------
| DESTA PLAY — PVP ARENA FOUNDATION
|--------------------------------------------------------------------------
|
| This layer is additive. Existing payment, withdrawal, invitation,
| authentication and voice systems remain unchanged. PVP results are
| decided by the server only.
|
|--------------------------------------------------------------------------
*/
/* Normalize engine IDs so the server accepts both "bingo" and "pvp_bingo"
   exports from the existing repository. This prevents false "Unsupported PVP
   game" errors without changing the engine files themselves. */
const PVP_ENGINE_REGISTRY = Object.fromEntries(
    Object.entries(PVP_ENGINES || {}).map(([rawId, engine]) => [
        String(rawId).replace(/^pvp_/i, "").toLowerCase(),
        engine
    ])
);

const PVP_GAME_ORDER = [
    "bingo","keno","tambola","bingo90","bingo75","numberdraw","trivia",
    "wheel","ludo","highcard","penalty","dice","target","memory",
    "racing","speedcards","numberrush"
];

const PVP_GAMES = Object.fromEntries(
    PVP_GAME_ORDER
        .filter(id => PVP_ENGINE_REGISTRY[id])
        .map(id => {
            const engine = PVP_ENGINE_REGISTRY[id];
            return [id, {
                name: engine.name || id,
                maxPlayers: Number(engine.maxPlayers || 4),
                minPlayers: Number(engine.minPlayers || 2)
            }];
        })
);

const PVP_ENTRY_FEES = [...MANAGER_ENTRY_FEES];
const pvpManager = new PVPManager();
const PVP_HOUSE_RAKE_PERCENT = 10;
const pvpPoolEngine = new PoolEngine(PVP_HOUSE_RAKE_PERCENT);

const pvpRooms = new Map();
const pvpPlayerRooms = new Map();
const PVP_ROOM_TTL_MS = 30 * 60 * 1000;

function pvpRoomKey(game, entryFee) {
    return `${game}:${Number(entryFee).toFixed(2)}`;
}

function pvpPublicRoom(room) {
    return {
        roomId: room.roomId,
        game: room.game,
        gameName: PVP_GAMES[room.game]?.name || room.game,
        entryFee: room.entryFee,
        entryFees: PVP_ENTRY_FEES,
        grossPool: Number((room.players.size * room.entryFee).toFixed(2)),
        prizePool: Number((room.players.size * room.entryFee * 0.90).toFixed(2)),
        maxPlayers: room.maxPlayers,
        minPlayers: room.minPlayers,
        playersCount: room.players.size,
        status: room.status,
        roundId: room.roundId,
        createdAt: room.createdAt,
        startedAt: room.startedAt || null,
        bettingEndsAt: room.bettingEndsAt,
        remainingSeconds: Math.max(0, Math.ceil((room.bettingEndsAt - Date.now()) / 1000))
    };
}

function pvpGetOrCreateRoom(game, entryFee) {
    const key = pvpRoomKey(game, entryFee);
    const existing = pvpRooms.get(key);
    if (existing && existing.status === "BETTING" && existing.players.size < existing.maxPlayers && Date.now() < existing.bettingEndsAt) {
        return existing;
    }

    const cfg = PVP_GAMES[game];
    if (!cfg) throw new Error("Unsupported PVP game");
    if (!MANAGER_ENTRY_FEES.includes(Number(entryFee))) throw new Error("Invalid PVP entry fee");

    const now = Date.now();
    const room = {
        roomId: `pvp-${game}-${now}-${crypto.randomBytes(4).toString("hex")}`,
        roundId: `pvp-round-${now}-${crypto.randomBytes(5).toString("hex")}`,
        game,
        entryFee: Number(entryFee),
        maxPlayers: cfg.maxPlayers,
        minPlayers: cfg.minPlayers,
        players: new Map(),
        status: "BETTING",
        createdAt: now,
        bettingEndsAt: now + 45000,
        startedAt: null,
        finishedAt: null,
        state: {},
        result: null,
        settled: false,
        winnerIds: []
    };

    room.state = PVP_AUTHORITY.createAuthorityState(room, PVP_ENGINE_REGISTRY[game]?.createState ? PVP_ENGINE_REGISTRY[game].createState(room, [...room.players.values()]) : {});
    pvpRooms.set(key, room);
    pvpPersistRoom(room).catch(console.error);
    setTimeout(() => pvpStartRoomIfReady(room), 45000);
    return room;
}

function pvpEntryFee(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || !PVP_ENTRY_FEES.includes(n)) throw new Error("Invalid PVP entry fee");
    return n;
}

async function pvpPersistRoom(room) {
    try {
        if (!room.dbRoomId) {
            const { data, error } = await supabase.from("pvp_rooms").insert({
                game_id: room.game,
                entry_fee_etb: room.entryFee,
                round_id: room.roundId,
                status: room.status,
                max_players: room.maxPlayers,
                min_players: room.minPlayers,
                total_pool_etb: 0,
                rake_etb: 0,
                prize_pool_etb: 0,
                engine_state: room.state || {}
            }).select("id").single();
            if (error) throw error;
            room.dbRoomId = data.id;
        } else {
            const pool = pvpPoolEngine.calculatePool(room.entryFee, room.players.size);
            const { error } = await supabase.from("pvp_rooms").update({
                status: room.status,
                total_pool_etb: pool.totalPool,
                rake_etb: pool.houseFee,
                prize_pool_etb: pool.prizePool,
                engine_state: room.state || {},
                updated_at: nowIso()
            }).eq("id", room.dbRoomId);
            if (error) throw error;
        }
    } catch (error) { console.error("[PVP] Room persistence warning:", error.message); }
}

async function pvpPersistPlayer(room, player) {
    try {
        if (!room.dbRoomId) await pvpPersistRoom(room);
        if (!room.dbRoomId) return;
        await supabase.from("pvp_room_players").insert({
            room_id: room.dbRoomId,
            player_id: player.playerId,
            entry_fee_etb: room.entryFee,
            action_data: player.actionData || {},
            status: "JOINED"
        });
    } catch (error) { console.error("[PVP] Player persistence warning:", error.message); }
}

async function pvpPersistSettlement(room, result) {
    try {
        if (!room.dbRoomId) await pvpPersistRoom(room);
        if (!room.dbRoomId) return;
        await supabase.from("pvp_rounds").insert({ room_id: room.dbRoomId, game_id: room.game, round_id: room.roundId, status: room.status, state: room.state || {}, result: result || {} });
        await supabase.from("pvp_results").insert({ room_id: room.dbRoomId, game_id: room.game, round_id: room.roundId, result: result || {} });
        const pool = pvpPoolEngine.calculatePool(room.entryFee, room.players.size);
        await supabase.from("pvp_pool_ledger").insert({ room_id: room.dbRoomId, round_id: room.roundId, entry_fee_etb: room.entryFee, player_count: room.players.size, gross_pool_etb: pool.totalPool, rake_etb: pool.houseFee, prize_pool_etb: pool.prizePool });
        for (const winnerId of room.winnerIds || []) {
            await supabase.from("pvp_winners").insert({ room_id: room.dbRoomId, round_id: room.roundId, player_id: winnerId, prize_etb: result?.winnerShare || 0 });
            await supabase.from("pvp_settlements").upsert({ room_id: room.dbRoomId, round_id: room.roundId, player_id: winnerId, settlement_type: "WIN", amount_etb: result?.winnerShare || 0, reference_id: `${room.roundId}:win:${winnerId}`, metadata: result || {} }, { onConflict: "reference_id" });
        }
    } catch (error) { console.error("[PVP] Settlement persistence warning:", error.message); }
}

async function pvpDebitPlayer(playerId, room) {
    return changeBalance({
        playerId,
        amount: -room.entryFee,
        type: "pvp_entry",
        game: room.game,
        roundId: room.roundId,
        description: `PVP entry — ${room.game}`,
        metadata: { roomId: room.roomId, entryFee: room.entryFee }
    });
}

async function pvpHasSettlement(playerId, referenceId) {
    const { data, error } = await supabase
        .from("transactions")
        .select("id")
        .eq("player_id", playerId)
        .eq("reference_id", referenceId)
        .in("type", ["pvp_win", "pvp_refund"])
        .limit(1);
    if (error) {
        console.warn("[PVP] Settlement lookup failed:", error.message);
        return false;
    }
    return Array.isArray(data) && data.length > 0;
}

async function pvpSettleRoom(room, winnerIds = [], metadata = {}) {
    if (!room || room.settled) return room?.result || null;
    room.settled = true;
    room.status = "FINISHED";
    room.finishedAt = Date.now();

    const uniqueWinners = [...new Set((winnerIds || []).map(String))];
    const grossPool = Number((room.players.size * room.entryFee).toFixed(2));
    const houseRake = Number((grossPool * PVP_HOUSE_RAKE_PERCENT / 100).toFixed(2));
    const winnerPool = Number((grossPool - houseRake).toFixed(2));
    const baseShareCents = uniqueWinners.length ? Math.floor((winnerPool * 100) / uniqueWinners.length) : 0;
    const baseShare = Number((baseShareCents / 100).toFixed(2));
    const remainderCents = uniqueWinners.length ? Math.max(0, Math.round(winnerPool * 100) - baseShareCents * uniqueWinners.length) : 0;
    const roundingRemainder = Number((remainderCents / 100).toFixed(2));

    room.winnerIds = uniqueWinners;
    for (const player of room.players.values()) pvpPlayerRooms.delete(player.playerId);
    room.result = {
        grossPool,
        houseRake,
        winnerPool,
        winnerIds: uniqueWinners,
        winnerShare: baseShare,
        roundingRemainder,
        ...metadata
    };
    await pvpPersistRoom(room);
    await pvpPersistSettlement(room, room.result);

    for (let index = 0; index < uniqueWinners.length; index++) {
        const winnerId = uniqueWinners[index];
        const winnerCents = baseShareCents + (index < remainderCents ? 1 : 0);
        const winnerAmount = Number((winnerCents / 100).toFixed(2));
        if (winnerAmount <= 0) continue;
        const alreadySettled = await pvpHasSettlement(winnerId, `${room.roundId}:win`);
        if (alreadySettled) continue;
        try {
            await changeBalance({
                playerId: winnerId,
                amount: winnerAmount,
                type: "pvp_win",
                game: room.game,
                roundId: `${room.roundId}:win`,
                description: `PVP prize — ${room.game}`,
                metadata: { roomId: room.roomId, ...room.result }
            });
        } catch (error) {
            console.error(`[PVP] Winner settlement failed for ${winnerId}:`, error.message);
        }
    }

    return room.result;
}

async function pvpRefundRoom(room, reason = "Round cancelled") {
    if (!room || room.settled) return;
    room.settled = true;
    room.status = "FINISHED";
    room.finishedAt = Date.now();
    for (const player of room.players.values()) pvpPlayerRooms.delete(player.playerId);
    for (const player of room.players.values()) {
        const alreadyRefunded = await pvpHasSettlement(player.playerId, `${room.roundId}:refund`);
        if (alreadyRefunded) continue;
        try {
            await changeBalance({
                playerId: player.playerId,
                amount: room.entryFee,
                type: "pvp_refund",
                game: room.game,
                roundId: `${room.roundId}:refund`,
                description: `PVP refund — ${reason}`,
                metadata: { roomId: room.roomId, reason }
            });
        } catch (error) {
            console.error(`[PVP] Refund failed for ${player.playerId}:`, error.message);
        }
    }
}

function pvpWinnerByScore(players) {
    let best = -Infinity;
    let winners = [];
    for (const p of players) {
        const score = Number(p.score || 0);
        if (score > best) { best = score; winners = [p.playerId]; }
        else if (score === best) winners.push(p.playerId);
    }
    return winners;
}

async function pvpResolveRoom(room) {
    if (!room || room.status === "FINISHED" || room.status === "RESOLVING") return room?.result;
    if (room.players.size < room.minPlayers) {
        await pvpRefundRoom(room, "Not enough players");
        return room.result;
    }

    room.status = "RESOLVING";
    const players = [...room.players.values()];
    const engine = PVP_ENGINE_REGISTRY[room.game];
    if (!engine || typeof engine.resolve !== "function") {
        await pvpRefundRoom(room, "PVP engine unavailable");
        return room.result;
    }

    let resolved;
    try {
        resolved = await engine.resolve(room.state?.engineState || room.state, players);
    } catch (error) {
        console.error(`[PVP] ${room.game} engine error:`, error);
        await pvpRefundRoom(room, "Game engine error");
        return room.result;
    }

    const winnerIds = Array.isArray(resolved?.winners) ? resolved.winners.map(String) : [];
    return pvpSettleRoom(room, winnerIds, resolved || {});
}

function pvpStartRoomIfReady(room) {
    if (!room || room.status !== "BETTING") return;
    if (room.players.size < room.minPlayers) {
        pvpRefundRoom(room, "Not enough players").catch(console.error);
        return;
    }
    room.status = "PLAYING";
    room.startedAt = Date.now();
    room.bettingEndsAt = Date.now();
    for (const player of room.players.values()) { player.actionLocked = false; player.actionData = {}; }
    if (room.state?.version === 2) {
        const auth = room.state.authority;
        auth.phase = auth.phase === "WAITING" ? "ACTION" : auth.phase;
        const ids = [...room.players.keys()].map(String);
        if (!auth.currentPlayerId && ids.length) auth.currentPlayerId = ids[0];
    }
    pvpPersistRoom(room).catch(console.error);
}

setInterval(() => {
    const now = Date.now();
    for (const [key, room] of pvpRooms.entries()) {
        if ((room.status === "BETTING" && now >= room.bettingEndsAt) || (room.status === "FINISHED" && now - Number(room.finishedAt || now) > PVP_ROOM_TTL_MS)) {
            if (room.status === "BETTING") pvpStartRoomIfReady(room);
            if (room.status === "FINISHED") pvpRooms.delete(key);
        }
    }
}, 5000);

const rounds = {};

/* Persistent display sequence for each server-authoritative house game. */
const roundCounters = {
    keno: 0,
    roulette: 0,
    aviator: 0
};

/* Persistent display sequence for each Bingo stake room. */
const bingoRoundCounters = {};

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

/*
|--------------------------------------------------------------------------
| UNIQUE PLAYER INVITE CODE
|--------------------------------------------------------------------------
|
| Every player ID is generated from cryptographically random bytes. The
| invite code is a stable, unique server-generated representation of that
| player ID, so it survives browser refreshes and server restarts without
| requiring another database column.
|--------------------------------------------------------------------------
*/

function makeInviteCode(playerId) {
    const raw = String(playerId || "").trim();
    if (!raw) return "";
    return "DP" + raw.replace(/^DP-/i, "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

function inviteCodeToPlayerId(inviteCode) {
    const code = String(inviteCode || "").trim().toUpperCase();
    const suffix = code.replace(/^DP/, "");
    if (!/^[A-F0-9]{8}$/.test(suffix)) return null;
    return "DP-" + suffix;
}

function makeInviteLink(playerId) {
    const code = makeInviteCode(playerId);
    return code ? `${PUBLIC_APP_URL}/?ref=${encodeURIComponent(code)}` : "";
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

/*
|--------------------------------------------------------------------------
| PASSWORD VALIDATION
|--------------------------------------------------------------------------
|
| Minimum: 6 characters
| Maximum: 128 characters
| Allowed: A-Z, a-z, 0-9, #, @
|
| The same account password is used for withdrawal verification.
| There is no separate withdrawal password.
|
|--------------------------------------------------------------------------
*/

function validPassword(password) {
    return (
        typeof password === "string" &&
        password.length >= 6 &&
        password.length <= 128 &&
        /^[A-Za-z0-9#@]+$/.test(password)
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
| EDITIONS 2–7 FINANCIAL / ADMIN HELPERS
|--------------------------------------------------------------------------
*/

function normalizePhone(value) {
    return String(value || "")
        .trim()
        .replace(/[^0-9+]/g, "")
        .slice(0, 32);
}

function normalizeReference(value) {
    return String(value || "")
        .trim()
        .slice(0, 200);
}

function safeJson(value) {
    try {
        return JSON.stringify(value);
    } catch (_) {
        return "{}";
    }
}

function parseFirstAmount(text) {
    const matches = String(text || "").match(/(?:ETB|Birr|Amount|Paid|received|sent)?\s*([0-9]{1,9}(?:[.,][0-9]{1,2})?)/gi) || [];

    for (const item of matches) {
        const numberMatch = item.match(/[0-9]{1,9}(?:[.,][0-9]{1,2})?/);
        if (!numberMatch) continue;
        const amount = Number(numberMatch[0].replace(",", ""));
        if (Number.isFinite(amount) && amount > 0) return amount;
    }

    return null;
}

function extractReferenceCandidates(text) {
    const source = String(text || "");
    const values = new Set();

    const labeled = source.match(/(?:transaction|trans|reference|ref|receipt|id)[\s:#-]*([A-Za-z0-9_-]{5,80})/gi) || [];

    for (const item of labeled) {
        const match = item.match(/([A-Za-z0-9_-]{5,80})$/);
        if (match) values.add(match[1]);
    }

    const longTokens = source.match(/[A-Za-z0-9_-]{8,80}/g) || [];
    for (const token of longTokens) values.add(token);

    return [...values];
}

async function telegramApi(method, payload) {
    if (!TELEGRAM_BOT_TOKEN) {
        return { ok: false, skipped: true, error: "TELEGRAM_BOT_TOKEN is not configured" };
    }

    try {
        const response = await fetch(
            `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${method}`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(payload)
            }
        );

        const data = await response.json().catch(() => null);

        if (!response.ok || !data?.ok) {
            console.error("[TELEGRAM] API ERROR:", data || response.status);
            return { ok: false, error: data?.description || `HTTP ${response.status}` };
        }

        return { ok: true, data };
    } catch (error) {
        console.error("[TELEGRAM] REQUEST ERROR:", error);
        return { ok: false, error: error.message };
    }
}

async function sendAdminTelegramMessage(text, replyMarkup = null) {
    if (!ADMIN_TELEGRAM_ID) {
        console.warn("[ADMIN] ADMIN_TELEGRAM_ID is not configured");
        return { ok: false, skipped: true };
    }

    return telegramApi("sendMessage", {
        chat_id: ADMIN_TELEGRAM_ID,
        text,
        parse_mode: "HTML",
        ...(replyMarkup ? { reply_markup: replyMarkup } : {})
    });
}

async function sendAdminGroupAudit(text) {
    if (!ADMIN_PRIVATE_GROUP_ID) {
        console.warn("[ADMIN] ADMIN_PRIVATE_GROUP_ID is not configured");
        return { ok: false, skipped: true };
    }

    return telegramApi("sendMessage", {
        chat_id: ADMIN_PRIVATE_GROUP_ID,
        text,
        parse_mode: "HTML"
    });
}

function transactionDescription(data) {
    return safeJson({
        edition: data.edition || null,
        method: data.method || null,
        recipient: data.recipient || null,
        senderPhone: data.senderPhone || null,
        recipientPhone: data.recipientPhone || null,
        transactionId: data.transactionId || null,
        referenceId: data.referenceId || null,
        requestId: data.requestId || null,
        requestedAt: data.requestedAt || null,
        smsText: data.smsText || null
    });
}

async function findTransactionById(id) {
    const { data, error } = await supabase
        .from("transactions")
        .select("*")
        .eq("id", id)
        .maybeSingle();

    if (error) {
        await dbError("findTransactionById", error);
        throw new Error("Transaction lookup failed");
    }

    return data;
}

async function findPendingDeposits() {
    const { data, error } = await supabase
        .from("transactions")
        .select("*")
        .eq("type", "deposit")
        .eq("status", "PENDING")
        .order("created_at", { ascending: true })
        .limit(100);

    if (error) {
        await dbError("findPendingDeposits", error);
        throw new Error("Could not load pending deposits");
    }

    return data || [];
}

async function hasSuccessfulDepositReference(referenceId) {
    const ref = normalizeReference(referenceId);
    if (!ref) return false;

    const { data, error } = await supabase
        .from("transactions")
        .select("id")
        .eq("type", "deposit")
        .eq("reference_id", ref)
        .in("status", ["SUCCESS", "APPROVED", "COMPLETED"])
        .limit(1);

    if (error) {
        await dbError("hasSuccessfulDepositReference", error);
        throw new Error("Could not check duplicate payment reference");
    }

    return Array.isArray(data) && data.length > 0;
}

const paymentProcessingLocks = new Set();

async function approveDepositTransaction(transaction, verification) {
    if (!transaction) throw new Error("Deposit transaction not found");

    const referenceId = normalizeReference(
        verification.referenceId || transaction.reference_id
    );

    if (!referenceId) {
        throw new Error("Payment reference is required");
    }

    if (paymentProcessingLocks.has(referenceId)) {
        throw new Error("Payment verification is already being processed");
    }

    paymentProcessingLocks.add(referenceId);

    try {
        if (await hasSuccessfulDepositReference(referenceId)) {
            throw new Error("This payment has already been credited");
        }

        const pending = await findTransactionById(transaction.id);

        if (!pending || pending.status !== "PENDING") {
            if (pending?.status === "SUCCESS" || pending?.status === "APPROVED" || pending?.status === "COMPLETED") {
                throw new Error("This payment has already been credited");
            }
            throw new Error("Deposit is no longer pending");
        }

        const expectedAmount = Number(pending.amount);
        const actualAmount = Number(verification.amount);

        if (!Number.isFinite(actualAmount) || actualAmount !== expectedAmount) {
            throw new Error("Payment amount does not match the pending deposit");
        }

        const { data: marked, error: markError } = await supabase
            .from("transactions")
            .update({
                status: "APPROVED",
                reference_id: referenceId,
                description: transactionDescription({
                    edition: 4,
                    method: "telebirr",
                    recipient: verification.receiver || null,
                    senderPhone: verification.senderPhone || null,
                    transactionId: referenceId,
                    referenceId,
                    requestId: pending.id,
                    requestedAt: pending.created_at,
                    smsText: verification.smsText || null
                })
            })
            .eq("id", pending.id)
            .eq("status", "PENDING")
            .select("*")
            .maybeSingle();

        if (markError) {
            await dbError("approveDepositTransaction mark", markError);
            throw new Error("Could not approve deposit");
        }

        if (!marked) {
            throw new Error("Deposit was already processed or changed");
        }

        const balanceAfter = await changeBalance({
            playerId: pending.player_id,
            amount: expectedAmount,
            type: "deposit_credit",
            description: "Verified Telebirr deposit",
            roundId: referenceId,
            metadata: {
                referenceId,
                verifiedAmount: expectedAmount,
                sender: verification.sender || null,
                senderPhone: verification.senderPhone || null,
                receiver: verification.receiver || null,
                receiverPhone: verification.receiverPhone || null,
                smsTime: verification.smsTime || null
            }
        });

        /* FIRST DEPOSIT BONUS: 300% as bonus points.
         * Bonus points are separate from cash balance.
         * Play value: 1 point = 1 ETB. Withdrawal value: 10 points = 1 ETB.
         */
        try {
            const { data: priorCredits, error: priorCreditError } = await supabase
                .from("transactions")
                .select("id")
                .eq("player_id", pending.player_id)
                .eq("type", "deposit_credit")
                .in("status", ["SUCCESS", "APPROVED", "COMPLETED"])
                .limit(2);

            if (priorCreditError) throw priorCreditError;

            if (!Array.isArray(priorCredits) || priorCredits.length <= 1) {
                const bonusPoints = Number((expectedAmount * 3).toFixed(2));
                if (bonusPoints > 0) {
                    await writeBonusTransaction({
                        playerId: pending.player_id,
                        points: bonusPoints,
                        type: "first_deposit_bonus",
                        description: JSON.stringify({
                            reason: "300% first deposit bonus",
                            depositAmount: expectedAmount,
                            bonusPoints
                        }),
                        referenceId
                    });
                }
            }
        } catch (bonusError) {
            console.error("[BONUS] First deposit bonus could not be recorded:", bonusError);
        }

        await sendAdminGroupAudit(
            `DEPOSIT VERIFIED\nPlayer: ${pending.player_id}\nAmount: ${expectedAmount} ETB\nReference: ${referenceId}\nBalance after: ${balanceAfter}`
        );

        return {
            transaction: marked,
            balanceAfter,
            referenceId
        };
    } finally {
        paymentProcessingLocks.delete(referenceId);
    }
}

function withdrawalReplyMarkup(requestId) {
    return {
        inline_keyboard: [
            [
                { text: "ACCEPT", callback_data: `dpw:accept:${requestId}` },
                { text: "REJECT", callback_data: `dpw:reject:${requestId}` },
                { text: "COMPLETED", callback_data: `dpw:completed:${requestId}` }
            ]
        ]
    };
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

async function findPlayerByPhone(phone) {
    const normalized = normalizePhone(phone);

    if (!normalized) return null;

    const { data, error } = await supabase
        .from("players")
        .select("*")
        .eq("phone", normalized)
        .maybeSingle();

    if (error) {
        await dbError("findPlayerByPhone", error);
        throw new Error("Database error");
    }

    return data;
}

/*
|--------------------------------------------------------------------------
| TELEGRAM MINI APP ACCOUNT BOOTSTRAP
|--------------------------------------------------------------------------
| Existing Telegram players receive a session automatically. New players
| are sent to the registration screen. No login is required for entry.
|--------------------------------------------------------------------------
*/

app.get(
    "/api/account/bootstrap",
    async (req, res) => {
        try {
            const telegramId = String(
                req.query.telegramId || ""
            ).trim();

            if (!telegramId) {
                return res.status(400).json({
                    success: false,
                    error: "Telegram account information is not available."
                });
            }

            const player =
                await findPlayerByTelegramId(telegramId);

            if (!player) {
                return res.json({
                    success: true,
                    registered: false,
                    registrationRequired: true
                });
            }

            const token = createSession(player);

            return res.json({
                success: true,
                registered: true,
                registrationRequired: false,
                token,
                player: publicPlayer(player)
            });
        } catch (error) {
            console.error("Account bootstrap error:", error);

            return res.status(500).json({
                success: false,
                error: error.message || "Could not initialize account"
            });
        }
    }
);

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
    }    return {
        playerId: player.id,
        telegramId: player.telegram_id,
        telegramName: player.username || "Player",
        balance: Number(player.balance || 0),
        createdAt: player.created_at,
        inviteCode: makeInviteCode(player.id),
        inviteLink: makeInviteLink(player.id)
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
| BONUS POINT LEDGER
|--------------------------------------------------------------------------
|
| Uses the existing transactions table so no new database column is needed.
| Bonus points never change the cash balance.
| 1 point = 1 ETB play value.
| 10 points = 1 ETB withdrawal value.
|--------------------------------------------------------------------------
*/
async function writeBonusTransaction({ playerId, points, type, description = null, referenceId = null }) {
    const value = Number(points);
    if (!Number.isFinite(value) || value === 0) return;
    const player = await findPlayerById(playerId);
    if (!player) throw new Error("Player not found");
    await writeTransaction({
        playerId,
        type,
        amount: value,
        balanceBefore: Number(player.balance || 0),
        balanceAfter: Number(player.balance || 0),
        status: "SUCCESS",
        description,
        referenceId
    });
}

async function getBonusLedger(playerId) {
    const { data, error } = await supabase
        .from("transactions")
        .select("id,type,amount,description,reference_id,created_at")
        .eq("player_id", playerId)
        .in("type", [
            "invite_bonus_points",
            "first_deposit_bonus",
            "bonus_play",
            "bonus_win",
            "bonus_adjustment"
        ])
        .eq("status", "SUCCESS")
        .order("created_at", { ascending: true })
        .limit(500);
    if (error) {
        await dbError("getBonusLedger", error);
        throw new Error("Could not load bonus points");
    }
    return data || [];
}

async function getBonusPoints(playerId) {
    const rows = await getBonusLedger(playerId);
    return Number(rows.reduce((sum, row) => sum + Number(row.amount || 0), 0).toFixed(2));
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

    const token =
        authorization
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
            telegramUsername,
            password,
            phone,
            referralCode
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

        const normalizedReferralCode = String(referralCode || "").trim().toUpperCase();
        const referrerPlayerId = inviteCodeToPlayerId(normalizedReferralCode);
        let validReferrer = null;

        if (referrerPlayerId) {
            validReferrer = await findPlayerById(referrerPlayerId);
        }

        if (normalizedReferralCode && !validReferrer) {
            return res.status(400).json({
                success: false,
                error: "Invalid invite code"
            });
        }

        if (!validPassword(password)) {
            return res.status(400).json({
                success: false,
                error:
                    "Password must be at least 6 characters and may contain only letters, numbers, #, or @"
            });
        }

        const normalizedPhone =
            normalizePhone(phone);

        if (!normalizedPhone) {
            return res.status(400).json({
                success: false,
                error: "Verified Telegram phone number is required"
            });
        }

        const pendingPhone =
            getRegistrationContact(telegramId);

        if (pendingPhone && pendingPhone !== normalizedPhone) {
            return res.status(400).json({
                success: false,
                error: "Phone number verification does not match Telegram contact"
            });
        }

        const phoneOwner =
            await findPlayerByPhone(normalizedPhone);

        if (phoneOwner) {
            return res.status(400).json({
                success: false,
                error: "This phone number is already registered"
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
                    telegram_username: String(telegramUsername || "").trim(),
                    phone: normalizedPhone,
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

        if (validReferrer) {
            try {
                await writeBonusTransaction({
                    playerId: validReferrer.id,
                    points: 10,
                    type: "invite_bonus_points",
                    description: JSON.stringify({
                        reason: "Successful invitation",
                        invitedPlayerId: insertedPlayer.id,
                        referralCode: normalizedReferralCode,
                        rewardPoints: 10
                    }),
                    referenceId: insertedPlayer.id
                });
            } catch (bonusError) {
                console.error("[BONUS] Invite reward could not be recorded:", bonusError);
            }
        }

        const token =
            createSession(insertedPlayer);

        return res.json({
            success: true,
            token,
            player: publicPlayer(insertedPlayer),
            inviteCode: makeInviteCode(insertedPlayer.id),
            inviteLink: makeInviteLink(insertedPlayer.id),
            referredBy: validReferrer ? validReferrer.id : null
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
| REGISTRATION CONTACT
|--------------------------------------------------------------------------
*/

app.get(
    "/api/account/registration-contact",
    async (req, res) => {
        try {
            const telegramId = String(
                req.query.telegramId || ""
            ).trim();

            if (!telegramId) {
                return res.status(400).json({
                    success: false,
                    shared: false,
                    error: "Telegram ID is required"
                });
            }

            const phone =
                getRegistrationContact(telegramId);

            if (!phone) {
                return res.json({
                    success: true,
                    shared: false
                });
            }

            return res.json({
                success: true,
                shared: true,
                phone
            });
        } catch (error) {
            console.error(
                "Registration contact lookup error:",
                error
            );

            return res.status(500).json({
                success: false,
                shared: false,
                error: "Could not check Telegram phone contact"
            });
        }
    }
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
| EDITION 1 — PASSWORD RESET
|--------------------------------------------------------------------------
*/

function passwordResetReplyMarkup(requestId) {
    return {
        inline_keyboard: [[
            {
                text: "APPROVE RESET",
                callback_data: `dpr:approve:${requestId}`
            },
            {
                text: "REJECT RESET",
                callback_data: `dpr:reject:${requestId}`
            }
        ]]
    };
}

async function findPasswordResetRequest(
    requestId,
    phone = null
) {
    let query =
        supabase
            .from("password_reset_requests")
            .select("*")
            .eq("id", requestId);

    if (phone) {
        query =
            query.eq(
                "phone",
                normalizePhone(phone)
            );
    }

    const { data, error } =
        await query.maybeSingle();

    if (error) {
        await dbError(
            "findPasswordResetRequest",
            error
        );

        throw new Error("Database error");
    }

    return data;
}

async function processPasswordResetAction(
    action,
    requestId
) {
    const request =
        await findPasswordResetRequest(requestId);

    if (!request) {
        throw new Error(
            "Password reset request not found"
        );
    }

    if (
        request.status === "PENDING" &&
        action === "approve"
    ) {
        const { data, error } =
            await supabase
                .from("password_reset_requests")
                .update({
                    status: "APPROVED",
                    approved_at: nowIso()
                })
                .eq("id", requestId)
                .eq("status", "PENDING")
                .select("*")
                .maybeSingle();

        if (error) {
            await dbError(
                "password reset approve",
                error
            );

            throw new Error(
                "Could not approve password reset"
            );
        }

        if (!data) {
            throw new Error(
                "Password reset request was already processed"
            );
        }

        await sendAdminGroupAudit(
            `PASSWORD RESET APPROVED\nRequest: ${requestId}\nPlayer: ${request.player_id}`
        );

        return "RESET APPROVED";
    }

    if (
        request.status === "PENDING" &&
        action === "reject"
    ) {
        const { data, error } =
            await supabase
                .from("password_reset_requests")
                .update({
                    status: "REJECTED",
                    rejected_at: nowIso()
                })
                .eq("id", requestId)
                .eq("status", "PENDING")
                .select("*")
                .maybeSingle();

        if (error) {
            await dbError(
                "password reset reject",
                error
            );

            throw new Error(
                "Could not reject password reset"
            );
        }

        if (!data) {
            throw new Error(
                "Password reset request was already processed"
            );
        }

        await sendAdminGroupAudit(
            `PASSWORD RESET REJECTED\nRequest: ${requestId}\nPlayer: ${request.player_id}`
        );

        return "RESET REJECTED";
    }

    throw new Error(
        `Cannot ${action} reset in ${request.status} status`
    );
}

app.post(
    "/api/account/password-reset-request",
    async (req, res) => {
        try {
            const phone =
                normalizePhone(req.body.phone);

            if (!phone) {
                return res.status(400).json({
                    success: false,
                    error: "Phone number is required"
                });
            }

            const player =
                await findPlayerByPhone(phone);

            if (!player) {
                return res.status(404).json({
                    success: false,
                    error: "Account not found"
                });
            }

            const requestId =
                makeId("RST");

            const { data, error } =
                await supabase
                    .from("password_reset_requests")
                    .insert({
                        id: requestId,
                        player_id: player.id,
                        phone,
                        status: "PENDING",
                        created_at: nowIso()
                    })
                    .select("*")
                    .single();

            if (error) {
                await dbError(
                    "password reset request insert",
                    error
                );

                throw new Error(
                    "Could not create password reset request"
                );
            }

            const text =
                `<b>DESTA PLAY — PASSWORD RESET REQUEST</b>\n` +
                `Account/Player ID: ${String(player.id)}\n` +
                `Phone: ${phone}\n` +
                `Telegram name: ${String(player.username || "Player")}\n` +
                `Telegram ID: ${String(player.telegram_id || "Not available")}\n` +
                `Request ID: ${requestId}\n` +
                `Request time: ${nowIso()}\n\n` +
                `No password or password hash is included.`;

            await sendAdminTelegramMessage(
                text,
                passwordResetReplyMarkup(requestId)
            );

            await sendAdminGroupAudit(
                text.replace(/<[^>]+>/g, "")
            );

            return res.json({
                success: true,
                status: data.status,
                requestId,
                message:
                    "Reset request submitted. Wait for administrator approval."
            });
        } catch (error) {
            console.error(
                "Password reset request error:",
                error
            );

            return res.status(500).json({
                success: false,
                error:
                    error.message ||
                    "Could not submit password reset request"
            });
        }
    }
);

app.get(
    "/api/account/password-reset-status",
    async (req, res) => {
        try {
            const phone =
                normalizePhone(req.query.phone);

            const requestId =
                String(
                    req.query.requestId || ""
                ).trim();

            if (!phone || !requestId) {
                return res.status(400).json({
                    success: false,
                    error:
                        "Phone number and reset request ID are required"
                });
            }

            const request =
                await findPasswordResetRequest(
                    requestId,
                    phone
                );

            if (!request) {
                return res.status(404).json({
                    success: false,
                    error:
                        "Password reset request not found"
                });
            }

            return res.json({
                success: true,
                status: request.status,
                requestId: request.id
            });
        } catch (error) {
            console.error(
                "Password reset status error:",
                error
            );

            return res.status(500).json({
                success: false,
                error:
                    error.message ||
                    "Could not check password reset status"
            });
        }
    }
);

app.post(
    "/api/account/password-reset-complete",
    async (req, res) => {
        try {
            const phone =
                normalizePhone(req.body.phone);

            const requestId =
                String(
                    req.body.requestId || ""
                ).trim();

            const password =
                req.body.password;

            if (!phone || !requestId) {
                return res.status(400).json({
                    success: false,
                    error:
                        "Phone number and reset request ID are required"
                });
            }

            if (!validPassword(password)) {
                return res.status(400).json({
                    success: false,
                    error:
                        "Password must be between 8 and 128 characters"
                });
            }

            const request =
                await findPasswordResetRequest(
                    requestId,
                    phone
                );

            if (!request) {
                return res.status(404).json({
                    success: false,
                    error:
                        "Password reset request not found"
                });
            }

            if (request.status !== "APPROVED") {
                return res.status(400).json({
                    success: false,
                    error:
                        request.status === "REJECTED"
                            ? "Password reset was rejected by the administrator"
                            : request.status === "COMPLETED"
                                ? "Password reset has already been completed"
                                : "Password reset is waiting for administrator approval"
                });
            }

            const passwordHash =
                await argon2.hash(password);

            const {
                data: updatedPlayer,
                error: playerError
            } =
                await supabase
                    .from("players")
                    .update({
                        password_hash: passwordHash,
                        updated_at: nowIso()
                    })
                    .eq("id", request.player_id)
                    .eq("phone", phone)
                    .select("*")
                    .maybeSingle();

            if (playerError) {
                await dbError(
                    "password reset player update",
                    playerError
                );

                throw new Error(
                    "Could not change password"
                );
            }

            if (!updatedPlayer) {
                return res.status(404).json({
                    success: false,
                    error:
                        "Player account not found"
                });
            }
                    const { data: completedRequest, error: requestError } =
            await supabase
                .from("password_reset_requests")
                .update({
                    status: "COMPLETED",
                    completed_at: nowIso()
                })
                .eq("id", requestId)
                .eq("status", "APPROVED")
                .select("*")
                .maybeSingle();

        if (requestError) {
            await dbError(
                "password reset completion",
                requestError
            );

            throw new Error(
                "Password changed, but reset status could not be finalized"
            );
        }

        if (!completedRequest) {
            throw new Error(
                "Password reset request was already completed"
            );
        }

        return res.json({
            success: true,
            status: "COMPLETED",
            message: "Password changed successfully"
        });
    } catch (error) {
        console.error(
            "Password reset completion error:",
            error
        );

        return res.status(500).json({
            success: false,
            error:
                error.message ||
                "Could not reset password"
        });
    }
});

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
| BONUS POINTS
|--------------------------------------------------------------------------
*/
app.get("/api/bonus", requirePlayer, async (req, res) => {
    try {
        const points = await getBonusPoints(req.player.id);
        return res.json({
            success:true,
            bonusPoints:Math.max(0, points),
            playValue:Number(Math.max(0, points).toFixed(2)),
            withdrawalValue:Number((Math.max(0, points) / 10).toFixed(2)),
            playRate:"1 point = 1 ETB play value",
            withdrawalRate:"10 points = 1 ETB withdrawal value",
            eligibleGames:["aviator","roulette"]
        });
    } catch (error) {
        return res.status(500).json({success:false,error:error.message || "Could not load bonus points"});
    }
});

/*
|--------------------------------------------------------------------------
| PLAYER INVITE
|--------------------------------------------------------------------------
|
| Returns the unique invite code/link for the authenticated player. The
| code is derived from the server-generated player ID, so every player has
| a different code and the code does not change after refresh/restart.
|--------------------------------------------------------------------------
*/

app.get(
    "/api/invite",
    requirePlayer,
    async (req, res) => {
        try {
            const inviteCode = makeInviteCode(req.player.id);
            const ledger = await getBonusLedger(req.player.id);
            let invitedPlayers = 0;
            for (const row of ledger) {
                if (row.type !== "invite_bonus_points") continue;
                try {
                    const meta = JSON.parse(row.description || "{}");
                    if (meta.invitedPlayerId) invitedPlayers += 1;
                } catch (_) {}
            }
            const earnedPoints = Number(ledger
                .filter(r => ["invite_bonus_points", "first_deposit_bonus", "bonus_win", "bonus_adjustment"].includes(r.type))
                .reduce((sum, r) => sum + Number(r.amount || 0), 0).toFixed(2));
            const usedPoints = Number(ledger
                .filter(r => r.type === "bonus_play")
                .reduce((sum, r) => sum + Math.abs(Number(r.amount || 0)), 0).toFixed(2));
            const bonusPoints = Number((earnedPoints - usedPoints).toFixed(2));
            return res.json({
                success: true,
                inviteCode,
                inviteLink: makeInviteLink(req.player.id),
                invitedPlayers,
                earnedPoints,
                usedPoints,
                bonusPoints: Math.max(0, bonusPoints),
                playValue: Math.max(0, bonusPoints),
                withdrawalValue: Number((Math.max(0, bonusPoints) / 10).toFixed(2))
            });
        } catch (error) {
            return res.status(500).json({ success:false, error:error.message || "Could not load invite information" });
        }
    }
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
| EDITION 2 — PUBLIC PAYMENT CONFIGURATION
|--------------------------------------------------------------------------
*/

app.get(
    "/api/payment/config",
    requirePlayer,
    (req, res) => {
        return res.json({
            success: true,
            minimumDeposit: MIN_DEPOSIT_AMOUNT,
            methods: {
                telebirr: {
                    available: true,
                    ownerName: PAYMENT_OWNER_NAME,
                    phone: PAYMENT_PHONE,
                    account: TELEBIRR_ACCOUNT
                },
                mpesa: {
                    available: false,
                    message:
                        "Payment method is not available now."
                },
                cbeBirr: {
                    available: false,
                    message:
                        "Payment method is not available now."
                }
            }
        });
    }
);

/*
|--------------------------------------------------------------------------
| EDITION 3 — DEPOSIT REQUEST
|--------------------------------------------------------------------------
*/

app.post(
    "/api/deposit/request",
    requirePlayer,
    async (req, res) => {
        try {
            const amount =
                Number(req.body.amount);

            const method =
                String(
                    req.body.method ||
                    "telebirr"
                )
                    .trim()
                    .toLowerCase();

            const transactionId =
                normalizeReference(
                    req.body.transactionId
                );

            const referenceId =
                normalizeReference(
                    req.body.referenceId ||
                    transactionId
                );

            const recipient =
                String(
                    req.body.recipient ||
                    PAYMENT_OWNER_NAME
                )
                    .trim()
                    .slice(0, 120);

            const senderPhone =
                normalizePhone(
                    req.body.senderPhone
                );

            if (
                !Number.isFinite(amount) ||
                amount < MIN_DEPOSIT_AMOUNT
            ) {
                return res.status(400).json({
                    success: false,
                    error:
                        `Minimum deposit amount is ${MIN_DEPOSIT_AMOUNT} ETB`
                });
            }

            if (
                !SUPPORTED_DEPOSIT_METHODS[method]
            ) {
                return res.status(400).json({
                    success: false,
                    error:
                        method === "mpesa" ||
                        method === "cbe_birr"
                            ? "Payment method is not available now."
                            : "Unsupported payment method"
                });
            }

            if (!referenceId) {
                return res.status(400).json({
                    success: false,
                    error:
                        "Payment transaction/reference link is required"
                });
            }

            if (
                await hasSuccessfulDepositReference(
                    referenceId
                )
            ) {
                return res.status(409).json({
                    success: false,
                    error:
                        "This payment reference has already been credited"
                });
            }

            const {
                data: existingPending,
                error: duplicateError
            } =
                await supabase
                    .from("transactions")
                    .select("id,status")
                    .eq("type", "deposit")
                    .eq(
                        "reference_id",
                        referenceId
                    )
                    .in(
                        "status",
                        [
                            "PENDING",
                            "APPROVED",
                            "SUCCESS",
                            "COMPLETED"
                        ]
                    )
                    .limit(1);

            if (duplicateError) {
                await dbError(
                    "deposit duplicate check",
                    duplicateError
                );

                throw new Error(
                    "Could not check payment reference"
                );
            }

            if (existingPending?.length) {
                return res.status(409).json({
                    success: false,
                    error:
                        "This payment reference is already submitted"
                });
            }

            const requestId =
                makeId("DEP");

            const { data, error } =
                await supabase
                    .from("transactions")
                    .insert({
                        id: requestId,
                        player_id: req.player.id,
                        type: "deposit",
                        amount,
                        balance_before:
                            Number(
                                req.player.balance || 0
                            ),
                        balance_after:
                            Number(
                                req.player.balance || 0
                            ),
                        status: "PENDING",
                        description:
                            transactionDescription({
                                edition: 3,
                                method,
                                recipient,
                                senderPhone,
                                transactionId,
                                referenceId,
                                requestId,
                                requestedAt: nowIso()
                            }),
                        reference_id: referenceId,
                        created_at: nowIso()
                    })
                    .select("*")
                    .single();

            if (error) {
                await dbError(
                    "deposit request insert",
                    error
                );

                throw new Error(
                    "Could not create deposit request"
                );
            }

            await sendAdminGroupAudit(
                `DEPOSIT PENDING\nPlayer: ${req.player.id}\nAmount: ${amount} ETB\nReference: ${referenceId}\nRequest: ${requestId}`
            );

            return res.json({
                success: true,
                status: "PENDING",
                requestId,
                amount,
                minimumDeposit:
                    MIN_DEPOSIT_AMOUNT,
                referenceId:
                    data.reference_id
            });
        } catch (error) {
            console.error(
                "Deposit request error:",
                error
            );

            return res.status(500).json({
                success: false,
                error:
                    error.message ||
                    "Could not create deposit request"
            });
        }
    }
);

/*
|--------------------------------------------------------------------------
| EDITION 4 — SMS PAYMENT VERIFICATION
|--------------------------------------------------------------------------
|
| The SMS forwarder can POST the complete SMS text here. The endpoint
| never credits a deposit from the player's submission alone. A forwarded
| payment must contain a matching amount and transaction/reference value.
|--------------------------------------------------------------------------
*/

app.post(
    "/api/payment/sms",
    async (req, res) => {
        try {
            if (SMS_WEBHOOK_SECRET) {
                const supplied =
                    String(
                        req.headers[
                            "x-sms-webhook-secret"
                        ] ||
                        req.headers[
                            "x-webhook-secret"
                        ] ||
                        ""
                    );

                if (
                    supplied !==
                    SMS_WEBHOOK_SECRET
                ) {
                    return res.status(401).json({
                        success: false,
                        error: "Unauthorized"
                    });
                }
            }

            const smsText =
                String(
                    req.body.message ||
                    req.body.text ||
                    req.body.sms ||
                    req.body.body ||
                    ""
                ).trim();

            if (!smsText) {
                return res.status(400).json({
                    success: false,
                    error:
                        "SMS message is required"
                });
            }

            const forwardedAmount =
                Number(req.body.amount) ||
                parseFirstAmount(smsText);

            const referenceCandidates = [
                normalizeReference(
                    req.body.transactionId
                ),
                normalizeReference(
                    req.body.referenceId
                ),
                ...extractReferenceCandidates(
                    smsText
                )
            ].filter(Boolean);

            const sender =
                String(
                    req.body.sender ||
                    req.body.senderName ||
                    ""
                ).trim();

            const senderPhone =
                normalizePhone(
                    req.body.senderPhone ||
                    req.body.from ||
                    ""
                );

            const receiver =
                String(
                    req.body.receiver ||
                    req.body.recipient ||
                    ""
                ).trim();

            const receiverPhone =
                normalizePhone(
                    req.body.receiverPhone ||
                    req.body.to ||
                    ""
                );

            const pending =
                await findPendingDeposits();

            let matched = null;

            for (const deposit of pending) {
                const description =
                    String(
                        deposit.description || ""
                    );

                const referenceMatches =
                    referenceCandidates.includes(
                        String(
                            deposit.reference_id || ""
                        )
                    ) ||
                    referenceCandidates.some(
                        token =>
                            description.includes(
                                token
                            )
                    );

                const amountMatches =
                    Number.isFinite(
                        forwardedAmount
                    ) &&
                    Number(deposit.amount) ===
                        Number(
                            forwardedAmount
                        );

                if (
                    referenceMatches &&
                    amountMatches
                ) {
                    matched = deposit;
                    break;
                }
            }

            if (!matched) {
                return res.status(200).json({
                    success: true,
                    verified: false,
                    credited: false,
                    message:
                        "No pending deposit matched this SMS"
                });
            }

            const referenceId =
                String(
                    matched.reference_id ||
                    referenceCandidates[0] ||
                    ""
                );

            const result =
                await approveDepositTransaction(
                    matched,
                    {
                        amount:
                            forwardedAmount,
                        referenceId,
                        sender,
                        senderPhone,
                        receiver,
                        receiverPhone,
                        smsTime:
                            req.body.timestamp ||
                            req.body.time ||
                            null,
                        smsText
                    }
                );

            return res.json({
                success: true,
                verified: true,
                credited: true,
                playerId:
                    matched.player_id,
                amount:
                    Number(matched.amount),
                referenceId:
                    result.referenceId,
                balanceAfter:
                    result.balanceAfter
            });
        } catch (error) {
            console.error(
                "SMS verification error:",
                error
            );

            return res.status(400).json({
                success: false,
                verified: false,
                credited: false,
                error:
                    error.message ||
                    "Payment verification failed"
            });
        }
    }
);

/*
|--------------------------------------------------------------------------
| EDITION 5 — WITHDRAWAL REQUEST
|--------------------------------------------------------------------------
*/

app.post(
    "/api/withdraw/request",
    requirePlayer,
    async (req, res) => {
        try {
            const amount =
                Number(req.body.amount);

            const recipientName =
                String(
                    req.body.recipientName ||
                    req.body.fullName ||
                    ""
                )
                    .trim()
                    .slice(0, 120);

            const recipientPhone =
                normalizePhone(
                    req.body.recipientPhone ||
                    req.body.phone
                );

            const password =
                String(
                    req.body.password || ""
                );

            if (
                !Number.isFinite(amount) ||
                amount <= 0
            ) {
                return res.status(400).json({
                    success: false,
                    error:
                        "Invalid withdrawal amount"
                });
            }

            const before =
                Number(
                    req.player.balance || 0
                );

            if (amount > before) {
                return res.status(400).json({
                    success: false,
                    error:
                        "Insufficient balance",
                    balanceBefore: before
                });
            }

            if (
                !recipientName ||
                !recipientPhone
            ) {
                return res.status(400).json({
                    success: false,
                    error:
                        "Recipient full name and phone are required"
                });
            }

            if (!validPassword(password)) {
                return res.status(400).json({
                    success: false,
                    error:
                        "Password is required"
                });
            }

            if (!req.player.password_hash) {
                return res.status(401).json({
                    success: false,
                    error:
                        "Account password is not configured"
                });
            }

            const valid =
                await argon2.verify(
                    req.player.password_hash,
                    password
                );

            if (!valid) {
                return res.status(401).json({
                    success: false,
                    error:
                        "Incorrect password"
                });
            }

            const after =
                before - amount;

            const requestId =
                makeId("WDR");

            await changeBalance({
                playerId:
                    req.player.id,
                amount: -amount,
                type:
                    "withdrawal_reserve",
                description:
                    `Withdrawal reservation ${requestId}`,
                roundId:
                    requestId,
                metadata: {
                    requestId,
                    recipientName,
                    recipientPhone
                }
            });

            const {
                data,
                error
            } =
                await supabase
                    .from("transactions")
                    .insert({
                        id: requestId,
                        player_id:
                            req.player.id,
                        type:
                            "withdrawal",
                        amount,
                        balance_before:
                            before,
                        balance_after:
                            after,
                        status:
                            "PENDING",
                        description:
                            transactionDescription({
                                edition: 5,
                                recipient:
                                    recipientName,
                                recipientPhone,
                                requestId,
                                requestedAt:
                                    nowIso()
                            }),
                        reference_id:
                            requestId,
                        created_at:
                            nowIso()
                    })
                    .select("*")
                    .single();

            if (error) {
                await dbError(
                    "withdrawal request insert",
                    error
                );

                /*
                 * Reservation was already recorded; return it so a failed
                 * request insert does not silently consume player funds.
                 */
                await changeBalance({
                    playerId:
                        req.player.id,
                    amount,
                    type:
                        "withdrawal_reservation_reversal",
                    description:
                        `Withdrawal request rollback ${requestId}`,
                    roundId:
                        requestId
                });

                throw new Error(
                    "Could not create withdrawal request"
                );
            }

            const text =
                `<b>DESTA PLAY — WITHDRAWAL REQUEST</b>\n` +
                `Telegram name: ${String(req.player.username || "Player")}\n` +
                `Username: ${String(req.player.telegram_username || "Not available")}\n` +
                `Account/Player ID: ${String(req.player.id)}\n` +
                `Recipient: ${recipientName}\n` +
                `Phone: ${recipientPhone}\n` +
                `Amount: ${amount} ETB\n` +
                `Balance before: ${before} ETB\n` +
                `Balance after: ${after} ETB\n` +
                `Request ID: ${requestId}\n` +
                `Request time: ${nowIso()}`;

            await sendAdminTelegramMessage(
                text,
                withdrawalReplyMarkup(
                    requestId
                )
            );

            await sendAdminGroupAudit(
                text.replace(
                    /<[^>]+>/g,
                    ""
                )
            );

            return res.json({
                success: true,
                status: "PENDING",
                requestId,
                amount,
                balanceBefore: before,
                balanceAfter: after
            });
        } catch (error) {
            console.error(
                "Withdrawal request error:",
                error
            );

            return res.status(500).json({
                success: false,
                error:
                    error.message ||
                    "Could not create withdrawal request"
            });
        }
    }
);

/*
|--------------------------------------------------------------------------
| EDITION 6 — TELEGRAM WITHDRAWAL CONTROL
|--------------------------------------------------------------------------
|
| Telegram callback buttons are processed through the webhook below.
| Passwords and password hashes are never sent to Telegram.
|--------------------------------------------------------------------------
*/

async function processWithdrawalAction(
    action,
    requestId
) {
    const transaction =
        await findTransactionById(
            requestId
        );

    if (
        !transaction ||
        transaction.type !==
            "withdrawal"
    ) {
        throw new Error(
            "Withdrawal request not found"
        );
    }

    if (action === "accept") {
        if (
            transaction.status !==
            "PENDING"
        ) {
            throw new Error(
                `Cannot ACCEPT withdrawal in ${transaction.status} status`
            );
        }
                const { data, error } = await supabase
            .from("transactions")
            .update({ status: "APPROVED" })
            .eq("id", requestId)
            .eq("status", "PENDING")
            .select("*")
            .maybeSingle();

        if (error) {
            await dbError("withdrawal accept", error);
            throw new Error("Could not accept withdrawal");
        }

        if (!data) throw new Error("Withdrawal was already processed");

        await sendAdminGroupAudit(
            `WITHDRAWAL ACCEPTED\nRequest: ${requestId}\nAmount: ${transaction.amount} ETB`
        );

        return "ACCEPTED";
    }

    if (action === "reject") {
        if (transaction.status !== "PENDING") {
            throw new Error(`Cannot REJECT withdrawal in ${transaction.status} status`);
        }

        const player = await findPlayerById(transaction.player_id);
        if (!player) throw new Error("Player not found");

        const amount = Number(transaction.amount);
        const before = Number(player.balance || 0);

        const { data, error } = await supabase
            .from("transactions")
            .update({ status: "REJECTED" })
            .eq("id", requestId)
            .eq("status", "PENDING")
            .select("*")
            .maybeSingle();

        if (error) {
            await dbError("withdrawal reject", error);
            throw new Error("Could not reject withdrawal");
        }

        if (!data) throw new Error("Withdrawal was already processed");

        await changeBalance({
            playerId: transaction.player_id,
            amount,
            type: "withdrawal_reversal",
            description: `Withdrawal rejected ${requestId}`,
            roundId: requestId
        });

        await sendAdminGroupAudit(
            `WITHDRAWAL REJECTED\nRequest: ${requestId}\nAmount returned: ${amount} ETB\nBalance before return: ${before} ETB`
        );

        return "REJECTED";
    }

    if (action === "completed") {
        if (transaction.status !== "APPROVED") {
            throw new Error("COMPLETED is allowed only after ACCEPT");
        }

        const { data, error } = await supabase
            .from("transactions")
            .update({ status: "COMPLETED" })
            .eq("id", requestId)
            .eq("status", "APPROVED")
            .select("*")
            .maybeSingle();

        if (error) {
            await dbError("withdrawal completed", error);
            throw new Error("Could not complete withdrawal");
        }

        if (!data) throw new Error("Withdrawal was already processed");

        await sendAdminGroupAudit(
            `WITHDRAWAL COMPLETED\nRequest: ${requestId}\nAmount: ${transaction.amount} ETB`
        );

        return "COMPLETED";
    }

    throw new Error("Unknown withdrawal action");
}

app.post(
    "/api/admin/telegram/webhook",
    async (req, res) => {
        try {
            if (TELEGRAM_WEBHOOK_SECRET) {
                const supplied = String(
                    req.headers["x-telegram-bot-api-secret-token"] ||
                    ""
                );

                if (supplied !== TELEGRAM_WEBHOOK_SECRET) {
                    return res.status(401).json({ success: false, error: "Unauthorized" });
                }
            }

            const message = req.body?.message;
            const contact = message?.contact;

            if (contact) {
                const fromId = String(message?.from?.id || "");
                const contactUserId = String(contact.user_id || "");

                /* Accept only a contact shared by the same Telegram user. */
                if (fromId && contactUserId && fromId === contactUserId) {
                    const stored = storeRegistrationContact(
                        fromId,
                        contact.phone_number
                    );

                    if (stored) {
                        console.log(
                            `[REGISTRATION] Telegram phone received for ${fromId}`
                        );
                    }
                }

                return res.json({ success: true });
            }

            const callback = req.body?.callback_query;
            if (!callback) return res.json({ success: true });

            const fromId = String(callback.from?.id || "");
            if (!ADMIN_TELEGRAM_ID || fromId !== ADMIN_TELEGRAM_ID) {
                await telegramApi("answerCallbackQuery", {
                    callback_query_id: callback.id,
                    text: "Not authorized",
                    show_alert: true
                });
                return res.json({ success: true });
            }

            const resetMatch = String(callback.data || "").match(/^dpr:(approve|reject):(.+)$/);

            if (resetMatch) {
                const resetResult = await processPasswordResetAction(resetMatch[1], resetMatch[2]);
                await telegramApi("answerCallbackQuery", { callback_query_id: callback.id, text: resetResult, show_alert: false });
                if (callback.message?.chat?.id && callback.message?.message_id) {
                    await telegramApi("editMessageReplyMarkup", { chat_id: callback.message.chat.id, message_id: callback.message.message_id, reply_markup: { inline_keyboard: [] } });
                }
                return res.json({ success: true, result: resetResult });
            }

            const match = String(callback.data || "").match(/^dpw:(accept|reject|completed):(.+)$/);
            if (!match) return res.json({ success: true });

            const action = match[1];
            const requestId = match[2];

            const result = await processWithdrawalAction(action, requestId);

            await telegramApi("answerCallbackQuery", {
                callback_query_id: callback.id,
                text: result,
                show_alert: false
            });

            if (callback.message?.chat?.id && callback.message?.message_id) {
                await telegramApi("editMessageReplyMarkup", {
                    chat_id: callback.message.chat.id,
                    message_id: callback.message.message_id,
                    reply_markup: { inline_keyboard: [] }
                });
            }

            return res.json({ success: true, result });
        } catch (error) {
            console.error("Telegram withdrawal webhook error:", error);

            if (req.body?.callback_query?.id) {
                await telegramApi("answerCallbackQuery", {
                    callback_query_id: req.body.callback_query.id,
                    text: error.message || "Action failed",
                    show_alert: true
                });
            }

            return res.status(400).json({
                success: false,
                error: error.message || "Telegram action failed"
            });
        }
    }
);

/*
|--------------------------------------------------------------------------
| EDITION 7 — TRANSACTION HISTORY
|--------------------------------------------------------------------------
*/

app.get(
    "/api/wallet",
    requirePlayer,
    async (req, res) => {
        try {
            const { data, error } = await supabase
                .from("transactions")
                .select("*")
                .eq("player_id", req.player.id)
                .order("created_at", { ascending: false })
                .limit(50);

            if (error) {
                await dbError("wallet transactions", error);
                throw new Error("Could not load wallet transactions");
            }

            return res.json({
                success: true,
                balance: Number(req.player.balance || 0),
                transactions: data || []
            });
        } catch (error) {
            return res.status(500).json({
                success: false,
                error: error.message || "Could not load wallet"
            });
        }
    }
);

app.get(
    "/api/account/transactions",
    requirePlayer,
    async (req, res) => {
        try {
            const { data, error } = await supabase
                .from("transactions")
                .select("*")
                .eq("player_id", req.player.id)
                .order("created_at", { ascending: false })
                .limit(50);

            if (error) {
                await dbError("account transactions", error);
                throw new Error("Could not load transactions");
            }

            return res.json({ success: true, transactions: data || [] });
        } catch (error) {
            return res.status(500).json({
                success: false,
                error: error.message || "Could not load transactions"
            });
        }
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
            : new Set(
                (drawnNumbers || []).map(Number)
            );

    return Boolean(
        checkWinningPatterns(
            card,
            numberSet
        )
    );
}

/*
|--------------------------------------------------------------------------
| SERVER-SIDE BINGO CLAIM VERIFICATION
|--------------------------------------------------------------------------
| The client is never trusted for the Cartela combination or the winning
| pattern.  At claim time the backend rebuilds the fixed Cartela from the
| submitted Cartela number, compares it with the Cartela stored in the
| current room, and then checks that the current server-drawn numbers
| actually complete a horizontal, vertical, or diagonal line.
|--------------------------------------------------------------------------
*/
function sameBingoCartela(first, second) {
    if (!Array.isArray(first) || !Array.isArray(second)) {
        return false;
    }

    if (first.length !== second.length) {
        return false;
    }

    return first.every(
        (value, index) =>
            Number(value) === Number(second[index])
    );
}

function verifyBingoClaim(room, player, submittedCartelaNumber) {
    if (!room || !player) {
        return {
            valid: false,
            error: "Bingo player was not found"
        };
    }

    const cartelaNumber = Number(submittedCartelaNumber);

    if (
        !Number.isInteger(cartelaNumber) ||
        cartelaNumber < 1 ||
        cartelaNumber > 120
    ) {
        return {
            valid: false,
            error: "Invalid Cartela number"
        };
    }

    if (
        Number(player.cartelaNumber) !==
        cartelaNumber
    ) {
        return {
            valid: false,
            error: "Cartela number does not match your entry"
        };
    }

    let canonicalCartela;

    try {
        canonicalCartela = getBingoCartela(cartelaNumber);
    } catch (error) {
        return {
            valid: false,
            error: "Could not verify Cartela combination"
        };
    }

    if (!sameBingoCartela(player.cartela, canonicalCartela)) {
        return {
            valid: false,
            error: "Cartela combination does not match the server"
        };
    }

    if (!Array.isArray(room.drawnNumbers) || room.drawnNumbers.length === 0) {
        return {
            valid: false,
            error: "No Bingo numbers have been drawn yet"
        };
    }

    if (!isWinningBingoCard(canonicalCartela, room.drawnNumbers)) {
        return {
            valid: false,
            error: "BINGO is not valid for the current drawn numbers"
        };
    }

    return {
        valid: true,
        cartela: canonicalCartela,
        cartelaNumber
    };
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

            winners:
                (room.winners || []).map(player => ({
                    playerId: player.playerId,
                    telegramName: player.telegramName,
                    cartelaNumber: player.cartelaNumber
                })),

            claimWindowOpen:
                Boolean(room.claimWindowOpen),

            claimWindowEndsAt:
                Number(room.claimWindowEndsAt || 0),

            totalPool:
                room.totalPool,

            roundNumber:
                Number(room.roundNumber || 1),

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

async function seedBingoRoundCounter(tier) {
    try {
        const { data, error } = await supabase
            .from("game_rounds")
            .select("engine_state, updated_at")
            .eq("game", "bingo")
            .eq("tier_id", Number(tier))
            .order("updated_at", { ascending: false })
            .limit(1)
            .maybeSingle();

        if (!error && data) {
            const saved = Number(
                data.engine_state?.roundNumber ||
                0
            );

            if (Number.isFinite(saved) && saved > 0) {
                bingoRoundCounters[Number(tier)] = Math.max(
                    Number(bingoRoundCounters[Number(tier)] || 0),
                    Math.floor(saved)
                );
            }
        }
    } catch (error) {
        console.warn(
            `[BINGO ${tier}] Could not restore round counter:`,
            error.message
        );
    }
}

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

        winnerPrize: 0,

        roundNumber: (bingoRoundCounters[entryFee] =
            Number(bingoRoundCounters[entryFee] || 0) + 1)
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
        room.status !== "DRAWING" ||
        room.claimWindowOpen
    ) {
        return;
    }

    if (
        room.drawIndex >=
        room.secretDraw.length
    ) {
        resolveBingoWinner(tier, []);

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

    /*
    |--------------------------------------------------------------
    | A completed pattern does NOT automatically win the round.
    | The player must press the BINGO button.
    |--------------------------------------------------------------
    */

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
    winners = []
) {
    const room = bingoRooms[tier];

    if (!room || room.status === "FINISHED") {
        return;
    }

    room.status = "FINISHED";
    room.claimWindowOpen = false;
    room.claimWindowEndsAt = 0;

    const validWinners = Array.isArray(winners)
        ? winners.filter(Boolean)
        : [];

    const grossPool =
        room.players.length * room.entryFee;

    /* 10% house edge, 90% shared by valid BINGO claimants. */
    const houseRake = grossPool * 0.10;
    const winnerPool = grossPool - houseRake;
    const share = validWinners.length > 0
        ? winnerPool / validWinners.length
        : 0;

    room.totalPool = grossPool;
    room.houseRake = houseRake;
    room.winnerPrize = share;
    room.winners = validWinners;
    room.winner = validWinners[0] || null;

    for (const winningPlayer of validWinners) {
        try {
            await changeBalance({
                playerId: winningPlayer.playerId,
                amount: share,
                type: "bingo_win",
                game: "bingo",
                roundId: room.id,
                description: `Bingo prize - tier ${tier}`,
                metadata: {
                    tier,
                    grossPool,
                    houseRake,
                    winnerPool,
                    winnersCount: validWinners.length,
                    winnerShare: share,
                    cartelaNumber: winningPlayer.cartelaNumber
                }
            });

            console.log(
                `[BINGO ${tier}] WINNER ${winningPlayer.playerId} -> ${share} ETB (${validWinners.length} winner(s))`
            );
        } catch (error) {
            console.error(
                `[BINGO ${tier}] PAYOUT ERROR for ${winningPlayer.playerId}:`,
                error
            );
        }
    }

    if (!validWinners.length) {
        console.log(`[BINGO ${tier}] No BINGO claim - round complete`);
    }

    await saveBingoRound(tier).catch(console.error);

    setTimeout(() => {
        startNewBingoRound(tier);
    }, NEXT_ROUND_DELAY);
}

/*
|--------------------------------------------------------------------------
| BINGO CLAIM
|--------------------------------------------------------------------------
| A valid horizontal, vertical, or diagonal pattern is required.
| The first valid claim opens a very short server-side claim window so
| simultaneous valid BINGO claims share the 90% winner pool equally.
|--------------------------------------------------------------------------
*/
app.post(
    "/api/bingo/claim",
    requirePlayer,
    async (req, res) => {
        try {
            const tier = Number(req.body?.tier);
            const cartelaNumber = Number(req.body?.cartelaNumber);
            const submittedRoundId = String(req.body?.roundId || "").trim();

            if (!Number.isInteger(tier)) {
                return res.status(400).json({
                    success: false,
                    error: "Invalid bingo tier"
                });
            }

            const room = bingoRooms[tier];
            if (!room) {
                return res.status(400).json({
                    success: false,
                    error: "Bingo room not found"
                });
            }

            if (!submittedRoundId || submittedRoundId !== String(room.id)) {
                return res.status(400).json({
                    success: false,
                    error: "This Bingo round is no longer active"
                });
            }

            if (room.status !== "DRAWING" && !room.claimWindowOpen) {
                return res.status(400).json({
                    success: false,
                    error: "Bingo claiming is closed"
                });
            }

            const player = room.players.find(
                p => p.playerId === req.player.id &&
                     Number(p.cartelaNumber) === cartelaNumber
            );

            if (!player) {
                return res.status(400).json({
                    success: false,
                    error: "You are not playing this cartela in the current round"
                });
            }

            /*
            |----------------------------------------------------------
            | NEVER TRUST THE CLIENT
            |----------------------------------------------------------
            | The backend verifies all three pieces independently:
            |   1. Cartela number belongs to this player/round.
            |   2. Cartela combination exactly matches the fixed server
            |      combination for that Cartela number.
            |   3. The server's drawn numbers currently produce a real
            |      horizontal, vertical, or diagonal winning pattern.
            |----------------------------------------------------------
            */
            const verification = verifyBingoClaim(
                room,
                player,
                cartelaNumber
            );

            if (!verification.valid) {
                return res.status(400).json({
                    success: false,
                    winner: false,
                    error: verification.error
                });
            }

            room.claimedPlayers = room.claimedPlayers || [];
            const alreadyClaimed = room.claimedPlayers.some(
                p => p.playerId === player.playerId &&
                     Number(p.cartelaNumber) === Number(player.cartelaNumber)
            );

            if (alreadyClaimed) {
                return res.status(400).json({
                    success: false,
                    error: "BINGO already claimed"
                });
            }

            room.claimedPlayers.push({
                ...player,
                cartela: verification.cartela,
                cartelaNumber: verification.cartelaNumber
            });

            /* Keep the round open briefly to collect simultaneous valid claims. */
            if (!room.claimWindowOpen) {
                room.claimWindowOpen = true;
                room.claimWindowEndsAt = Date.now() + 1500;

                setTimeout(async () => {
                    const current = bingoRooms[tier];
                    if (!current || current.id !== room.id || !current.claimWindowOpen) {
                        return;
                    }
                    await resolveBingoWinner(
                        tier,
                        current.claimedPlayers || []
                    );
                }, 1500);
            }

            await saveBingoRound(tier).catch(console.error);

            const grossPool = room.players.length * room.entryFee;
            const winnerPool = grossPool * 0.90;
            const count = room.claimedPlayers.length;
            const estimatedShare = winnerPool / count;

            return res.json({
                success: true,
                winner: true,
                pending: true,
                roundId: room.id,
                winnersCount: count,
                estimatedPrize: estimatedShare,
                claimWindowEndsAt: room.claimWindowEndsAt,
                message: "Valid BINGO! Your claim is registered."
            });
        } catch (error) {
            console.error("Bingo claim error:", error);
            return res.status(400).json({
                success: false,
                error: error.message || "Could not claim BINGO"
            });
        }
    }
);

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

        roundNumber:
            Number(room.roundNumber || 1),

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

        totalDraws: 75,

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

        winnersCount:
            (room.winners || []).length,

        claimWindowOpen:
            Boolean(room.claimWindowOpen),

        claimWindowEndsAt:
            Number(room.claimWindowEndsAt || 0),

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
                round.currentNumber,

            roundNumber:
                Number(round.roundNumber || 1),

            bets:
                round.bets || [],

            rouletteSettled:
                Boolean(round.rouletteSettled)
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

        roundNumber:
            Number(round.roundNumber || 1),

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

        totalDraws:
            gameName === "keno" ? 20 : 0,

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

        multiplier: 1.00,

        roundNumber: ++roundCounters[gameName]
    };

    if (gameName === "roulette") {
        round.bets = [];
    }

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
| ROULETTE BET SETTLEMENT
|--------------------------------------------------------------------------
*/

async function settleRouletteRound(round) {
    if (!round || round.rouletteSettled || !Array.isArray(round.bets)) return;

    const result = Number(round.result);
    if (!Number.isInteger(result) || result < 0 || result > 36) return;

    const redNumbers = [
        1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36
    ];
    const resultColor = result === 0
        ? "green"
        : (redNumbers.includes(result) ? "red" : "black");

    for (const bet of round.bets) {
        if (bet.settled) continue;

        const amount = Number(bet.amount);
        let payout = 0;

        if (Number.isFinite(amount) && amount > 0) {
            if (bet.betType === "number" && Number(bet.number) === result) {
                payout = amount * 36;
            } else if (bet.betType === "color" && String(bet.color).toLowerCase() === resultColor) {
                payout = amount * 2;
            }
        }

        if (payout > 0) {
            if (String(bet.currency || "cash") === "bonus") {
                await writeBonusTransaction({
                    playerId: bet.playerId,
                    points: payout,
                    type: "bonus_win",
                    description: JSON.stringify({
                        game:"roulette",
                        betId:bet.betId,
                        result,
                        resultColor,
                        payout
                    }),
                    referenceId: round.id
                });
            } else {
                await changeBalance({
                    playerId: bet.playerId,
                    amount: payout,
                    type: "roulette_win",
                    game: "roulette",
                    roundId: round.id,
                    description: "Roulette winning payout",
                    metadata: {
                        betId: bet.betId,
                        slot: bet.slot,
                        result,
                        resultColor,
                        payout
                    }
                });
            }
        }

        bet.payout = payout;
        bet.settled = true;
    }

    round.rouletteSettled = true;
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

    if (!round || round.id !== roundId ||
        (round.status !== "BETTING" && round.status !== "SPINNING")) {
        return;
    }

    if (round.status === "BETTING") {
        round.status = "SPINNING";
    }

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

                await settleRouletteRound(current);

                current.status =
                    "FINISHED";

                console.log(
                    `[ROULETTE] RESULT ${current.result}`
                );

                await saveRound(
                    current
                );

                await settleRouletteRound(current);

                await saveRound(current);

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
            const previousState = data.engine_state || {};
            roundCounters[gameName] = Math.max(
                Number(roundCounters[gameName] || 0),
                Number(previousState.roundNumber || 0)
            );

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
                ),

            roundNumber:
                Math.max(1, Number(state.roundNumber || 1))
        };

        roundCounters[gameName] = Math.max(
            Number(roundCounters[gameName] || 0),
            Number(round.roundNumber || 1)
        );

        if (gameName === "roulette") {
            round.bets = Array.isArray(state.bets) ? state.bets : [];
            round.rouletteSettled = Boolean(state.rouletteSettled);
        }

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
        |--------------------------------------------------------------------------
        | AVIATOR FLYING
        |--------------------------------------------------------------------------
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
| EDITION 8 — SERVER-AUTHORITATIVE KENO BET
|--------------------------------------------------------------------------
|
| One slot, up to 10 numbers from 1–80, manual amount, minimum 10 ETB.
| The draw itself remains server-authoritative.
|--------------------------------------------------------------------------
*/

function kenoBetIsValid(amount) {
    return validateEngineBet(keno, amount);
}

app.post(
    "/api/keno/bet",
    requirePlayer,
    async (req, res) => {
        try {
            const round = rounds.keno;
            const amount = Number(req.body.amount);
            const rawNumbers = Array.isArray(req.body.numbers)
                ? req.body.numbers
                : [];

            const numbers = [...new Set(
                rawNumbers.map(Number)
            )];

            if (!round || round.status !== "BETTING") {
                return res.status(400).json({
                    success: false,
                    error: "Keno betting is closed"
                });
            }

            if (!Number.isFinite(amount) || amount < 10) {
                return res.status(400).json({
                    success: false,
                    error: "Minimum Keno bet is 10 ETB"
                });
            }

            try {
                kenoBetIsValid(amount);
            } catch (error) {
                return res.status(400).json({
                    success: false,
                    error: error.message || "Invalid Keno bet amount"
                });
            }

            if (numbers.length < 1 || numbers.length > 10) {
                return res.status(400).json({
                    success: false,
                    error: "Choose between 1 and 10 Keno numbers"
                });
            }

            if (numbers.some(n => !Number.isInteger(n) || n < 1 || n > 80)) {
                return res.status(400).json({
                    success: false,
                    error: "Keno numbers must be between 1 and 80"
                });
            }

            const currentBalance = Number(req.player.balance || 0);
            if (amount > currentBalance) {
                return res.status(400).json({
                    success: false,
                    error: "Insufficient balance"
                });
            }

            if (!Array.isArray(round.bets)) round.bets = [];

            if (round.bets.some(bet => bet.playerId === req.player.id)) {
                return res.status(400).json({
                    success: false,
                    error: "You already placed a Keno bet for this round"
                });
            }

            const betId = makeId("KENOBET");

            const balanceAfter = await changeBalance({
                playerId: req.player.id,
                amount: -amount,
                type: "keno_bet",
                game: "keno",
                roundId: round.id,
                description: "Keno bet",
                metadata: {
                    betId,
                    numbers
                }
            });

            round.bets.push({
                betId,
                playerId: req.player.id,
                numbers,
                amount,
                placedAt: Date.now(),
                cashedOut: false
            });

            await saveRound(round);

            return res.json({
                success: true,
                betId,
                roundId: round.id,
                numbers,
                amount,
                balanceAfter,
                bettingEndsAt: round.bettingEndsAt,
                remainingMilliseconds: Math.max(0, round.bettingEndsAt - Date.now())
            });
        } catch (error) {
            console.error("Keno bet error:", error);
            return res.status(500).json({
                success: false,
                error: error.message || "Could not place Keno bet"
            });
        }
    }
);

/*
|--------------------------------------------------------------------------
| EDITION 8 — SERVER-AUTHORITATIVE ROULETTE BET
|--------------------------------------------------------------------------
*/

function rouletteBetIsValid(amount) {
    return validateEngineBet(roulette, amount);
}

app.post(
    "/api/roulette/bet",
    requirePlayer,
    async (req, res) => {
        try {
            const round = rounds.roulette;
            const slot = Number(req.body.slot || 1);
            const amount = Number(req.body.amount);
            const betType = String(req.body.betType || "").toLowerCase();
            const number = req.body.number == null ? null : Number(req.body.number);
            const color = req.body.color == null ? null : String(req.body.color).toLowerCase();

            if (!round || round.status !== "BETTING") {
                return res.status(400).json({ success:false, error:"Roulette betting is closed" });
            }
            if (![1,2].includes(slot)) {
                return res.status(400).json({ success:false, error:"Invalid roulette slot" });
            }
            try { rouletteBetIsValid(amount); }
            catch (error) {
                return res.status(400).json({ success:false, error:error.message || "Invalid Roulette bet amount" });
            }
            if (!Number.isFinite(amount) || amount < 10) {
                return res.status(400).json({ success:false, error:"Minimum Roulette bet is 10 ETB" });
            }

            if (betType === "number") {
                if (!Number.isInteger(number) || number < 0 || number > 36) {
                    return res.status(400).json({ success:false, error:"Roulette number must be 0–36" });
                }
            } else if (betType === "color") {
                if (!["red","black","green"].includes(color)) {
                    return res.status(400).json({ success:false, error:"Choose red, black, or green" });
                }
            } else {
                return res.status(400).json({ success:false, error:"Choose a roulette number or color" });
            }

            if (!Array.isArray(round.bets)) round.bets = [];
            if (round.bets.some(b => b.playerId === req.player.id && Number(b.slot) === slot)) {
                return res.status(400).json({ success:false, error:"This roulette slot already has a bet for this round" });
            }

            const currency = String(req.body.currency || "cash").toLowerCase() === "bonus" ? "bonus" : "cash";
            let balanceAfter = Number(req.player.balance || 0);
            let bonusPointsAfter = await getBonusPoints(req.player.id);

            if (currency === "bonus") {
                if (amount > bonusPointsAfter) {
                    return res.status(400).json({ success:false, error:"Insufficient bonus points" });
                }
                await writeBonusTransaction({
                    playerId:req.player.id,
                    points:-amount,
                    type:"bonus_play",
                    game:"roulette",
                    roundId:round.id,
                    description:"Roulette bonus-point bet"
                });
                bonusPointsAfter = Number((bonusPointsAfter - amount).toFixed(2));
            } else {
                const currentBalance = Number(req.player.balance || 0);
                if (amount > currentBalance) {
                    return res.status(400).json({ success:false, error:"Insufficient balance" });
                }
                balanceAfter = await changeBalance({
                    playerId:req.player.id,
                    amount:-amount,
                    type:"roulette_bet",
                    game:"roulette",
                    roundId:round.id,
                    description:"Roulette bet",
                    metadata:{ betId:"pending", slot, betType, number, color, currency }
                });
            }

            const betId = makeId("ROUBET");

            round.bets.push({
                betId,
                playerId:req.player.id,
                slot,
                amount,
                currency,
                betType,
                number:betType === "number" ? number : null,
                color:betType === "color" ? color : null,
                placedAt:Date.now(),
                settled:false,
                payout:0
            });

            await saveRound(round);

            return res.json({
                success:true,
                betId,
                roundId:round.id,
                slot,
                amount,
                currency,
                betType,
                number,
                color,
                balanceAfter,
                bonusPointsAfter,
                bettingEndsAt:round.bettingEndsAt,
                remainingMilliseconds:Math.max(0, round.bettingEndsAt - Date.now())
            });
        } catch (error) {
            console.error("Roulette bet error:", error);
            return res.status(500).json({ success:false, error:error.message || "Could not place Roulette bet" });
        }
    }
);

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
                    "id,round_id,game,status,result,drawn_numbers,current_number,multiplier,crash_point,engine_state,created_at,updated_at"
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

/*
|--------------------------------------------------------------------------
| AVIATOR BETS WITH OPTIONAL BONUS POINTS
|--------------------------------------------------------------------------
*/
app.post("/api/aviator/bet", requirePlayer, async (req, res) => {
    try {
        const round = rounds.aviator;
        const slot = Number(req.body.slot || 1);
        const amount = Number(req.body.amount);
        const currency = String(req.body.currency || "cash").toLowerCase() === "bonus" ? "bonus" : "cash";
        if (!round || round.status !== "BETTING") return res.status(400).json({success:false,error:"Aviator betting is closed"});
        if (![1,2].includes(slot)) return res.status(400).json({success:false,error:"Invalid Aviator slot"});
        if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({success:false,error:"Invalid Aviator amount"});
        if (!Array.isArray(round.bets)) round.bets=[];
        if (round.bets.some(b => b.playerId === req.player.id && Number(b.slot) === slot)) return res.status(400).json({success:false,error:"This Aviator slot already has a bet for this round"});

        let balanceAfter = Number(req.player.balance || 0);
        let bonusPointsAfter = await getBonusPoints(req.player.id);
        if (currency === "bonus") {
            if (amount > bonusPointsAfter) return res.status(400).json({success:false,error:"Insufficient bonus points"});
            await writeBonusTransaction({playerId:req.player.id,points:-amount,type:"bonus_play",description:JSON.stringify({game:"aviator",slot,amount}),referenceId:round.id});
            bonusPointsAfter=Number((bonusPointsAfter-amount).toFixed(2));
        } else {
            if (amount > balanceAfter) return res.status(400).json({success:false,error:"Insufficient balance"});
            balanceAfter=await changeBalance({playerId:req.player.id,amount:-amount,type:"aviator_bet",game:"aviator",roundId:round.id,description:"Aviator bet",metadata:{slot,amount,currency}});
        }

        const betId=makeId("AVIBET");
        round.bets.push({betId,playerId:req.player.id,slot,amount,currency,placedAt:Date.now(),cashedOut:false,cashout:null,payout:0});
        await saveRound(round);
        return res.json({success:true,betId,roundId:round.id,slot,amount,currency,balanceAfter,bonusPointsAfter});
    } catch(error) {
        console.error("Aviator bet error:",error);
        return res.status(500).json({success:false,error:error.message || "Could not place Aviator bet"});
    }
});

app.post("/api/aviator/cashout", requirePlayer, async (req, res) => {
    try {
        const round=rounds.aviator;
        const slot=Number(req.body.slot || 1);
        if (!round || !["FLYING"].includes(round.status)) return res.status(400).json({success:false,error:"Aviator flight is not active"});
        const bet=Array.isArray(round.bets) ? round.bets.find(b => b.playerId===req.player.id && Number(b.slot)===slot && !b.cashedOut) : null;
        if (!bet) return res.status(400).json({success:false,error:"No active Aviator bet"});
        const multiplier=Number(round.multiplier);
        if (!Number.isFinite(multiplier) || multiplier < 1) return res.status(400).json({success:false,error:"Invalid flight multiplier"});
        const payout=Number((Number(bet.amount)*multiplier).toFixed(2));
        bet.cashedOut=true; bet.cashout=multiplier; bet.payout=payout;
        let balanceAfter=Number(req.player.balance || 0);
        let bonusPointsAfter=await getBonusPoints(req.player.id);
        if (String(bet.currency)==="bonus") {
            await writeBonusTransaction({playerId:req.player.id,points:payout,type:"bonus_win",description:JSON.stringify({game:"aviator",betId:bet.betId,slot,multiplier,payout}),referenceId:round.id});
            bonusPointsAfter=Number((bonusPointsAfter+payout).toFixed(2));
        } else {
            balanceAfter=await changeBalance({playerId:req.player.id,amount:payout,type:"aviator_win",game:"aviator",roundId:round.id,description:"Aviator cash-out",metadata:{betId:bet.betId,slot,multiplier,payout}});
        }
        await saveRound(round);
        return res.json({success:true,payout,multiplier,currency:bet.currency,balanceAfter,bonusPointsAfter});
    } catch(error) {
        console.error("Aviator cashout error:",error);
        return res.status(500).json({success:false,error:error.message || "Could not cash out Aviator bet"});
    }
});

app.get(
    "/api/game/:game/round",
    requirePlayer,
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
            gameName === "bingo" ||
            gameName === "bingo75" ||
            gameName === "bingo90"
        ) {
            const requestedStake = editionStakeIsValid(req.query.stake);
            const tier = requestedStake || EDITION_STAKES.find(n => bingoRooms[n]);

            if (!tier || !bingoRooms[tier]) {
                return res.status(503).json({
                    success:false,
                    error:"Bingo round is not ready"
                });
            }

            const variant = gameName === "bingo90" ? "bingo90" : "bingo75";
            const round = getPublicBingoRound(tier);
            round.variant = variant;
            round.stake = tier;
            round.totalDraws = variant === "bingo90" ? 90 : 75;

            /* The compact baseline has a verified 75-ball cartela engine.
             * Do not fabricate a 90-ball ticket until bingo90.js is present. */
            if (variant === "bingo90") {
                round.cards = [];
                round.cardIds = [];
            } else {
                const cards = [0,1].map(i => {
                    const number = editionCartelaNumber(req.player.id, i);
                    return getBingoCartela(number);
                });
                round.cards = cards;
                round.cardIds = [0,1].map(i =>
                    `cartela-${editionCartelaNumber(req.player.id,i)}`
                );
            }

            return res.json({
                success:true,
                serverTime:Date.now(),
                serverTimeIso:nowIso(),
                round
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
| COMPACT PROJECT ROOT
|--------------------------------------------------------------------------
| index.html, server.js and games/ live at the project root.
|--------------------------------------------------------------------------
*/

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "index.html"));
});

/*
|--------------------------------------------------------------------------
| PVP ARENA API
|--------------------------------------------------------------------------
| Additive only. Existing account, payment, withdrawal, invitation and
| voice endpoints above remain untouched.
|--------------------------------------------------------------------------
*/
app.get("/api/pvp/games", requirePlayer, (req, res) => {
    const games = PVP_GAME_ORDER.map(id => {
        const cfg = PVP_GAMES[id];
        return cfg ? { id, ...cfg, available:true } : {
            id,
            name:id,
            minPlayers:2,
            maxPlayers:4,
            available:false
        };
    });
    res.json({ success:true, games });
});

app.get("/api/pvp/rooms", requirePlayer, (req, res) => {
    try {
        const game=String(req.query.game || "").trim().toLowerCase();
        const fee=pvpEntryFee(req.query.entryFee || 10);
        if (!PVP_GAMES[game]) return res.status(400).json({success:false,error:"Unsupported PVP game"});
        const room=pvpGetOrCreateRoom(game,fee);
        res.json({success:true,room:pvpPublicRoom(room)});
    } catch(error) {
        res.status(400).json({success:false,error:error.message});
    }
});

app.post("/api/pvp/join", requirePlayer, async (req, res) => {
    try {
        const game=String(req.body.game || "").trim().toLowerCase();
        const fee=pvpEntryFee(req.body.entryFee || 10);
        if (!PVP_GAMES[game]) return res.status(400).json({success:false,error:"Unsupported PVP game"});
        if (pvpPlayerRooms.has(req.player.id)) return res.status(409).json({success:false,error:"You are already in a PVP room"});

        const room=pvpGetOrCreateRoom(game,fee);
        if (room.status !== "BETTING") return res.status(409).json({success:false,error:"Room is no longer accepting players"});
        if (room.players.has(req.player.id)) return res.json({success:true,room:pvpPublicRoom(room),alreadyJoined:true});
        if (room.players.size >= room.maxPlayers) return res.status(409).json({success:false,error:"Room is full"});

        await pvpDebitPlayer(req.player.id,room);
        room.players.set(req.player.id,{ playerId:String(req.player.id), telegramName:String(req.player.username || req.player.telegram_username || "Player"), joinedAt:Date.now(), score:0, actionLocked:false, actionData:{} });
        // Rebuild the authoritative state whenever a participant joins so the server
        // assigns turns/roles/chances from the actual participant list.
        const previousAuthority = room.state?.authority;
        const existingEngineState = room.state?.engineState || {};
        room.state = PVP_AUTHORITY.createAuthorityState(room, existingEngineState);
        if (previousAuthority?.serverSeed) room.state.authority.serverSeed = previousAuthority.serverSeed;
        pvpPlayerRooms.set(req.player.id,room.roomId);
        await pvpPersistPlayer(room, room.players.get(req.player.id));
        await pvpPersistRoom(room);

        if (room.players.size >= room.maxPlayers) pvpStartRoomIfReady(room);
        res.json({success:true,room:{...pvpPublicRoom(room),authority:PVP_AUTHORITY.publicAuthorityState(room, req.player.id)},balance:Number(req.player.balance || 0)-room.entryFee});
    } catch(error) {
        res.status(400).json({success:false,error:error.message});
    }
});

app.post("/api/pvp/action", requirePlayer, async (req, res) => {
    try {
        const roomId = String(req.body.roomId || "");
        const room = [...pvpRooms.values()].find(r => r.roomId === roomId);
        if (!room) return res.status(404).json({success:false,error:"PVP room not found"});
        const player = room.players.get(req.player.id);
        if (!player) return res.status(403).json({success:false,error:"You are not in this room"});
        if (!["BETTING","READY","PLAYING"].includes(room.status)) return res.status(409).json({success:false,error:"This round is no longer accepting actions"});

        const engine = PVP_ENGINE_REGISTRY[room.game];
        if (!engine || typeof engine.validateAction !== "function") throw new Error("PVP engine unavailable");
        const rawAction = req.body.actionData || {};
        if (!rawAction || typeof rawAction !== "object" || Array.isArray(rawAction)) {
            throw new Error("Invalid PVP action");
        }
        let authorityResult = null;

        if (room.state?.version === 2) {
            authorityResult = PVP_AUTHORITY.applyAction(room, req.player.id, rawAction);
        }

        if (authorityResult?.engineAction) {
            const action = engine.validateAction(rawAction, room.state?.engineState || room.state);
            if (["bingo","bingo75"].includes(room.game) && action.type === "card") {
                player.actionData = { ...(player.actionData || {}), ...action };
                player.actionLocked = false;
            } else if (["tambola","bingo90"].includes(room.game) && action.type === "ticket") {
                player.actionData = { ...(player.actionData || {}), ...action };
                player.actionLocked = false;
            } else if (["bingo","bingo75","tambola","bingo90"].includes(room.game) && action.type === "claim") {
                if (!player.actionData?.numbers || !Array.isArray(player.actionData.numbers)) throw new Error("Submit your card or ticket first");
                player.actionData = { ...(player.actionData || {}), ...action };
                player.actionLocked = true;
            } else {
                player.actionData = action;
                player.actionLocked = true;
            }
        }

        try {
            if (room.dbRoomId) await supabase.from("pvp_actions").insert({
                room_id:room.dbRoomId,
                round_id:room.roundId,
                player_id:String(req.player.id),
                action_type:String(rawAction.type||"action"),
                action_payload:rawAction,
                accepted:true
            });
        } catch (error) { console.error("[PVP] Action persistence warning:", error.message); }

        const authorityFinished = room.state?.authority?.phase === "FINISHED";
        const allSubmitted = [...room.players.values()].every(p => p.actionLocked);
        if (authorityFinished) {
            const winnerIds = room.state.authority.winners || [];
            await pvpSettleRoom(room, winnerIds, {
                scores:room.state.authority.scores,
                authoritativeHistory:room.state.authority.history,
                authorityVersion:2
            });
        } else if (allSubmitted && ["bingo","bingo75","tambola","bingo90","numberdraw","wheel","highcard","dice","target"].includes(room.game)) {
            await pvpResolveRoom(room);
        } else {
            room.status = "PLAYING";
            await pvpPersistRoom(room);
        }

        const publicAuthority = room.state?.version === 2 ? PVP_AUTHORITY.publicAuthorityState(room, req.player.id) : null;
        res.json({success:true,room:{...pvpPublicRoom(room),authority:publicAuthority},result:room.result||null});
    } catch(error) {
        res.status(400).json({success:false,error:error.message || "Action rejected"});
    }
});

app.post("/api/pvp/leave", requirePlayer, async (req, res) => {
    try {
        const roomId=String(req.body.roomId || "");
        const room=[...pvpRooms.values()].find(r=>r.roomId===roomId);
        if (!room) return res.json({success:true});
        if (room.status !== "BETTING") return res.status(409).json({success:false,error:"You cannot leave after the round starts"});
        const player=room.players.get(req.player.id);
        if (!player) return res.json({success:true});
        room.players.delete(req.player.id);
        pvpPlayerRooms.delete(req.player.id);
        await changeBalance({ playerId:req.player.id, amount:room.entryFee, type:"pvp_refund", game:room.game, roundId:`${room.roundId}:leave`, description:"PVP leave refund", metadata:{roomId:room.roomId} });
        res.json({success:true,room:pvpPublicRoom(room)});
    } catch(error) {
        res.status(400).json({success:false,error:error.message});
    }
});

app.get("/api/pvp/room/:roomId", requirePlayer, (req,res)=>{
    const room=[...pvpRooms.values()].find(r=>r.roomId===String(req.params.roomId));
    if(!room) return res.status(404).json({success:false,error:"PVP room not found"});
    const player=room.players.get(req.player.id);
    res.json({success:true,room:{...pvpPublicRoom(room),authority:PVP_AUTHORITY.publicAuthorityState(room, req.player.id)},joined:Boolean(player),result:room.result||null});
});

/*
|--------------------------------------------------------------------------
| BOOT
|--------------------------------------------------------------------------
*/

/*
|--------------------------------------------------------------------------
| DESTA PLAY PLAYER-FLOW EDITION API
|--------------------------------------------------------------------------
|
| Frontend contract:
|   POST /api/game/bingo/bet
|   POST /api/game/bingo75/bet
|   POST /api/game/bingo90/bet
|   POST /api/game/bingo/bingo-claim
|   POST /api/game/bingo75/bingo-claim
|   POST /api/game/bingo90/bingo-claim
|   POST /api/game/keno/bet
|
| The server remains authoritative. Authentication is required.
| These adapters reuse the existing permanent-account/ledger layer.
|--------------------------------------------------------------------------
*/

const EDITION_STAKES = [
    10,20,30,40,50,60,70,80,90,100,
    150,200,250,300,350,400,450,500,
    550,600,650,700,750,800,850,900,950,1000
];

function editionStakeIsValid(value) {
    const n = Number(value);
    return EDITION_STAKES.includes(n) ? n : null;
}

function editionBingoVariant(gameName) {
    if (gameName === "bingo90") return "bingo90";
    return "bingo75";
}

function editionCartelaNumber(playerId, cardIndex) {
    const hash = crypto
        .createHash("sha256")
        .update(`${String(playerId)}:${Number(cardIndex)}`)
        .digest();
    const value = hash.readUInt32BE(0);
    return (value % 120) + 1;
}

function editionPublicBingoCards(playerId, variant) {
    /*
     * Bingo 75 uses the fixed 120-card engine already present in the server.
     * Bingo 90 is exposed as a 3x9 ticket only when a dedicated 90-ball
     * engine is installed. The compact baseline does not silently invent
     * a second ticket generator.
     */
    if (variant === "bingo90") return [];

    return [0,1].map(index => {
        const cartelaNumber = editionCartelaNumber(playerId, index);
        return getBingoCartela(cartelaNumber);
    });
}

function editionFindBingoRoom(stake) {
    const tier = editionStakeIsValid(stake);
    if (!tier) return null;
    return bingoRooms[tier] || null;
}

/*
 * The existing generic round endpoint below is retained as the single
 * /api/game/:game/round route. The player-flow frontend should send
 * ?stake=<selected stake> so the server can return that exact room.
 */

/*
 * Edition Bingo bet. A successful request is the commitment point.
 * A player may commit up to two cartellas in the same round/stake room.
 */
app.post("/api/game/:game/bet", requirePlayer, async (req, res, next) => {
    const gameName = String(req.params.game || "").toLowerCase();

    if (gameName === "keno") {
        return next();
    }

    if (!["bingo","bingo75","bingo90"].includes(gameName)) {
        return next();
    }

    try {
        const stake = editionStakeIsValid(req.body?.stake);
        const cardIndex = Number(req.body?.cardIndex);
        const submittedRoundId = String(req.body?.roundId || "").trim();

        if (!stake) return res.status(400).json({success:false,error:"Invalid stake"});
        if (!Number.isInteger(cardIndex) || cardIndex < 0 || cardIndex > 1) {
            return res.status(400).json({success:false,error:"Invalid cartela selection"});
        }

        const room = bingoRooms[stake];
        if (!room || room.status !== "BETTING") {
            return res.status(400).json({success:false,error:"Bingo betting is closed"});
        }
        if (submittedRoundId && submittedRoundId !== String(room.id)) {
            return res.status(400).json({success:false,error:"This Bingo round is no longer active"});
        }

        const variant = editionBingoVariant(gameName);
        if (variant === "bingo90") {
            return res.status(503).json({success:false,error:"Bingo 90 engine is not installed in the current backend"});
        }

        const cartelaNumber = editionCartelaNumber(req.player.id, cardIndex);
        const cartela = getBingoCartela(cartelaNumber);

        const duplicate = room.players.some(p =>
            p.playerId === req.player.id && Number(p.cartelaNumber) === cartelaNumber
        );
        if (duplicate) return res.status(400).json({success:false,error:"This cartela is already bet"});

        const playerCartelas = room.players.filter(p => p.playerId === req.player.id);
        if (playerCartelas.length >= 2) {
            return res.status(400).json({success:false,error:"Maximum 2 cartellas per round"});
        }

        await changeBalance({
            playerId:req.player.id,
            amount:-stake,
            type:"bingo_entry",
            game:"bingo",
            roundId:room.id,
            description:`Bingo entry - stake ${stake}`,
            metadata:{stake,cartelaNumber,cardIndex,variant}
        });

        room.players.push({
            playerId:req.player.id,
            telegramName:req.player.username || "Player",
            cartelaNumber,
            cartela,
            cardIndex,
            variant
        });

        await saveBingoRound(stake);

        return res.json({
            success:true,
            roundId:room.id,
            stake,
            cardIndex,
            cartelaNumber,
            cardId:`cartela-${cartelaNumber}`,
            balanceAfter:Number(req.player.balance || 0) - stake,
            bettingEndsAt:room.bettingEndsAt,
            remainingMilliseconds:Math.max(0,room.bettingEndsAt-Date.now())
        });
    } catch (error) {
        console.error("Edition Bingo bet error:", error);
        return res.status(400).json({success:false,error:error.message || "Could not place Bingo bet"});
    }
});

/* Edition Bingo claim adapter: translates cardIndex/cardId into the
 * server-side cartela claim API without trusting client card contents. */
app.post("/api/game/:game/bingo-claim", requirePlayer, async (req, res, next) => {
    const gameName = String(req.params.game || "").toLowerCase();
    if (!["bingo","bingo75","bingo90"].includes(gameName)) return next();

    try {
        if (gameName === "bingo90") {
            return res.status(503).json({success:false,error:"Bingo 90 engine is not installed in the current backend"});
        }

        const cardIndex = Number(req.body?.cardIndex);
        const roundId = String(req.body?.roundId || "").trim();
        if (!Number.isInteger(cardIndex) || cardIndex < 0 || cardIndex > 1) {
            return res.status(400).json({success:false,error:"Invalid cartela selection"});
        }

        const cartelaNumber = editionCartelaNumber(req.player.id, cardIndex);
        const stake = EDITION_STAKES.find(t =>
            bingoRooms[t] && bingoRooms[t].id === roundId
        );
        if (!stake) return res.status(400).json({success:false,error:"Bingo round not found"});

        const room = bingoRooms[stake];
        const player = room.players.find(p =>
            p.playerId === req.player.id && Number(p.cartelaNumber) === cartelaNumber
        );
        if (!player) return res.status(400).json({success:false,error:"No accepted bet for this cartela"});

        const verification = verifyBingoClaim(room, player, cartelaNumber);
        if (!verification.valid) return res.status(400).json({success:false,winner:false,error:verification.error});

        room.claimedPlayers = room.claimedPlayers || [];
        if (room.claimedPlayers.some(p => p.playerId === req.player.id && Number(p.cartelaNumber) === cartelaNumber)) {
            return res.status(400).json({success:false,error:"BINGO already claimed"});
        }

        room.claimedPlayers.push({...player,cartela:verification.cartela,cartelaNumber});
        if (!room.claimWindowOpen) {
            room.claimWindowOpen = true;
            room.claimWindowEndsAt = Date.now() + 1500;
            setTimeout(async () => {
                const current = bingoRooms[stake];
                if (!current || current.id !== room.id || !current.claimWindowOpen) return;
                await resolveBingoWinner(stake,current.claimedPlayers || []);
            },1500);
        }
        await saveBingoRound(stake).catch(console.error);

        return res.json({
            success:true,
            winner:true,
            pending:true,
            roundId:room.id,
            winnersCount:room.claimedPlayers.length,
            claimWindowEndsAt:room.claimWindowEndsAt,
            message:"Valid BINGO! Your claim is registered."
        });
    } catch (error) {
        console.error("Edition Bingo claim error:", error);
        return res.status(400).json({success:false,error:error.message || "Could not claim BINGO"});
    }
});

/* Exact stake validation for the edition Keno endpoint. The original
 * Keno route remains available for backwards compatibility. */
app.post("/api/game/keno/bet", requirePlayer, async (req, res, next) => {
    try {
        const stake = editionStakeIsValid(req.body?.stake);
        if (!stake) return res.status(400).json({success:false,error:"Invalid stake"});

        const round = rounds.keno;
        const submittedRoundId = String(req.body?.roundId || "").trim();
        const slots = Array.isArray(req.body?.slots) ? req.body.slots : [];

        if (!round || round.status !== "BETTING") return res.status(400).json({success:false,error:"Keno betting is closed"});
        if (submittedRoundId && submittedRoundId !== String(round.id)) return res.status(400).json({success:false,error:"This Keno round is no longer active"});
        if (slots.length < 1 || slots.length > 2) return res.status(400).json({success:false,error:"Choose 1 or 2 Keno slots"});

        const normalizedSlots = slots.map(slot => [...new Set((Array.isArray(slot)?slot:[]).map(Number))]);
        if (normalizedSlots.some(s => s.length < 3 || s.length > 10)) return res.status(400).json({success:false,error:"Each Keno slot must contain 3 to 10 numbers"});
        if (normalizedSlots.some(s => s.some(n => !Number.isInteger(n) || n < 1 || n > 80))) return res.status(400).json({success:false,error:"Keno numbers must be between 1 and 80"});
        if (normalizedSlots.some(s => new Set(s).size !== s.length)) return res.status(400).json({success:false,error:"Keno numbers cannot repeat"});

        if (!Array.isArray(round.bets)) round.bets=[];
        if (round.bets.some(b => b.playerId === req.player.id)) return res.status(400).json({success:false,error:"You already placed a Keno bet for this round"});

        const balance = Number(req.player.balance || 0);
        if (stake > balance) return res.status(400).json({success:false,error:"Insufficient balance"});

        const betId = makeId("KENOBET");
        const balanceAfter = await changeBalance({
            playerId:req.player.id,
            amount:-stake,
            type:"keno_bet",
            game:"keno",
            roundId:round.id,
            description:"Keno bet",
            metadata:{betId,stake,slots:normalizedSlots}
        });

        round.bets.push({
            betId,
            playerId:req.player.id,
            numbers:normalizedSlots[0],
            slots:normalizedSlots,
            amount:stake,
            placedAt:Date.now()
        });
        await saveRound(round);

        return res.json({success:true,betId,roundId:round.id,stake,slots:normalizedSlots,balanceAfter,bettingEndsAt:round.bettingEndsAt});
    } catch (error) {
        console.error("Edition Keno bet error:",error);
        return res.status(400).json({success:false,error:error.message || "Could not place Keno bet"});
    }
});

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
            "Keno / Bingo / Roulette / Aviator / PVP Arena"
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

        /* Legacy house Bingo boot disabled: Bingo PVP is handled by /api/pvp/* and PVPAuthority. */

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
