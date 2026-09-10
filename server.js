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

const ADMIN_TELEGRAM_ID =
    String(process.env.ADMIN_TELEGRAM_ID || "").trim();

const ADMIN_PRIVATE_GROUP_ID =
    String(process.env.ADMIN_PRIVATE_GROUP_ID || "").trim();

const TELEGRAM_BOT_TOKEN =
    String(process.env.TELEGRAM_BOT_TOKEN || "").trim();

const TELEGRAM_WEBHOOK_SECRET =
    String(process.env.TELEGRAM_WEBHOOK_SECRET || "").trim();

const PUBLIC_APP_URL =
    String(
        process.env.PUBLIC_APP_URL ||
        "https://desta-play.onrender.com/"
    ).trim().replace(/\/$/, "");

const SMS_WEBHOOK_SECRET =
    String(process.env.SMS_WEBHOOK_SECRET || "").trim();

const PAYMENT_OWNER_NAME =
    String(
        process.env.PAYMENT_OWNER_NAME ||
        "TEST PAYMENT OWNER"
    ).trim();

const PAYMENT_PHONE =
    String(
        process.env.PAYMENT_PHONE ||
        "TEST PAYMENT PHONE"
    ).trim();

const TELEBIRR_ACCOUNT =
    String(
        process.env.TELEBIRR_ACCOUNT ||
        "TEST TELEBIRR ACCOUNT"
    ).trim();

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
app.use(
    express.static(
        path.join(__dirname, "public")
    )
);

createVoiceRouter(
    app,
    {
        publicDir:
            path.join(
                __dirname,
                "public"
            )
    }
);

/*
|--------------------------------------------------------------------------
| TELEGRAM REGISTRATION CONTACT CACHE
|--------------------------------------------------------------------------
*/

const pendingRegistrationContacts =
    new Map();

function storeRegistrationContact(
    telegramId,
    phone
) {
    const id =
        String(
            telegramId || ""
        ).trim();

    const normalized =
        normalizePhone(phone);

    if (
        !id ||
        !normalized
    ) {
        return false;
    }

    pendingRegistrationContacts.set(
        id,
        {
            phone: normalized,
            createdAt: Date.now()
        }
    );

    return true;
}

function getRegistrationContact(
    telegramId
) {
    const id =
        String(
            telegramId || ""
        ).trim();

    const entry =
        pendingRegistrationContacts.get(
            id
        );

    if (!entry) {
        return null;
    }

    if (
        Date.now() -
        entry.createdAt >
        10 * 60 * 1000
    ) {
        pendingRegistrationContacts.delete(
            id
        );

        return null;
    }

    return entry.phone;
}

/*
|--------------------------------------------------------------------------
| GAME ENGINES
|--------------------------------------------------------------------------
*/

const games = {};

/*
|--------------------------------------------------------------------------
| DESTA PLAY — PVP ARENA FOUNDATION
|--------------------------------------------------------------------------
*/

const PVP_GAMES =
    Object.fromEntries(
        Object.entries(
            PVP_ENGINES
        ).map(
            ([id, engine]) => [
                id,
                {
                    name: engine.name,
                    maxPlayers:
                        Number(
                            engine.maxPlayers ||
                            4
                        ),
                    minPlayers:
                        Number(
                            engine.minPlayers ||
                            2
                        )
                }
            ]
        )
    );

const PVP_ENTRY_FEES =
    [
        ...MANAGER_ENTRY_FEES
    ];

const pvpManager =
    new PVPManager();

const PVP_HOUSE_RAKE_PERCENT = 10;

const pvpPoolEngine =
    new PoolEngine(
        PVP_HOUSE_RAKE_PERCENT
    );

const pvpRooms =
    new Map();

const pvpPlayerRooms =
    new Map();

const PVP_ROOM_TTL_MS =
    30 * 60 * 1000;

function pvpRoomKey(
    game,
    entryFee
) {
    return (
        `${game}:${Number(entryFee).toFixed(2)}`
    );
}

function pvpPublicRoom(
    room
) {
    return {
        roomId:
            room.roomId,

        game:
            room.game,

        gameName:
            PVP_GAMES[
                room.game
            ]?.name ||
            room.game,

        entryFee:
            room.entryFee,

        entryFees:
            PVP_ENTRY_FEES,

        grossPool:
            Number(
                (
                    room.players.size *
                    room.entryFee
                ).toFixed(2)
            ),

        prizePool:
            Number(
                (
                    room.players.size *
                    room.entryFee *
                    0.90
                ).toFixed(2)
            ),

        maxPlayers:
            room.maxPlayers,

        minPlayers:
            room.minPlayers,

        playersCount:
            room.players.size,

        status:
            room.status,

        roundId:
            room.roundId,

        createdAt:
            room.createdAt,

        startedAt:
            room.startedAt ||
            null,

        bettingEndsAt:
            room.bettingEndsAt,

        remainingSeconds:
            Math.max(
                0,
                Math.ceil(
                    (
                        room.bettingEndsAt -
                        Date.now()
                    ) / 1000
                )
            )
    };
}

