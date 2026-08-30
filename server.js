const express = require("express");
const cors = require("cors");

const keno = require("./games/keno");
const bingo = require("./games/bingo");
const spin = require("./games/spin");
const aviator = require("./games/aviator");

const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 10000;

const games = {
    keno,
    bingo,
    spin,
    aviator
};

const rounds = {};

function createGameRound(gameName) {
    const game = games[gameName];

    if (!game) {
        throw new Error("Unknown game");
    }

    const round = game.createRound();

    round.id =
        `${gameName}-${Date.now()}-${Math.floor(Math.random() * 100000)}`;

    round.startedAt = new Date().toISOString();

    rounds[gameName] = round;

    return round;
}

function startAllRounds() {
    for (const gameName of Object.keys(games)) {
        createGameRound(gameName);
    }
}

app.get("/", (req, res) => {
    res.json({
        success: true,
        app: "DESTA PLAY",
        status: "online"
    });
});

app.get("/api/status", (req, res) => {
    res.json({
        success: true,
        status: "online",
        games: Object.keys(games),
        time: new Date().toISOString()
    });
});

app.get("/api/games", (req, res) => {
    res.json({
        success: true,
        games: {
            keno: {
                bettingSeconds: keno.BETTING_SECONDS,
                numbers: "1-80",
                maxSelections: keno.MAX_PLAYER_SELECTIONS,
                maxDraw: keno.MAX_DRAWN_NUMBERS
            },

            bingo: {
                bettingSeconds: bingo.BETTING_SECONDS,
                numbers: bingo.BINGO_NUMBERS
            },

            spin: {
                bettingSeconds: spin.BETTING_SECONDS
            },

            aviator: {
                bettingSeconds: aviator.BETTING_SECONDS
            }
        }
    });
});

app.get("/api/game/:game/round", (req, res) => {
    const gameName = req.params.game;

    if (!games[gameName]) {
        return res.status(404).json({
            success: false,
            error: "Game not found"
        });
    }

    if (!rounds[gameName]) {
        createGameRound(gameName);
    }

    res.json({
        success: true,
        round: rounds[gameName]
    });
});

app.post("/api/keno/validate-selection", (req, res) => {
    try {
        const selection = keno.validateSelection(
            req.body.selection
        );

        res.json({
            success: true,
            selection
        });

    } catch (error) {
        res.status(400).json({
            success: false,
            error: error.message
        });
    }
});

app.post("/api/keno/test-draw", (req, res) => {
    const result = keno.finishRound();

    res.json({
        success: true,
        result
    });
});

app.post("/api/bingo/cartela", (req, res) => {
    const cartela = bingo.generateCartela();

    res.json({
        success: true,
        cartela
    });
});

app.post("/api/bingo/test-draw", (req, res) => {
    const draw = bingo.generateDrawOrder();

    res.json({
        success: true,
        draw
    });
});

app.post("/api/spin/test", (req, res) => {
    res.json({
        success: true,
        result: spin.spin()
    });
});

app.post("/api/aviator/test", (req, res) => {
    res.json({
        success: true,
        result: aviator.generateCrashPoint()
    });
});

startAllRounds();

app.listen(PORT, "0.0.0.0", () => {
    console.log(
        `DESTA PLAY backend running on port ${PORT}`
    );
});
