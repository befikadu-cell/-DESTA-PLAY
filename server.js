/*
|--------------------------------------------------------------------------
| DESTA PLAY — 24/7 CONTINUOUS BACKEND ENGINE
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
| ENVIRONMENT & SETUP
|--------------------------------------------------------------------------
*/

const PORT = Number(process.env.PORT || 10000);
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SESSION_SECRET = process.env.SESSION_SECRET;

const ADMIN_TELEGRAM_ID = String(process.env.ADMIN_TELEGRAM_ID || "").trim();
const ADMIN_PRIVATE_GROUP_ID = String(process.env.ADMIN_PRIVATE_GROUP_ID || "").trim();
const TELEGRAM_BOT_TOKEN = String(process.env.TELEGRAM_BOT_TOKEN || "").trim();
const TELEGRAM_WEBHOOK_SECRET = String(process.env.TELEGRAM_WEBHOOK_SECRET || "").trim();

const PAYMENT_OWNER_NAME = String(process.env.PAYMENT_OWNER_NAME || "TEST PAYMENT OWNER").trim();
const PAYMENT_PHONE = String(process.env.PAYMENT_PHONE || "TEST PAYMENT PHONE").trim();
const TELEBIRR_ACCOUNT = String(process.env.TELEBIRR_ACCOUNT || "TEST TELEBIRR ACCOUNT").trim();
const MIN_DEPOSIT_AMOUNT = 50;

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

/*
|--------------------------------------------------------------------------
| HELPERS & DATABASE LOOKUPS
|--------------------------------------------------------------------------
*/

function nowIso() { return new Date().toISOString(); }
function makeId(prefix = "DP") { return `${prefix}-` + Date.now() + "-" + crypto.randomBytes(4).toString("hex"); }
function makePlayerId() { return "DP-" + crypto.randomBytes(4).toString("hex").toUpperCase(); }
function normalizeTelegramName(name) { return typeof name === "string" ? name.trim().slice(0, 80) : "Player"; }
function normalizePhone(value) { return String(value || "").trim().replace(/[^0-9+]/g, "").slice(0, 32); }
function validPassword(password) { return typeof password === "string" && password.length >= 8 && password.length <= 128; }

async function dbError(context, error) {
    console.error(`[DATABASE ERROR] ${context}:`, error);
}

async function findPlayerByTelegramId(telegramId) {
    const { data, error } = await supabase.from("players").select("*").eq("telegram_id", String(telegramId)).maybeSingle();
    if (error) { await dbError("findPlayerByTelegramId", error); throw new Error("Database error"); }
    return data;
}

async function findPlayerByPhone(phone) {
    const normalized = normalizePhone(phone);
    if (!normalized) return null;
    const { data, error } = await supabase.from("players").select("*").eq("phone", normalized).maybeSingle();
    if (error) { await dbError("findPlayerByPhone", error); throw new Error("Database error"); }
    return data;
}

async function findPlayerById(playerId) {
    const { data, error } = await supabase.from("players").select("*").eq("id", playerId).maybeSingle();
    if (error) { await dbError("findPlayerById", error); throw new Error("Database error"); }
    return data;
}

function publicPlayer(player) {
    if (!player) return null;
    return {
        playerId: player.id,
        telegramId: player.telegram_id,
        phone: player.phone || null,
        telegramName: player.username || "Player",
        balance: Number(player.balance || 0),
        createdAt: player.created_at
    };
}

/*
|--------------------------------------------------------------------------
| SESSIONS & MIDDLEWARE
|--------------------------------------------------------------------------
*/

const sessions = new Map();

function createSession(player) {
    const token = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHmac("sha256", SESSION_SECRET).update(token).digest("hex");
    sessions.set(tokenHash, { playerId: player.id, createdAt: Date.now() });
    return token;
}