function pvpGetOrCreateRoom(
    game,
    entryFee
) {
    const key =
        pvpRoomKey(
            game,
            entryFee
        );

    const existing =
        pvpRooms.get(
            key
        );

    if (
        existing &&
        existing.status === "BETTING" &&
        existing.players.size <
            existing.maxPlayers &&
        Date.now() <
            existing.bettingEndsAt
    ) {
        return existing;
    }

    const cfg =
        PVP_GAMES[
            game
        ];

    if (!cfg) {
        throw new Error(
            "Unsupported PVP game"
        );
    }

    if (
        !MANAGER_ENTRY_FEES.includes(
            Number(entryFee)
        )
    ) {
        throw new Error(
            "Invalid PVP entry fee"
        );
    }

    const now =
        Date.now();

    const room = {
        roomId:
            `pvp-${game}-${now}-${crypto.randomBytes(4).toString("hex")}`,

        roundId:
            `pvp-round-${now}-${crypto.randomBytes(5).toString("hex")}`,

        game,

        entryFee:
            Number(entryFee),

        maxPlayers:
            cfg.maxPlayers,

        minPlayers:
            cfg.minPlayers,

        players:
            new Map(),

        status:
            "BETTING",

        createdAt:
            now,

        bettingEndsAt:
            now + 45000,

        startedAt:
            null,

        finishedAt:
            null,

        state:
            {},

        result:
            null,

        settled:
            false,

        winnerIds:
            []
    };

    room.state =
        PVP_AUTHORITY.createAuthorityState(
            room,
            PVP_ENGINES[
                game
            ]?.createState
                ? PVP_ENGINES[
                    game
                ].createState(room)
                : {}
        );

    pvpRooms.set(
        key,
        room
    );

    pvpPersistRoom(
        room
    ).catch(
        console.error
    );

    setTimeout(
        () =>
            pvpStartRoomIfReady(
                room
            ),
        45000
    );

    return room;
}

function pvpEntryFee(
    value
) {
    const n =
        Number(value);

    if (
        !Number.isFinite(n) ||
        !PVP_ENTRY_FEES.includes(n)
    ) {
        throw new Error(
            "Invalid PVP entry fee"
        );
    }

    return n;
}

async function pvpPersistRoom(
    room
) {
    try {
        if (!room.dbRoomId) {
            const {
                data,
                error
            } =
                await supabase
                    .from("pvp_rooms")
                    .insert({
                        game_id:
                            room.game,

                        entry_fee_etb:
                            room.entryFee,

                        round_id:
                            room.roundId,

                        status:
                            room.status,

                        max_players:
                            room.maxPlayers,

                        min_players:
                            room.minPlayers,

                        total_pool_etb:
                            0,

                        rake_etb:
                            0,

                        prize_pool_etb:
                            0,

                        engine_state:
                            room.state ||
                            {}
                    })
                    .select("id")
                    .single();

            if (error) {
                throw error;
            }

            room.dbRoomId =
                data.id;
        } else {
            const pool =
                pvpPoolEngine.calculatePool(
                    room.entryFee,
                    room.players.size
                );

            const {
                error
            } =
                await supabase
                    .from("pvp_rooms")
                    .update({
                        status:
                            room.status,

                        total_pool_etb:
                            pool.grossPool,

                        rake_etb:
                            pool.rake,

                        prize_pool_etb:
                            pool.prizePool,

                        engine_state:
                            room.state ||
                            {}
                    })
                    .eq(
                        "id",
                        room.dbRoomId
                    );

            if (error) {
                throw error;
            }
        }
    } catch (error) {
        console.error(
            "[PVP] Room persistence error:",
            error.message
        );
    }
}

/*
|--------------------------------------------------------------------------
| TELEGRAM MINI APP AUTOMATIC PLAYER DETECTION
|--------------------------------------------------------------------------
|
| The frontend sends Telegram.WebApp.initData here.
|
| Existing player:
|   -> automatically authenticated
|   -> no login/password screen
|   -> go directly to Home
|
| New player:
|   -> automatically detected
|   -> account setup is shown
|
| Telegram initData must be validated before trusting identity.
|--------------------------------------------------------------------------
*/

