const express = require("express");
const cors = require("cors");

const keno = require("./games/keno");
const bingo = require("./games/bingo");
const aviator = require("./games/aviator");
// If you already created roulette.js, keep this.
// If you have not created it yet, comment the next line
// and the roulette section below.
const roulette = require("./games/roulette");

const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 10000;


/* =========================================================
   GAME CONFIGURATION
========================================================= */

const games = {
    keno,
    bingo,
    roulette,
    aviator
};


/* =========================================================
   CURRENT ROUND STORAGE
========================================================= */

const rounds = {};


/* =========================================================
   ROUND CREATION
========================================================= */

function createGameRound(gameName) {

    const game = games[gameName];

    if (!game) {
        throw new Error(
            `Unknown game: ${gameName}`
        );
    }

    const round = game.createRound();

    round.id =
        `${gameName}-${Date.now()}-${Math.floor(
            Math.random() * 100000
        )}`;

    round.startedAt =
        new Date().toISOString();

    round.status = "BETTING";

    rounds[gameName] = round;

    console.log(
        `[${gameName}] New round: ${round.id}`
    );

    return round;
}


/* =========================================================
   ROUND FINISHING
========================================================= */

function finishGameRound(gameName) {

    const game =
        games[gameName];

    const currentRound =
        rounds[gameName];

    if (!game || !currentRound) {
        return;
    }

    if (
        currentRound.status === "FINISHED"
    ) {
        return;
    }


    /* -----------------------------------------------------
       KENO
       Exactly 20 unique numbers from 1–80.
    ----------------------------------------------------- */

    if (
        gameName === "keno"
    ) {

        const drawnNumbers =
            game.createDraw();

        currentRound.status =
            "FINISHED";

        currentRound.drawnNumbers =
            drawnNumbers;

        currentRound.finishedAt =
            new Date().toISOString();

        console.log(
            `[keno] Round ${currentRound.id} finished`
        );

        console.log(
            `[keno] Draw: ${drawnNumbers.join(", ")}`
        );

        return;
    }


    /* -----------------------------------------------------
       BINGO
       Generate automatic draw order.
    ----------------------------------------------------- */

    if (
        gameName === "bingo"
    ) {

        const draw =
            game.generateDrawOrder();

        currentRound.status =
            "FINISHED";

        currentRound.draw =
            draw;

        currentRound.finishedAt =
            new Date().toISOString();

        console.log(
            `[bingo] Round ${currentRound.id} finished`
        );

        return;
    }


    /* -----------------------------------------------------
       ROULETTE
    ----------------------------------------------------- */

    if (
        gameName === "roulette"
    ) {

        const result =
            game.spin();

        currentRound.status =
            "FINISHED";

        currentRound.result =
            result;

        currentRound.finishedAt =
            new Date().toISOString();

        console.log(
            `[roulette] Round ${currentRound.id} finished`
        );

        return;
    }


    /* -----------------------------------------------------
       AVIATOR
    ----------------------------------------------------- */

    if (
        gameName === "aviator"
    ) {

        const crashPoint =
            game.generateCrashPoint();

        currentRound.status =
            "FINISHED";

        currentRound.crashPoint =
            crashPoint;

        currentRound.finishedAt =
            new Date().toISOString();

        console.log(
            `[aviator] Round ${currentRound.id} finished`
        );

        return;
    }

}


/* =========================================================
   AUTOMATIC ROUND LOOP
========================================================= */

function startGameLoop(
    gameName
) {

    const game =
        games[gameName];

    if (!game) {
        console.error(
            `Cannot start loop for ${gameName}`
        );
        return;
    }


    function runRound() {

        const round =
            createGameRound(
                gameName
            );

        const bettingSeconds =
            Number(
                round.bettingSeconds
            );


        if (
            !Number.isFinite(
                bettingSeconds
            ) ||
            bettingSeconds <= 0
        ) {

            console.error(
                `[${gameName}] Invalid bettingSeconds`
            );

            return;
        }


        console.log(
            `[${gameName}] Betting open for ${bettingSeconds}s`
        );


        setTimeout(
            () => {

                finishGameRound(
                    gameName
                );


                /*
                 * Small delay before the next
                 * round starts.
                 *
                 * This prevents two rounds from
                 * being created at exactly the
                 * same millisecond.
                 */

                setTimeout(
                    runRound,
                    1000
                );

            },
            bettingSeconds * 1000
        );

    }


    runRound();

}


