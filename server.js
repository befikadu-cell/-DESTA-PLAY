const express = require("express");
const cors = require("cors");
const path = require("path");

/*
|--------------------------------------------------------------------------
| GAME ENGINES
|--------------------------------------------------------------------------
*/

const keno = require("./games/keno");
const bingo = require("./games/bingo");
const roulette = require("./games/roulette");
const aviator = require("./games/aviator");


/*
|--------------------------------------------------------------------------
| APP
|--------------------------------------------------------------------------
*/

const app = express();

app.use(cors());
app.use(express.json());

/*
 * If index.html is inside:
 *
 * public/index.html
 *
 * Express will serve it automatically.
 */
app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 10000;


/*
|--------------------------------------------------------------------------
| GAMES
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
| ROUND STORAGE
|--------------------------------------------------------------------------
|
| The server is the authority for the current round.
|
*/

const rounds = {};


/*
|--------------------------------------------------------------------------
| TIMING CONFIGURATION
|--------------------------------------------------------------------------
|
| These are the delays AFTER betting finishes.
|
*/

const DRAW_INTERVALS = {
    keno: 1800,       // 1.8 seconds between numbers
    bingo: 4000,      // 4 seconds between numbers
    roulette: 5000    // 5 seconds for spin/result animation
};

const NEXT_ROUND_DELAY = 2000;


/*
|--------------------------------------------------------------------------
| ROUND CREATION
|--------------------------------------------------------------------------
*/

function makeRoundId(gameName) {

    return (
        `${gameName}-` +
        `${Date.now()}-` +
        `${Math.floor(Math.random() * 1000000)}`
    );
}


function createGameRound(gameName) {

    const game = games[gameName];

    if (!game) {
        throw new Error(`Unknown game: ${gameName}`);
    }

    const engineRound = game.createRound();

    const now = Date.now();

    const bettingSeconds =
        Number(engineRound.bettingSeconds);

    const round = {

        id: makeRoundId(gameName),

        game: gameName,

        status: "BETTING",

        createdAt:
            new Date(now).toISOString(),

        startedAt:
            new Date(now).toISOString(),

        bettingSeconds,

        bettingStartedAt: now,

        bettingEndsAt:
            now + bettingSeconds * 1000,

        remainingSeconds:
            bettingSeconds,

        /*
         * Game-specific state.
         */
        draw: [],

        drawnNumbers: [],

        drawIndex: 0,

        totalDraws: 0,

        currentNumber: null,

        result: null,

        crashPoint: null,

        multiplier: null,

        flyingStartedAt: null,

        finishedAt: null,

        nextRoundAt: null

    };


    /*
     * KENO
     *
     * Generate the complete secret draw now,
     * but reveal it progressively.
     */
    if (gameName === "keno") {

        const completeDraw =
            game.createDraw();

        round.secretDraw =
            completeDraw;

        round.totalDraws =
            completeDraw.length;
    }


    /*
     * BINGO
     *
     * Generate the complete draw order now,
     * but reveal one number at a time.
     */
    if (gameName === "bingo") {

        const completeDraw =
            game.generateDrawOrder();

        round.secretDraw =
            completeDraw;

        round.totalDraws =
            completeDraw.length;
    }


    /*
     * AVIATOR
     *
     * Generate the crash point before flying,
     * but NEVER expose it to the client
     * until the crash happens.
     */
    if (gameName === "aviator") {

        const crash =
            game.generateCrashPoint();

        round.secretCrashPoint =
            Number(crash.multiplier);

        round.multiplier =
            1.00;
    }


    rounds[gameName] = round;

    console.log(
        `[${gameName}] ROUND STARTED: ${round.id}`
    );

    return round;
}


/*
|--------------------------------------------------------------------------
| PUBLIC ROUND STATE
|--------------------------------------------------------------------------
|
| Never expose:
|
| - Keno future numbers
| - Bingo future numbers
| - Aviator crash point before crash
|
*/

