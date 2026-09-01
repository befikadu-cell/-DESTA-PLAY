/*
|--------------------------------------------------------------------------
| DESTA PLAY — PERSISTENT BACKEND
|--------------------------------------------------------------------------
|
| This server provides:
|
|   - Telegram/player accounts
|   - Argon2id password hashing
|   - Persistent wallet balance
|   - Persistent transaction ledger
|   - Persistent game rounds
|   - Shared round state for every connected player
|   - Automatic round engine
|   - Keno / Bingo / Roulette / Aviator engines
|   - Last-10 completed rounds
|   - Health/status APIs
|
| IMPORTANT:
|   Real-money wagering/payout settlement is intentionally NOT implemented
|   here. Use a licensed/regulated wagering/payment service for that layer.
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
| ENVIRONMENT
|--------------------------------------------------------------------------
*/

const PORT = Number(process.env.PORT || 10000);

const SUPABASE_URL =
    process.env.SUPABASE_URL;

const SUPABASE_SERVICE_ROLE_KEY =
    process.env.SUPABASE_SERVICE_ROLE_KEY;

const SESSION_SECRET =
    process.env.SESSION_SECRET;

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
|
| SERVICE ROLE KEY MUST NEVER be placed in index.html.
|
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
| APP
|--------------------------------------------------------------------------
*/

const app = express();

app.use(cors());

app.use(express.json({
    limit: "100kb"
}));

app.use(
    express.static(
        path.join(__dirname, "public")
    )
);


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


/*
|--------------------------------------------------------------------------
| RUNTIME ROUND CACHE
|--------------------------------------------------------------------------
|
| Database is the persistent source.
| This object is only the live in-memory copy used by the engine.
|
*/

const rounds = {};


/*
|--------------------------------------------------------------------------
| TIMING
|--------------------------------------------------------------------------
*/

const DRAW_INTERVALS = {
    keno: 1800,
    bingo: 4000,
    roulette: 5000
};

const NEXT_ROUND_DELAY = 2000;


/*
|--------------------------------------------------------------------------
| HELPERS
|--------------------------------------------------------------------------
*/

function nowIso() {
    return new Date().toISOString();
}


function makeId(prefix = "") {

    return (
        prefix +
        crypto.randomBytes(16).toString("hex")
    );

}


function makePlayerId() {

    return (
        "DP-" +
        crypto.randomBytes(4)
            .toString("hex")
            .toUpperCase()
    );

}


function normalizeTelegramName(name) {

    if (
        typeof name !== "string"
    ) {
        return "Player";
    }

    const clean =
        name
            .trim()
            .replace(/\s+/g, " ");

    return (
        clean.slice(0, 80) ||
        "Player"
    );

}


function validPassword(password) {

    return (
        typeof password === "string" &&
        password.length >= 8 &&
        password.length <= 128
    );

}


/*
|--------------------------------------------------------------------------
| DATABASE HELPERS
|--------------------------------------------------------------------------
*/

async function dbError(context, error) {

    console.error(
        `[DATABASE] ${context}:`,
        error
    );

}


/*
|--------------------------------------------------------------------------
| PLAYER ACCOUNT
|--------------------------------------------------------------------------
*/

async function findPlayerByTelegramId(
    telegramId
) {

    const { data, error } =
        await supabase
            .from("players")
            .select("*")
            .eq(
                "telegram_id",
                String(telegramId)
            )
            .maybeSingle();

    if (error) {

        await dbError(
            "findPlayerByTelegramId",
            error
        );

        throw new Error(
            "Database error"
        );

    }

    return data;

}


