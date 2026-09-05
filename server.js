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
app.use(express.static(path.join(__dirname, "public")));

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
            phone
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