function getPublicRound(gameName) {

    const round =
        rounds[gameName];

    if (!round) {
        return null;
    }

    const now =
        Date.now();

    let remainingSeconds = 0;

    /*
     * BETTING COUNTDOWN
     */
    if (round.status === "BETTING") {

        remainingSeconds =
            Math.max(
                0,
                Math.ceil(
                    (round.bettingEndsAt - now) / 1000
                )
            );
    }

    /*
     * AVIATOR FLYING
     */
    if (gameName === "aviator" &&
        round.status === "FLYING") {

        remainingSeconds = 0;
    }

    const publicRound = {

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
            [...round.drawnNumbers],

        draw:
            [...round.drawnNumbers],

        result:
            round.result,

        multiplier:
            round.multiplier,

        finishedAt:
            round.finishedAt,

        nextRoundAt:
            round.nextRoundAt

    };


    /*
     * AVIATOR
     *
     * Only show the crash point after
     * the flight has crashed.
     */
    if (
        gameName === "aviator" &&
        round.status === "CRASHED"
    ) {

        publicRound.crashPoint =
            round.crashPoint;
    }


    return publicRound;
}


/*
|--------------------------------------------------------------------------
| FINISH ROUND
|--------------------------------------------------------------------------
*/

function finishRound(gameName) {

    const round =
        rounds[gameName];

    if (!round) {
        return;
    }

    if (
        round.status === "FINISHED" ||
        round.status === "CRASHED"
    ) {
        return;
    }


    /*
     * KENO
     *
     * Reveal remaining numbers immediately
     * only if the server is being shut down
     * or the round is being forced.
     *
     * Normal operation uses progressiveDraw().
     */
    if (gameName === "keno") {

        round.status =
            "FINISHED";

        round.finishedAt =
            new Date().toISOString();

        round.nextRoundAt =
            new Date(
                Date.now() + NEXT_ROUND_DELAY
            ).toISOString();

        console.log(
            `[keno] FINISHED ${round.id}`
        );

        scheduleNextRound(
            gameName
        );

        return;
    }


    /*
     * BINGO
     */
    if (gameName === "bingo") {

        round.status =
            "FINISHED";

        round.finishedAt =
            new Date().toISOString();

        round.nextRoundAt =
            new Date(
                Date.now() + NEXT_ROUND_DELAY
            ).toISOString();

        console.log(
            `[bingo] FINISHED ${round.id}`
        );

        scheduleNextRound(
            gameName
        );

        return;
    }


    /*
     * ROULETTE
     */
    if (gameName === "roulette") {

        const result =
            roulette.spin();

        round.result =
            result;

        round.status =
            "FINISHED";

        round.finishedAt =
            new Date().toISOString();

        round.nextRoundAt =
            new Date(
                Date.now() + NEXT_ROUND_DELAY
            ).toISOString();

        console.log(
            `[roulette] ${round.id} result:`,
            result
        );

        scheduleNextRound(
            gameName
        );

        return;
    }
}


/*
|--------------------------------------------------------------------------
| START KENO DRAW
|--------------------------------------------------------------------------
*/