async function findPlayerById(
    playerId
) {

    const { data, error } =
        await supabase
            .from("players")
            .select("*")
            .eq(
                "player_id",
                playerId
            )
            .maybeSingle();

    if (error) {

        await dbError(
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
        telegramId === null
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
     * Argon2id.
     *
     * The password itself is NEVER stored.
     */

    const passwordHash =
        await argon2.hash(
            password,
            {
                type:
                    argon2.argon2id,
                memoryCost:
                    19456,
                timeCost:
                    2,
                parallelism:
                    1
            }
        );


    const playerId =
        makePlayerId();

    const name =
        normalizeTelegramName(
            telegramName
        );


    const { data, error } =
        await supabase
            .from("players")
            .insert({
                player_id:
                    playerId,

                telegram_id:
                    String(telegramId),

                telegram_name:
                    name,

                password_hash:
                    passwordHash,

                balance:
                    0,

                created_at:
                    nowIso(),

                updated_at:
                    nowIso()
            })
            .select(
                "id,player_id,telegram_id,telegram_name,balance,created_at"
            )
            .single();


    if (error) {

        await dbError(
            "createPlayer",
            error
        );

        throw new Error(
            "Could not create account"
        );

    }

    return data;

}


/*
|--------------------------------------------------------------------------
| LOGIN
|--------------------------------------------------------------------------
*/

async function authenticatePlayer(
    telegramId,
    password
) {

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
| SIMPLE SESSION TOKENS
|--------------------------------------------------------------------------
|
| For production authentication, replace this with a proper session/JWT
| system or your licensed identity provider.
|
*/

const sessions =
    new Map();


function createSession(player) {

    const token =
        crypto.randomBytes(32)
            .toString("hex");

    sessions.set(
        token,
        {
            playerId:
                player.playerId,

            createdAt:
                Date.now()
        }
    );

    return token;

}


function getSessionPlayer(
    req
) {

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
        header.slice(7).trim();

    const session =
        sessions.get(token);

    if (!session) {
        return null;
    }

    return session;

}


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
            "[AUTH]",
            error
        );

        res
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
| TRANSACTION LEDGER
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

    const { data, error } =
        await supabase
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

        await dbError(
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
| WALLET
|--------------------------------------------------------------------------
|
| IMPORTANT:
| For real-money systems, balance mutations must be done through a
| database transaction/RPC with appropriate authorization.
|
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


    /*
     * This endpoint is intentionally not exposed as a public arbitrary
     * balance mutation.
     *
     * Actual regulated deposit/withdrawal/betting settlement should be
     * performed through a properly authorized database RPC/provider.
     */

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
        Number(player.balance || 0);

    const after =
        before + numericAmount;


    if (after < 0) {

        throw new Error(
            "Insufficient balance"
        );

    }


    /*
     * This update is suitable for administrative/non-wagering ledger
     * operations only. Real-money settlement should use an atomic RPC.
     */

    const { data, error } =
        await supabase
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
            .select(
                "player_id,balance"
            )
            .single();


    if (error) {

        await dbError(
            "changeBalance",
            error
        );

        throw new Error(
            "Could not update balance"
        );

    }


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


    return data;

}


/*
|--------------------------------------------------------------------------
| ACCOUNT ROUTES
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
            } = req.body;


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
                "[REGISTER]",
                error
            );

            res
                .status(400)
                .json({

                    success: false,

                    error:
                        error.message

                });

        }

    }
);


/*
|--------------------------------------------------------------------------
| LOGIN
|--------------------------------------------------------------------------
*/

app.post(
    "/api/account/login",
    async (req, res) => {

        try {

            const {
                telegramId,
                password
            } = req.body;


            if (
                telegramId === undefined ||
                !validPassword(password)
            ) {

                return res
                    .status(400)
                    .json({

                        success: false,

                        error:
                            "Telegram ID and password are required"

                    });

            }


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

            res
                .status(401)
                .json({

                    success: false,

                    error:
                        error.message

                });

        }

    }
);


/*
|--------------------------------------------------------------------------
| LOGOUT
|--------------------------------------------------------------------------
*/

app.post(
    "/api/account/logout",
    (req, res) => {

        const header =
            req.headers.authorization || "";

        if (
            header.startsWith(
                "Bearer "
            )
        ) {

            sessions.delete(
                header.slice(7).trim()
            );

        }


        res.json({
            success: true
        });

    }
);


/*
|--------------------------------------------------------------------------
| CURRENT PROFILE
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
                    req.player.player_id,

                telegramId:
                    req.player.telegram_id,

                telegramName:
                    req.player.telegram_name,

                balance:
                    Number(
                        req.player.balance || 0
                    ),

                createdAt:
                    req.player.created_at

            }

        });

    }
);


/*
|--------------------------------------------------------------------------
| TRANSACTION HISTORY
|--------------------------------------------------------------------------
*/

app.get(
    "/api/wallet/transactions",
    requirePlayer,
    async (req, res) => {

        try {

            const limit =
                Math.min(
                    100,
                    Math.max(
                        1,
                        Number(
                            req.query.limit || 50
                        )
                    )
                );


            const { data, error } =
                await supabase
                    .from(
                        "wallet_transactions"
                    )
                    .select(
                        "transaction_id,type,amount,balance_before,balance_after,game,round_id,status,reference,metadata,created_at"
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
                    .limit(limit);


            if (error) {

                throw error;

            }


            res.json({

                success: true,

                transactions:
                    data || []

            });


        } catch (error) {

            console.error(
                "[TRANSACTIONS]",
                error
            );

            res
                .status(500)
                .json({

                    success: false,

                    error:
                        "Could not load transaction history"

                });

        }

    }
);


/*
|--------------------------------------------------------------------------
| WALLET SUMMARY
|--------------------------------------------------------------------------
*/

app.get(
    "/api/wallet",
    requirePlayer,
    async (req, res) => {

        try {

            const { data, error } =
                await supabase
                    .from(
                        "wallet_transactions"
                    )
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
                throw error;
            }


            res.json({

                success: true,

                balance:
                    Number(
                        req.player.balance || 0
                    ),

                transactions:
                    data || []

            });


        } catch (error) {

            console.error(
                "[WALLET]",
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
| DEPOSIT / WITHDRAWAL REQUEST RECORDS
|--------------------------------------------------------------------------
|
| These create pending records only.
| They do NOT move real money.
|
| Connect these to your licensed payment provider after approval.
|--------------------------------------------------------------------------
*/

app.post(
    "/api/wallet/deposit-request",
    requirePlayer,
    async (req, res) => {

        try {

            const amount =
                Number(
                    req.body.amount
                );

            if (
                !Number.isFinite(amount) ||
                amount <= 0
            ) {

                return res
                    .status(400)
                    .json({

                        success: false,

                        error:
                            "Invalid amount"

                    });

            }


            const transaction =
                await recordTransaction({

                    playerId:
                        req.player.player_id,

                    type:
                        "deposit_request",

                    amount,

                    balanceBefore:
                        Number(
                            req.player.balance || 0
                        ),

                    balanceAfter:
                        Number(
                            req.player.balance || 0
                        ),

                    status:
                        "pending",

                    reference:
                        makeId("DEP-")

                });


            res.json({

                success: true,

                status:
                    "pending",

                transaction

            });


        } catch (error) {

            console.error(
                "[DEPOSIT REQUEST]",
                error
            );

            res
                .status(500)
                .json({

                    success: false,

                    error:
                        "Could not create deposit request"

                });

        }

    }
);


app.post(
    "/api/wallet/withdraw-request",
    requirePlayer,
    async (req, res) => {

        try {

            const amount =
                Number(
                    req.body.amount
                );

            if (
                !Number.isFinite(amount) ||
                amount <= 0
            ) {

                return res
                    .status(400)
                    .json({

                        success: false,

                        error:
                            "Invalid amount"

                    });

            }


            const balance =
                Number(
                    req.player.balance || 0
                );


            if (
                amount > balance
            ) {

                return res
                    .status(400)
                    .json({

                        success: false,

                        error:
                            "Insufficient balance"

                    });

            }


            const transaction =
                await recordTransaction({

                    playerId:
                        req.player.player_id,

                    type:
                        "withdrawal_request",

                    amount:
                        -amount,

                    balanceBefore:
                        balance,

                    balanceAfter:
                        balance,

                    status:
                        "pending",

                    reference:
                        makeId("WDR-")

                });


            res.json({

                success: true,

                status:
                    "pending",

                transaction

            });


        } catch (error) {

            console.error(
                "[WITHDRAW REQUEST]",
                error
            );

            res
                .status(500)
                .json({

                    success: false,

                    error:
                        "Could not create withdrawal request"

                });

        }

    }
);


/*
|--------------------------------------------------------------------------
| ROUND STORAGE
|--------------------------------------------------------------------------
*/

function makeRoundId(
    gameName
) {

    return (
        gameName +
        "-" +
        Date.now() +
        "-" +
        crypto
            .randomBytes(5)
            .toString("hex")
    );

}


/*
|--------------------------------------------------------------------------
| CREATE ROUND
|--------------------------------------------------------------------------
*/

async function createGameRound(
    gameName
) {

    const game =
        games[gameName];

    if (!game) {

        throw new Error(
            `Unknown game: ${gameName}`
        );

    }


    const engineRound =
        game.createRound();

    const now =
        Date.now();

    const bettingSeconds =
        Number(
            engineRound.bettingSeconds
        );


    const round = {

        id:
            makeRoundId(
                gameName
            ),

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

        remainingSeconds:
            bettingSeconds,

        drawnNumbers: [],

        drawIndex: 0,

        totalDraws: 0,

        currentNumber:
            null,

        result:
            null,

        crashPoint:
            null,

        multiplier:
            null,

        flyingStartedAt:
            null,

        finishedAt:
            null,

        nextRoundAt:
            null

    };


    /*
     * KENO
     */

    if (
        gameName === "keno"
    ) {

        const completeDraw =
            game.createDraw();

        round.secretDraw =
            completeDraw;

        round.totalDraws =
            completeDraw.length;

    }


    /*
     * BINGO
     */

    if (
        gameName === "bingo"
    ) {

        const completeDraw =
            game.generateDrawOrder();

        round.secretDraw =
            completeDraw;

        round.totalDraws =
            completeDraw.length;

    }


    /*
     * AVIATOR
     */

    if (
        gameName === "aviator"
    ) {

        const crash =
            game.generateCrashPoint();

        round.secretCrashPoint =
            Number(
                crash.multiplier
            );

        round.multiplier =
            1.00;

    }


    rounds[gameName] =
        round;


    /*
     * Persist public + secret state.
     *
     * The secret fields are kept server-side.
     */

    await saveRound(
        round
    );


    console.log(
        `[${gameName}] ROUND STARTED: ${round.id}`
    );


    return round;

}


/*
|--------------------------------------------------------------------------
| SAVE ROUND
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

        draw_index:
            round.drawIndex,

        total_draws:
            round.totalDraws,

        current_number:
            round.currentNumber,

        result:
            round.result,

        multiplier:
            round.multiplier,

        crash_point:
            round.crashPoint,

        secret_draw:
            round.secretDraw || null,

        secret_crash_point:
            round.secretCrashPoint || null,

        started_at:
            round.startedAt,

        finished_at:
            round.finishedAt,

        next_round_at:
            round.nextRoundAt,

        updated_at:
            nowIso()

    };


    const { error } =
        await supabase
            .from(
                "game_rounds"
            )
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

    }

}


/*
|--------------------------------------------------------------------------
| PUBLIC ROUND
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

    let remainingSeconds = 0;


    if (
        round.status ===
        "BETTING"
    ) {

        remainingSeconds =
            Math.max(
                0,
                Math.ceil(
                    (
                        round.bettingEndsAt -
                        now
                    ) / 1000
                )
            );

    }


    return {

        id:
            round.id,

        game:
            round.game,

        status:
            round.status,

        bettingSeconds:
            round.bettingSeconds,

        remainingSeconds,

        createdAt:
            round.createdAt,

        startedAt:
            round.startedAt,

        bettingStartedAt:
            round.bettingStartedAt,

        bettingEndsAt:
            new Date(
                round.bettingEndsAt
            ).toISOString(),

        currentNumber:
            round.currentNumber,

        drawIndex:
            round.drawIndex,

        totalDraws:
            round.totalDraws,

        drawnNumbers:
            [
                ...round.drawnNumbers
            ],

        draw:
            [
                ...round.drawnNumbers
            ],

        result:
            round.result,

        multiplier:
            round.multiplier,

        crashPoint:
            round.status ===
            "CRASHED"
                ? round.crashPoint
                : null,

        finishedAt:
            round.finishedAt,

        nextRoundAt:
            round.nextRoundAt

    };

}


/*
|--------------------------------------------------------------------------
| FINISH ROUND
|--------------------------------------------------------------------------
*/

async function finishRound(
    gameName
) {

    const round =
        rounds[gameName];

    if (!round) return;


    if (
        round.status ===
            "FINISHED" ||
        round.status ===
            "CRASHED"
    ) {

        return;

    }


    if (
        gameName ===
        "roulette"
    ) {

        round.result =
            roulette.spin();

        round.status =
            "FINISHED";

    } else {

        round.status =
            "FINISHED";

    }


    round.finishedAt =
        nowIso();

    round.nextRoundAt =
        new Date(
            Date.now() +
            NEXT_ROUND_DELAY
        ).toISOString();


    await saveRound(
        round
    );


    console.log(
        `[${gameName}] FINISHED ${round.id}`
    );


    scheduleNextRound(
        gameName
    );

}


/*
|--------------------------------------------------------------------------
| KENO
|--------------------------------------------------------------------------
*/

function startKenoDraw(
    gameName
) {

    const round =
        rounds[gameName];

    if (
        !round ||
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


    saveRound(round)
        .catch(console.error);


    revealNextKenoNumber(
        gameName
    );

}


function revealNextKenoNumber(
    gameName
) {

    const round =
        rounds[gameName];

    if (
        !round ||
        round.status !==
            "DRAWING"
    ) {
        return;
    }


    if (
        round.drawIndex >=
        round.secretDraw.length
    ) {

        finishRound(
            gameName
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


    saveRound(round)
        .catch(console.error);


    setTimeout(
        () => {

            revealNextKenoNumber(
                gameName
            );

        },
        DRAW_INTERVALS.keno
    );

}


/*
|--------------------------------------------------------------------------
| BINGO
|--------------------------------------------------------------------------
*/

function startBingoDraw(
    gameName
) {

    const round =
        rounds[gameName];

    if (
        !round ||
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


    saveRound(round)
        .catch(console.error);


    revealNextBingoNumber(
        gameName
    );

}


function revealNextBingoNumber(
    gameName
) {

    const round =
        rounds[gameName];

    if (
        !round ||
        round.status !==
            "DRAWING"
    ) {
        return;
    }


    if (
        round.drawIndex >=
        round.secretDraw.length
    ) {

        finishRound(
            gameName
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


    saveRound(round)
        .catch(console.error);


    setTimeout(
        () => {

            revealNextBingoNumber(
                gameName
            );

        },
        DRAW_INTERVALS.bingo
    );

}


/*
|--------------------------------------------------------------------------
| ROULETTE
|--------------------------------------------------------------------------
*/

function startRouletteSpin() {

    const round =
        rounds.roulette;

    if (
        !round ||
        round.status !==
            "BETTING"
    ) {
        return;
    }


    round.status =
        "SPINNING";


    saveRound(round)
        .catch(console.error);


    setTimeout(
        async () => {

            if (
                round.status !==
                    "SPINNING"
            ) {
                return;
            }


            round.result =
                roulette.spin();

            round.status =
                "FINISHED";

            round.finishedAt =
                nowIso();

            round.nextRoundAt =
                new Date(
                    Date.now() +
                    NEXT_ROUND_DELAY
                ).toISOString();


            await saveRound(
                round
            );


            scheduleNextRound(
                "roulette"
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

function startAviatorFlight() {

    const round =
        rounds.aviator;

    if (
        !round ||
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


    saveRound(round)
        .catch(console.error);


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
        round.id !==
            roundId ||
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


    const calculatedMultiplier =
        Math.pow(
            1.12,
            elapsed
        );


    const crashPoint =
        round.secretCrashPoint;


    if (
        calculatedMultiplier >=
        crashPoint
    ) {

        round.multiplier =
            crashPoint;

        round.crashPoint =
            crashPoint;

        round.status =
            "CRASHED";

        round.finishedAt =
            nowIso();

        round.nextRoundAt =
            new Date(
                Date.now() +
                NEXT_ROUND_DELAY
            ).toISOString();


        saveRound(round)
            .catch(console.error);


        scheduleNextRound(
            "aviator"
        );

        return;

    }


    round.multiplier =
        Number(
            calculatedMultiplier
                .toFixed(2)
        );


    /*
     * Persist current multiplier.
     *
     * This is throttled so the database is not written
     * hundreds of times per second.
     */

    if (
        !round.lastPersistedMultiplier ||
        Math.abs(
            round.multiplier -
            round.lastPersistedMultiplier
        ) >= 0.05
    ) {

        round.lastPersistedMultiplier =
            round.multiplier;

        saveRound(round)
            .catch(console.error);

    }


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
| ROUND HISTORY
|--------------------------------------------------------------------------
*/

app.get(
    "/api/game/:game/history",
    async (req, res) => {

        try {

            const gameName =
                req.params.game;

            if (
                !games[gameName]
            ) {

                return res
                    .status(404)
                    .json({

                        success: false,

                        error:
                            "Game not found"

                    });

            }


            const { data, error } =
                await supabase
                    .from(
                        "game_rounds"
                    )
                    .select(
                        "round_id,game,status,drawn_numbers,result,multiplier,crash_point,started_at,finished_at"
                    )
                    .eq(
                        "game",
                        gameName
                    )
                    .in(
                        "status",
                        [
                            "FINISHED",
                            "CRASHED"
                        ]
                    )
                    .order(
                        "finished_at",
                        {
                            ascending: false
                        }
                    )
                    .limit(10);


            if (error) {
                throw error;
            }


            res.json({

                success: true,

                rounds:
                    data || []

            });


        } catch (error) {

            console.error(
                "[HISTORY]",
                error
            );

            res
                .status(500)
                .json({

                    success: false,

                    error:
                        "Could not load history"

                });

        }

    }
);


/*
|--------------------------------------------------------------------------
| GLOBAL CURRENT STATE
|--------------------------------------------------------------------------
*/

app.get(
    "/api/status",
    (req, res) => {

        const gameState = {};


        for (
            const gameName
            of Object.keys(games)
        ) {

            gameState[gameName] =
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
                gameState

        });

    }
);


/*
|--------------------------------------------------------------------------
| CURRENT GAME ROUND
|--------------------------------------------------------------------------
*/

app.get(
    "/api/game/:game/round",
    (req, res) => {

        const gameName =
            req.params.game;


        if (
            !games[gameName]
        ) {

            return res
                .status(404)
                .json({

                    success: false,

                    error:
                        "Game not found"

                });

        }


        const round =
            rounds[gameName];


        if (!round) {

            return res
                .status(503)
                .json({

                    success: false,

                    error:
                        "Round not ready"

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
| GAME CONFIGURATION
|--------------------------------------------------------------------------
*/

app.get(
    "/api/games",
    (req, res) => {

        res.json({

            success: true,

            games: {

                keno: {

                    bettingSeconds:
                        keno.BETTING_SECONDS,

                    minNumber:
                        keno.KENO_MIN,

                    maxNumber:
                        keno.KENO_MAX,

                    maxSelections:
                        keno.MAX_PLAYER_SELECTIONS,

                    maxDraw:
                        keno.MAX_DRAWN_NUMBERS

                },

                bingo: {

                    bettingSeconds:
                        bingo.BETTING_SECONDS,

                    numbers:
                        bingo.BINGO_NUMBERS,

                    size:
                        bingo.BINGO_SIZE

                },

                roulette: {

                    bettingSeconds:
                        roulette.BETTING_SECONDS

                },

                aviator: {

                    bettingSeconds:
                        aviator.BETTING_SECONDS,

                    minMultiplier:
                        aviator.MIN_MULTIPLIER,

                    maxMultiplier:
                        aviator.MAX_MULTIPLIER

                }

            }

        });

    }
);


/*
|--------------------------------------------------------------------------
| KENO VALIDATION
|--------------------------------------------------------------------------
*/

app.post(
    "/api/keno/validate-selection",
    (req, res) => {

        try {

            const selection =
                keno.validateSelection(
                    req.body.selection
                );


            res.json({

                success: true,

                selection

            });


        } catch (error) {

            res
                .status(400)
                .json({

                    success: false,

                    error:
                        error.message

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
                !Number.isInteger(number) ||
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


            const cartela =
                bingo.generateCartela(
                    number
                );


            res.json({

                success: true,

                cartela

            });


        } catch (error) {

            res
                .status(400)
                .json({

                    success: false,

                    error:
                        error.message

                });

        }

    }
);


/*
|--------------------------------------------------------------------------
| BINGO CHECK
|--------------------------------------------------------------------------
*/

app.post(
    "/api/bingo/check",
    (req, res) => {

        try {

            const {
                cartela,
                calledNumbers
            } = req.body;


            if (
                !Array.isArray(cartela) ||
                !Array.isArray(
                    calledNumbers
                )
            ) {

                return res
                    .status(400)
                    .json({

                        success: false,

                        error:
                            "Cartela and calledNumbers are required"

                    });

            }


            const winning =
                bingo.isWinningCard(
                    cartela,
                    calledNumbers
                );


            res.json({

                success: true,

                winning

            });


        } catch (error) {

            res
                .status(400)
                .json({

                    success: false,

                    error:
                        error.message

                });

        }

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

            timestamp:
                nowIso()

        });

    }
);


/*
|--------------------------------------------------------------------------
| 404
|--------------------------------------------------------------------------
*/

app.use(
    (req, res) => {

        res
            .status(404)
            .json({

                success: false,

                error:
                    "Route not found"

            });

    }
);


/*
|--------------------------------------------------------------------------
| ERROR HANDLER
|--------------------------------------------------------------------------
*/

app.use(
    (error, req, res, next) => {

        console.error(
            "[SERVER ERROR]",
            error
        );


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
| RESTORE ACTIVE ROUNDS
|--------------------------------------------------------------------------
|
| If the process restarts, recover the latest unfinished round from
| Supabase instead of creating a different round for every player.
|
*/

async function restoreRounds() {

    for (
        const gameName
        of Object.keys(games)
    ) {

        try {

            const { data, error } =
                await supabase
                    .from(
                        "game_rounds"
                    )
                    .select("*")
                    .eq(
                        "game",
                        gameName
                    )
                    .in(
                        "status",
                        [
                            "BETTING",
                            "DRAWING",
                            "SPINNING",
                            "FLYING"
                        ]
                    )
                    .order(
                        "started_at",
                        {
                            ascending: false
                        }
                    )
                    .limit(1)
                    .maybeSingle();


            if (error) {
                throw error;
            }


            if (!data) {

                await createGameRound(
                    gameName
                );

                continue;

            }


            const restored = {

                id:
                    data.round_id,

                game:
                    data.game,

                status:
                    data.status,

                bettingSeconds:
                    Number(
                        data.betting_seconds
                    ),

                createdAt:
                    data.started_at,

                startedAt:
                    data.started_at,

                bettingStartedAt:
                    new Date(
                        data.betting_started_at
                    ).getTime(),

                bettingEndsAt:
                    new Date(
                        data.betting_ends_at
                    ).getTime(),

                drawnNumbers:
                    data.drawn_numbers ||
                    [],

                drawIndex:
                    Number(
                        data.draw_index || 0
                    ),

                totalDraws:
                    Number(
                        data.total_draws || 0
                    ),

                currentNumber:
                    data.current_number,

                result:
                    data.result,

                multiplier:
                    data.multiplier,

                crashPoint:
                    data.crash_point,

                secretDraw:
                    data.secret_draw,

                secretCrashPoint:
                    data.secret_crash_point,

                flyingStartedAt:
                    data.flying_started_at
                        ? new Date(
                            data.flying_started_at
                        ).getTime()
                        : null,

                finishedAt:
                    data.finished_at,

                nextRoundAt:
                    data.next_round_at

            };


            rounds[gameName] =
                restored;


            /*
             * If betting already expired while the server was down,
             * continue the round rather than starting a new one.
             */

            resumeRound(
                gameName
            );


            console.log(
                `[${gameName}] RESTORED ${restored.id}`
            );


        } catch (error) {

            console.error(
                `[${gameName}] RESTORE ERROR`,
                error
            );

            /*
             * If recovery fails, don't silently create an alternate
             * player-specific round.
             */

            if (!rounds[gameName]) {

                await createGameRound(
                    gameName
                );

            }

        }

    }

}


/*
|--------------------------------------------------------------------------
| RESUME ROUND
|--------------------------------------------------------------------------
*/

function resumeRound(
    gameName
) {

    const round =
        rounds[gameName];

    if (!round) return;


    if (
        round.status ===
        "BETTING"
    ) {

        const remaining =
            round.bettingEndsAt -
            Date.now();


        if (remaining <= 0) {

            startPhaseAfterBetting(
                gameName,
                round
            );

        } else {

            setTimeout(
                () => {

                    startPhaseAfterBetting(
                        gameName,
                        round
                    );

                },
                remaining
            );

        }

        return;

    }


    if (
        gameName === "keno" &&
        round.status ===
            "DRAWING"
    ) {

        revealNextKenoNumber(
            gameName
        );

        return;

    }


    if (
        gameName === "bingo" &&
        round.status ===
            "DRAWING"
    ) {

        revealNextBingoNumber(
            gameName
        );

        return;

    }


    if (
        gameName === "roulette" &&
        round.status ===
            "SPINNING"
    ) {

        startRouletteSpin();

        return;

    }


    if (
        gameName === "aviator" &&
        round.status ===
            "FLYING"
    ) {

        /*
         * Recalculate current Aviator state from the original
         * server-side start timestamp.
         */

        updateAviator(
            round.id
        );

    }

}


/*
|--------------------------------------------------------------------------
| AFTER BETTING
|--------------------------------------------------------------------------
*/

function startPhaseAfterBetting(
    gameName,
    round
) {

    if (
        rounds[gameName]?.id !==
        round.id
    ) {
        return;
    }


    if (
        round.status !==
        "BETTING"
    ) {
        return;
    }


    if (
        gameName === "keno"
    ) {

        startKenoDraw(
            gameName
        );

        return;

    }


    if (
        gameName === "bingo"
    ) {

        startBingoDraw(
            gameName
        );

        return;

    }


    if (
        gameName === "roulette"
    ) {

        startRouletteSpin();

        return;

    }


    if (
        gameName === "aviator"
    ) {

        startAviatorFlight();

        return;

    }

}


/*
|--------------------------------------------------------------------------
| NEXT ROUND
|--------------------------------------------------------------------------
*/

function scheduleNextRound(
    gameName
) {

    const round =
        rounds[gameName];

    if (!round) return;


    if (
        round.nextRoundScheduled
    ) {
        return;
    }


    round.nextRoundScheduled =
        true;


    setTimeout(
        async () => {

            try {

                await createGameRound(
                    gameName
                );


                const current =
                    rounds[gameName];


                setTimeout(
                    () => {

                        startPhaseAfterBetting(
                            gameName,
                            current
                        );

                    },
                    current.bettingSeconds *
                    1000
                );


            } catch (error) {

                console.error(
                    `[${gameName}] NEXT ROUND ERROR`,
                    error
                );

                /*
                 * Retry rather than silently stopping the engine.
                 */

                setTimeout(
                    () => {

                        scheduleNextRound(
                            gameName
                        );

                    },
                    5000
                );

            }

        },
        NEXT_ROUND_DELAY
    );

}


/*
|--------------------------------------------------------------------------
| START ENGINES
|--------------------------------------------------------------------------
*/

async function startEngines() {

    await restoreRounds();


    /*
     * Make sure every restored/new round has a transition timer.
     */

    for (
        const gameName
        of Object.keys(games)
    ) {

        const round =
            rounds[gameName];

        if (!round) {

            await createGameRound(
                gameName
            );

            continue;

        }


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

                    startPhaseAfterBetting(
                        gameName,
                        round
                    );

                },
                remaining
            );

        }

    }

}


/*
|--------------------------------------------------------------------------
| START SERVER
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
            "        DESTA PLAY BACKEND"
        );

        console.log(
            "========================================"
        );

        console.log(
            `Port: ${PORT}`
        );

        console.log(
            "Persistent database: ENABLED"
        );

        console.log(
            "Password hashing: Argon2id"
        );

        console.log(
            "Persistent transaction ledger: ENABLED"
        );

        console.log(
            "Persistent game rounds: ENABLED"
        );

        console.log(
            "Shared server-authoritative rounds: ENABLED"
        );

        console.log(
            "Games:"
        );

        for (
            const gameName
            of Object.keys(games)
        ) {

            console.log(
                `  ✓ ${gameName}`
            );

        }

        console.log(
            "========================================"
        );


        try {

            await startEngines();

            console.log(
                "All game engines are running."
            );

        } catch (error) {

            console.error(
                "ENGINE START ERROR:",
                error
            );

        }

    }
);