async function requirePlayer(req, res, next) {
    try {
        const authorization = req.headers.authorization || "";
        if (!authorization.startsWith("Bearer ")) return res.status(401).json({ success: false, error: "Unauthorized" });
        const token = authorization.slice(7).trim();
        const tokenHash = crypto.createHmac("sha256", SESSION_SECRET).update(token).digest("hex");
        const session = sessions.get(tokenHash);
        if (!session) return res.status(401).json({ success: false, error: "Unauthorized" });

        const player = await findPlayerById(session.playerId);
        if (!player) return res.status(401).json({ success: false, error: "Player not found" });

        req.player = player;
        next();
    } catch (error) {
        return res.status(401).json({ success: false, error: "Authentication failed" });
    }
}

/*
|--------------------------------------------------------------------------
| AUTHENTICATION ENDPOINTS
|--------------------------------------------------------------------------
*/

// 1. FIRST-TIME REGISTRATION (Asks for Phone Number and Password)
async function registerHandler(req, res) {
    try {
        const { telegramId, telegramName, password, phone } = req.body;

        if (!telegramId || String(telegramId).trim() === "") {
            return res.status(400).json({ success: false, error: "Missing Telegram ID" });
        }

        const normalizedPhone = normalizePhone(phone);
        if (!normalizedPhone || normalizedPhone.length < 9) {
            return res.status(400).json({ success: false, error: "Valid phone number is required" });
        }

        if (!validPassword(password)) {
            return res.status(400).json({ success: false, error: "Password must be between 8 and 128 characters" });
        }

        const existingByTelegram = await findPlayerByTelegramId(telegramId);
        if (existingByTelegram) {
            return res.status(400).json({ success: false, error: "Account already exists. Please log in." });
        }

        const existingByPhone = await findPlayerByPhone(normalizedPhone);
        if (existingByPhone) {
            return res.status(400).json({ success: false, error: "Phone number already registered." });
        }

        const passwordHash = await argon2.hash(password);
        const playerId = makePlayerId();
        const safeName = normalizeTelegramName(telegramName);

        const { data: insertedPlayer, error } = await supabase
            .from("players")
            .insert({
                id: playerId,
                telegram_id: String(telegramId),
                phone: normalizedPhone,
                username: safeName,
                password_hash: passwordHash,
                balance: 0,
                created_at: nowIso(),
                updated_at: nowIso()
            })
            .select("*")
            .single();

        if (error) {
            await dbError("Register insert", error);
            return res.status(500).json({ success: false, error: "Failed to create player account" });
        }

        const token = createSession(insertedPlayer);
        return res.json({ success: true, token, player: publicPlayer(insertedPlayer) });
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message || "Registration failed" });
    }
}

// 2. SUBSEQUENT LOGINS (Detects telegramId, asks ONLY for Password)
async function loginHandler(req, res) {
    try {
        const { telegramId, password } = req.body;

        if (!telegramId) {
            return res.status(400).json({ success: false, error: "Missing Telegram ID" });
        }

        if (!password) {
            return res.status(400).json({ success: false, error: "Please enter your password" });
        }

        const player = await findPlayerByTelegramId(telegramId);
        if (!player) {
            return res.status(404).json({ success: false, error: "Account not found. Please register first." });
        }

        const valid = await argon2.verify(player.password_hash, password);
        if (!valid) {
            return res.status(401).json({ success: false, error: "Incorrect password" });
        }

        const token = createSession(player);
        return res.json({ success: true, token, player: publicPlayer(player) });
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message || "Login failed" });
    }
}

app.post("/api/auth/register", registerHandler);
app.post("/api/account/register", registerHandler);
app.post("/api/auth/login", loginHandler);
app.post("/api/account/login", loginHandler);

app.get("/api/account/me", requirePlayer, (req, res) => {
    res.json({ success: true, player: publicPlayer(req.player) });
});

/*
|--------------------------------------------------------------------------
| SERVER START
|--------------------------------------------------------------------------
*/

app.listen(PORT, "0.0.0.0", () => {
    console.log(`DESTA PLAY SERVER RUNNING ON PORT ${PORT}`);
});