function startKenoDraw(gameName) {

    const round =
        rounds[gameName];

    if (!round) return;

    if (
        round.status !== "BETTING"
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

    console.log(
        `[keno] DRAWING started: ${round.id}`
    );

    revealNextKenoNumber(
        gameName
    );
}


function revealNextKenoNumber(gameName) {

    const round =
        rounds[gameName];

    if (!round) return;

    if (
        round.status !== "DRAWING"
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


    console.log(
        `[keno] ${round.id} DRAW ${round.drawIndex}/${round.totalDraws}: ${number}`
    );


    /*
     * Wait before revealing the next number.
     */
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
| START BINGO DRAW
|--------------------------------------------------------------------------
*/

function startBingoDraw(gameName) {

    const round =
        rounds[gameName];

    if (!round) return;

    if (
        round.status !== "BETTING"
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

    console.log(
        `[bingo] DRAWING started: ${round.id}`
    );

    revealNextBingoNumber(
        gameName
    );
}


function revealNextBingoNumber(gameName) {

    const round =
        rounds[gameName];

    if (!round) return;

    if (
        round.status !== "DRAWING"
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


    console.log(
        `[bingo] ${round.id} DRAW ${round.drawIndex}/${round.totalDraws}: ${number}`
    );


    /*
     * Slow enough for the player to listen
     * and tap their cartela number.
     */
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
| ROULETTE ROUND
|--------------------------------------------------------------------------
*/

function startRouletteSpin() {

    const round =
        rounds.roulette;

    if (!round) return;

    if (
        round.status !== "BETTING"
    ) {
        return;
    }

    round.status =
        "SPINNING";

    console.log(
        `[roulette] SPINNING ${round.id}`
    );


    setTimeout(
        () => {

            if (
                round.status !== "SPINNING"
            ) {
                return;
            }

            const result =
                roulette.spin();

            round.result =
                result;

            round.status =
                "FINISHED";

            round.finishedAt =
                new Date().toISOString();

            round.nextRoundAt =
                new Date(
                    Date.now() +
                    NEXT_ROUND_DELAY
                ).toISOString();

            console.log(
                `[roulette] RESULT ${round.id}:`,
                result
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

    if (!round) return;

    if (
        round.status !== "BETTING"
    ) {
        return;
    }


    round.status =
        "FLYING";

    round.flyingStartedAt =
        Date.now();

    round.multiplier =
        1.00;

    console.log(
        `[aviator] FLYING ${round.id}`
    );

    updateAviator(
        round.id
    );
}


function updateAviator(roundId) {

    const round =
        rounds.aviator;

    if (!round) return;

    if (
        round.id !== roundId
    ) {
        return;
    }

    if (
        round.status !== "FLYING"
    ) {
        return;
    }


    const elapsed =
        (Date.now() -
        round.flyingStartedAt) /
        1000;


    /*
     * Smooth exponential flight.
     *
     * This is only the visual/game
     * progression. The crash point itself
     * was generated by aviator.js.
     */
    const calculatedMultiplier =
        Math.pow(
            1.12,
            elapsed
        );


    const crashPoint =
        round.secretCrashPoint;


    /*
     * Crash condition.
     */
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
            new Date().toISOString();

        round.nextRoundAt =
            new Date(
                Date.now() +
                NEXT_ROUND_DELAY
            ).toISOString();

        console.log(
            `[aviator] CRASH ${round.id} at ${crashPoint.toFixed(2)}x`
        );

        scheduleNextRound(
            "aviator"
        );

        return;
    }


    round.multiplier =
        Number(
            calculatedMultiplier.toFixed(2)
        );


    /*
     * Update approximately 10 times
     * per second.
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
| NEXT ROUND
|--------------------------------------------------------------------------
*/

function scheduleNextRound(gameName) {

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
        () => {

            createGameRound(
                gameName
            );

        },
        NEXT_ROUND_DELAY
    );
}


/*
|--------------------------------------------------------------------------
| MAIN ROUND CONTROLLER
|--------------------------------------------------------------------------
*/

function startGameLoop(gameName) {

    function startNewRound() {

        const round =
            createGameRound(
                gameName
            );


        /*
         * Betting phase.
         */
        setTimeout(
            () => {

                const current =
                    rounds[gameName];

                /*
                 * Make sure this is still
                 * the same round.
                 */
                if (
                    !current ||
                    current.id !== round.id
                ) {
                    return;
                }


                if (
                    current.status !==
                    "BETTING"
                ) {
                    return;
                }


                /*
                 * KENO
                 */
                if (
                    gameName === "keno"
                ) {

                    startKenoDraw(
                        gameName
                    );

                    return;
                }


                /*
                 * BINGO
                 */
                if (
                    gameName === "bingo"
                ) {

                    startBingoDraw(
                        gameName
                    );

                    return;
                }


                /*
                 * ROULETTE
                 */
                if (
                    gameName === "roulette"
                ) {

                    startRouletteSpin();

                    return;
                }


                /*
                 * AVIATOR
                 */
                if (
                    gameName === "aviator"
                ) {

                    startAviatorFlight();

                    return;
                }

            },
            round.bettingSeconds * 1000
        );
    }


    /*
     * Start first round immediately.
     */
    startNewRound();


    /*
     * The next rounds are normally
     * scheduled by the round itself.
     *
     * This watcher makes sure a game
     * cannot remain stuck if a transition
     * unexpectedly fails.
     */
    setInterval(
        () => {

            if (
                !rounds[gameName]
            ) {

                startNewRound();

            }

        },
        5000
    );
}


/*
|--------------------------------------------------------------------------
| HOME
|--------------------------------------------------------------------------
*/

app.get(
    "/",
    (req, res) => {

        /*
         * If public/index.html exists,
         * express.static() normally serves it.
         *
         * This JSON route is only used if
         * no index.html is found.
         */

        res.json({

            success: true,

            app:
                "DESTA PLAY",

            status:
                "online",

            games:
                Object.keys(games)

        });

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
                new Date().toISOString(),

            serverTimestamp:
                Date.now(),

            games:
                gameState

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
| UNIVERSAL CURRENT ROUND
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

                    success:
                        false,

                    error:
                        "Game not found"

                });

        }


        if (
            !rounds[gameName]
        ) {

            createGameRound(
                gameName
            );

        }


        res.json({

            success:
                true,

            serverTime:
                new Date().toISOString(),

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
| KENO
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

                success:
                    true,

                selection

            });

        } catch (error) {

            res
                .status(400)
                .json({

                    success:
                        false,

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

                        success:
                            false,

                        error:
                            "Cartela number must be between 1 and 120"

                    });

            }


            const cartela =
                bingo.generateCartela(
                    number
                );


            res.json({

                success:
                    true,

                cartela

            });

        } catch (error) {

            res
                .status(400)
                .json({

                    success:
                        false,

                    error:
                        error.message

                });

        }

    }
);


/*
|--------------------------------------------------------------------------
| BINGO WIN CHECK
|--------------------------------------------------------------------------
|
| The frontend can submit the player's
| current cartela and the numbers that
| have actually been called.
|
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
                !Array.isArray(calledNumbers)
            ) {

                return res
                    .status(400)
                    .json({

                        success:
                            false,

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

                success:
                    true,

                winning

            });

        } catch (error) {

            res
                .status(400)
                .json({

                    success:
                        false,

                    error:
                        error.message

                });

        }

    }
);


/*
|--------------------------------------------------------------------------
| ROULETTE ROUND
|--------------------------------------------------------------------------
*/

app.get(
    "/api/roulette/round",
    (req, res) => {

        if (
            !rounds.roulette
        ) {

            createGameRound(
                "roulette"
            );

        }


        res.json({

            success:
                true,

            serverTime:
                new Date().toISOString(),

            serverTimestamp:
                Date.now(),

            round:
                getPublicRound(
                    "roulette"
                )

        });

    }
);


/*
|--------------------------------------------------------------------------
| AVIATOR ROUND
|--------------------------------------------------------------------------
*/

app.get(
    "/api/aviator/round",
    (req, res) => {

        if (
            !rounds.aviator
        ) {

            createGameRound(
                "aviator"
            );

        }


        res.json({

            success:
                true,

            serverTime:
                new Date().toISOString(),

            serverTimestamp:
                Date.now(),

            round:
                getPublicRound(
                    "aviator"
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

            success:
                true,

            status:
                "healthy",

            timestamp:
                new Date().toISOString()

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

                success:
                    false,

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

                success:
                    false,

                error:
                    "Internal server error"

            });

    }
);


/*
|--------------------------------------------------------------------------
| START GAME LOOPS
|--------------------------------------------------------------------------
*/

for (
    const gameName
    of Object.keys(games)
) {

    startGameLoop(
        gameName
    );

}


/*
|--------------------------------------------------------------------------
| START SERVER
|--------------------------------------------------------------------------
*/

app.listen(
    PORT,
    "0.0.0.0",
    () => {

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
            "Automatic rounds: ENABLED"
        );

        console.log(
            "Live API state: ENABLED"
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

    }
);u