function validateTelegramInitData(
    initData
) {
    if (
        !initData ||
        !TELEGRAM_BOT_TOKEN
    ) {
        return null;
    }

    try {
        const params =
            new URLSearchParams(
                initData
            );

        const receivedHash =
            params.get(
                "hash"
            );

        if (!receivedHash) {
            return null;
        }

        params.delete(
            "hash"
        );

        const dataCheckString =
            [...params.entries()]
                .sort(
                    ([a], [b]) =>
                        a.localeCompare(b)
                )
                .map(
                    ([key, value]) =>
                        `${key}=${value}`
                )
                .join("\n");

        const secretKey =
            crypto
                .createHmac(
                    "sha256",
                    "WebAppData"
                )
                .update(
                    TELEGRAM_BOT_TOKEN
                )
                .digest();

        const calculatedHash =
            crypto
                .createHmac(
                    "sha256",
                    secretKey
                )
                .update(
                    dataCheckString
                )
                .digest(
                    "hex"
                );

        if (
            calculatedHash.length !==
            receivedHash.length
        ) {
            return null;
        }

        if (
            !crypto.timingSafeEqual(
                Buffer.from(
                    calculatedHash,
                    "utf8"
                ),
                Buffer.from(
                    receivedHash,
                    "utf8"
                )
            )
        ) {
            return null;
        }

        const authDate =
            Number(
                params.get(
                    "auth_date"
                )
            );

        if (
            !Number.isFinite(
                authDate
            )
        ) {
            return null;
        }

        /*
         * Reject very old authentication data.
         */
        const age =
            Math.floor(
                Date.now() / 1000
            ) -
            authDate;

        if (
            age >
            24 * 60 * 60
        ) {
            return null;
        }

        const userRaw =
            params.get(
                "user"
            );

        if (!userRaw) {
            return null;
        }

        const user =
            JSON.parse(
                userRaw
            );

        if (
            !user ||
            !user.id
        ) {
            return null;
        }

        return {
            telegramId:
                String(
                    user.id
                ),

            username:
                String(
                    user.username ||
                    ""
                ),

            firstName:
                String(
                    user.first_name ||
                    ""
                ),

            lastName:
                String(
                    user.last_name ||
                    ""
                ),

            languageCode:
                String(
                    user.language_code ||
                    ""
                )
        };
    } catch (error) {
        console.error(
            "[Telegram Auth]",
            error.message
        );

        return null;
    }
}

/*
|--------------------------------------------------------------------------
| TELEGRAM AUTH ENDPOINT
|--------------------------------------------------------------------------
*/

app.post(
    "/api/auth/telegram",
    async (
        req,
        res
    ) => {
        try {
            const initData =
                String(
                    req.body?.initData ||
                    ""
                ).trim();

            if (!initData) {
                return res.status(400).json({
                    success: false,
                    error:
                        "Telegram authentication data missing"
                });
            }

            const telegramUser =
                validateTelegramInitData(
                    initData
                );

            if (!telegramUser) {
                return res.status(401).json({
                    success: false,
                    error:
                        "Invalid Telegram authentication"
                });
            }

            /*
             * IMPORTANT:
             * Use the permanent player database.
             *
             * Adjust the column/table names below only if your
             * existing permanent schema uses different names.
             */
            const {
                data: existingPlayer,
                error
            } =
                await supabase
                    .from("players")
                    .select(
                        "id, telegram_id, username, phone"
                    )
                    .eq(
                        "telegram_id",
                        telegramUser.telegramId
                    )
                    .maybeSingle();

            if (error) {
                console.error(
                    "[Telegram Auth] Database lookup error:",
                    error.message
                );

                return res.status(500).json({
                    success: false,
                    error:
                        "Database lookup failed"
                });
            }

            /*
             * EXISTING PLAYER
             *
             * No password screen.
             * No manual login.
             */
            if (existingPlayer) {
                const sessionToken =
                    createSessionToken(
                        existingPlayer.id
                    );

                setSessionCookie(
                    res,
                    sessionToken
                );

                return res.json({
                    success: true,
                    isNewUser: false,
                    playerId:
                        String(
                            existingPlayer.id
                        ),
                    telegramId:
                        telegramUser.telegramId,
                    username:
                        telegramUser.username,
                    phone:
                        existingPlayer.phone ||
                        null
                });
            }

            /*
             * NEW PLAYER
             *
             * Do not create a duplicate account.
             * The account can be completed by the registration
             * endpoint using this same Telegram identity.
             */
            return res.json({
                success: true,
                isNewUser: true,
                playerId: null,
                telegramId:
                    telegramUser.telegramId,
                username:
                    telegramUser.username,
                phone:
                    getRegistrationContact(
                        telegramUser.telegramId
                    )
            });
        } catch (error) {
            console.error(
                "[Telegram Auth]",
                error
            );

            return res.status(500).json({
                success: false,
                error:
                    "Automatic player detection failed"
            });
        }
    }
);

/*
|--------------------------------------------------------------------------
| SESSION HELPERS
|--------------------------------------------------------------------------
*/

function createSessionToken(
    playerId
) {
    const payload =
        `${String(playerId)}.${Date.now()}`;

    const signature =
        crypto
            .createHmac(
                "sha256",
                SESSION_SECRET
            )
            .update(
                payload
            )
            .digest(
                "hex"
            );

    return Buffer
        .from(
            `${payload}.${signature}`
        )
        .toString(
            "base64url"
        );
}

function setSessionCookie(
    res,
    token
) {
    res.setHeader(
        "Set-Cookie",
        `desta_session=${token}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=604800`
    );
}

/*
|--------------------------------------------------------------------------
| NOTE
|--------------------------------------------------------------------------
|
| The remainder of this server is your existing backend engine.
| Keep your existing authentication, balance, deposit, withdrawal,
| invitation, Telegram notification, Keno and Bingo implementations
| below this point.
|
|--------------------------------------------------------------------------
*/

/*
 * EXISTING SERVER CODE CONTINUES HERE.
 *
 * Keep the remainder of your current server.js unchanged.
 */