/* =========================================================
   ROOT
========================================================= */

app.get(
    "/",
    (req, res) => {

        res.json({

            success: true,

            app: "DESTA PLAY",

            status: "online",

            games:
                Object.keys(games)

        });

    }
);


/* =========================================================
   SERVER STATUS
========================================================= */

app.get(
    "/api/status",
    (req, res) => {

        res.json({

            success: true,

            status: "online",

            games:
                Object.keys(games),

            time:
                new Date().toISOString()

        });

    }
);


/* =========================================================
   GAME INFORMATION
========================================================= */

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
                        bingo.BINGO_NUMBERS

                },


                roulette: {

                    bettingSeconds:
                        roulette.BETTING_SECONDS

                },


                aviator: {

                    bettingSeconds:
                        aviator.BETTING_SECONDS

                }

            }

        });

    }
);


/* =========================================================
   CURRENT ROUND
========================================================= */

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


        if (
            !rounds[gameName]
        ) {

            createGameRound(
                gameName
            );

        }


        const round =
            rounds[gameName];


        /*
         * Do not expose hidden future
         * results while betting is open.
         */

        const publicRound = {
            id: round.id,

            game: round.game,

            status: round.status,

            bettingSeconds:
                round.bettingSeconds,

            startedAt:
                round.startedAt,

            createdAt:
                round.createdAt
        };


        /*
         * Only expose the result after
         * the round has finished.
         */

        if (
            round.status ===
            "FINISHED"
        ) {

            if (
                gameName === "keno"
            ) {

                publicRound.drawnNumbers =
                    round.drawnNumbers;

            }


            if (
                gameName === "bingo"
            ) {

                publicRound.draw =
                    round.draw;

            }


            if (
                gameName === "roulette"
            ) {

                publicRound.result =
                    round.result;

            }


            if (
                gameName === "aviator"
            ) {

                publicRound.crashPoint =
                    round.crashPoint;

            }

            publicRound.finishedAt =
                round.finishedAt;

        }


        res.json({

            success: true,

            round:
                publicRound

        });

    }
);


/* =========================================================
   KENO SELECTION VALIDATION
========================================================= */

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


/* =========================================================
   KENO — NO PLAYER DRAW ROUTE
=========================================================

   IMPORTANT:
   There is deliberately NO:

   POST /api/keno/test-draw

   The server automatically creates the draw
   when the betting timer expires.
========================================================= */


/* =========================================================
   BINGO CARTELA
========================================================= */

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


            /*
             * IMPORTANT:
             * This calls the cartela engine
             * with the player's requested
             * cartela number.
             *
             * The same number must always
             * return the same configuration.
             */

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


/* =========================================================
   BINGO — NO PLAYER DRAW ROUTE
=========================================================

   The bingo draw is controlled by the
   automatic round engine above.
========================================================= */


/* =========================================================
   ROULETTE
========================================================= */

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

            success: true,

            round:
                rounds.roulette

        });

    }
);


/* =========================================================
   AVIATOR
========================================================= */

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

            success: true,

            round:
                rounds.aviator

        });

    }
);


/* =========================================================
   ERROR HANDLER
========================================================= */

app.use(
    (error, req, res, next) => {

        console.error(
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


/* =========================================================
   START AUTOMATIC GAME LOOPS
========================================================= */

for (
    const gameName
    of Object.keys(games)
) {

    startGameLoop(
        gameName
    );

}


/* =========================================================
   START SERVER
========================================================= */

app.listen(
    PORT,
    "0.0.0.0",
    () => {

        console.log(
            `DESTA PLAY backend running on port ${PORT}`
        );

        console.log(
            "Automatic game rounds started:"
        );

        for (
            const gameName
            of Object.keys(games)
        ) {

            console.log(
                ` - ${gameName}`
            );

        }

    }
);
