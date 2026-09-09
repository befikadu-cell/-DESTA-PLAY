// ============================================================================
// DESTA PLAY — SERVER-AUTHORITATIVE GAME ENGINE
// ============================================================================
//
// Games / Editions:
//   1. Bingo
//   2. Bingo 75
//   3. Bingo 90
//   4. Keno
//
// Rules:
//   - Server controls rounds and official draws.
//   - Client cannot decide winners.
//   - PLACE BET is the only action that accepts a selection.
//   - Bingo claims are independently verified by the server.
//   - Keno scores are calculated by the server.
//   - Keno: 60% first / 30% second / 10% house.
//   - Tie for first: entire 90% winner pool is split.
//   - Tie for second: 30% second-place pool is split.
//   - No third-place payout.
//
// IMPORTANT:
// The Maps below are temporary engine storage.
// They MUST NOT replace the existing permanent Supabase ledger.
//
// For real-money production, connect:
//   balance check -> atomic debit -> accepted bet -> ledger
//   and settlement -> ledger -> balance credit
// using the existing permanent database.
//
// NEVER drop, recreate, wipe, or replace the permanent database.
// ============================================================================

import express from "express";
import cors from "cors";
import crypto from "node:crypto";

const app = express();

const PORT = Number(process.env.PORT || 10000);

app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.static("."));

// ============================================================================
// GAME CONFIGURATION
// ============================================================================

const GAMES = {
  bingo: {
    name: "Bingo",
    edition: "bingo",
    bettingSeconds: 30,
    maxCards: 2,
    drawCount: 75
  },

  bingo75: {
    name: "Bingo 75",
    edition: "bingo75",
    bettingSeconds: 30,
    maxCards: 2,
    drawCount: 75
  },

  bingo90: {
    name: "Bingo 90",
    edition: "bingo90",
    bettingSeconds: 30,
    maxCards: 2,
    drawCount: 90
  },

  keno: {
    name: "Keno",
    edition: "keno",
    bettingSeconds: 40,
    maxSlots: 2,
    drawCount: 20
  }
};

// ============================================================================
// OFFICIAL DESTA PLAY STAKES
// ============================================================================
//
// 10 -> 100 by 10
// 100 -> 1000 by 50
//
// No amount input is required from the player.
// The frontend must use this exact list.
//
// ============================================================================

const STAKES = [
  10,
  20,
  30,
  40,
  50,
  60,
  70,
  80,
  90,
  100,
  150,
  200,
  250,
  300,
  350,
  400,
  450,
  500,
  550,
  600,
  650,
  700,
  750,
  800,
  850,
  900,
  950,
  1000
];

function validStake(value) {
  const amount = Number(value);

  return STAKES.includes(amount)
    ? amount
    : null;
}

// ============================================================================
// TEMPORARY ENGINE STORAGE
// ============================================================================
//
// These Maps allow the frontend/game engine to be tested.
//
// PRODUCTION:
// Replace these persistence operations with transactions/RPCs against the
// existing permanent Supabase database.
//
// ============================================================================

const rounds = new Map();

const bets = new Map();

const claims = new Set();

// ============================================================================
// GENERAL HELPERS
// ============================================================================

function createId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function currentTime() {
  return Date.now();
}

function unique(values) {
  return [...new Set(values)];
}

// Cryptographically stronger shuffle for official server draw order.
function secureShuffle(values) {
  const array = [...values];

  for (let i = array.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);

    const temp = array[i];

    array[i] = array[j];

    array[j] = temp;
  }

  return array;
}

function validNumberArray(
  values,
  min,
  max,
  minCount,
  maxCount
) {
  if (!Array.isArray(values)) {
    return false;
  }

  if (
    values.length < minCount ||
    values.length > maxCount
  ) {
    return false;
  }

  if (
    values.some(
      n =>
        !Number.isInteger(n) ||
        n < min ||
        n > max
    )
  ) {
    return false;
  }

  return unique(values).length === values.length;
}

// ============================================================================
// ROUND CREATION
// ============================================================================

function createRound(game) {
  const config = GAMES[game];

  const createdAt = currentTime();

  let drawPool;

  // --------------------------------------------------------------------------
  // KENO
  // --------------------------------------------------------------------------

  if (game === "keno") {

    // Keno draws 20 unique numbers from 1-80.

    drawPool = secureShuffle(
      Array.from(
        { length: 80 },
        (_, index) => index + 1
      )
    ).slice(0, 20);

  }

  // --------------------------------------------------------------------------
  // BINGO
  // --------------------------------------------------------------------------

  else {

    // Bingo editions use their appropriate ball range.

    drawPool = secureShuffle(
      Array.from(
        { length: config.drawCount },
        (_, index) => index + 1
      )
    );
  }

  return {
    id: createId("round"),

    game,

    edition: config.edition,

    status: "BETTING",

    createdAt,

    bettingEndsAt:
      createdAt +
      config.bettingSeconds * 1000,

    drawStartedAt: null,

    finishedAt: null,

    drawIndex: 0,

    draw: [],

    drawPool,

    settled: false
  };
}

// ============================================================================
// GET OR CREATE CURRENT ROUND
// ============================================================================

function getRound(game) {

  if (!GAMES[game]) {
    return null;
  }

  let round = rounds.get(game);

  if (
    !round ||
    round.status === "FINISHED"
  ) {

    round = createRound(game);

    rounds.set(
      game,
      round
    );
  }

  return round;
}

// ============================================================================
// PUBLIC ROUND DATA
// ============================================================================

function publicRound(round) {

  return {

    id:
      round.id,

    game:
      round.game,

    edition:
      round.edition,

    status:
      round.status,

    createdAt:
      round.createdAt,

    bettingEndsAt:
      round.bettingEndsAt,

    drawStartedAt:
      round.drawStartedAt,

    finishedAt:
      round.finishedAt,

    drawIndex:
      round.drawIndex,

    drawnNumbers:
      [...round.draw],

    secondsRemaining:
      round.status === "BETTING"
        ? Math.max(
            0,
            Math.ceil(
              (
                round.bettingEndsAt -
                currentTime()
              ) / 1000
            )
          )
        : 0
  };
}

// ============================================================================
// BINGO 75 VALIDATION
// ============================================================================
//
// Standard structure:
//
//       B   I   N   G   O
//
//       5   5   5   5   5
//
// Center N cell = FREE.
//
// ============================================================================

function validateBingo75Card(card) {

  if (!Array.isArray(card)) {
    return false;
  }

  if (card.length !== 5) {
    return false;
  }

  if (
    card.some(
      row =>
        !Array.isArray(row) ||
        row.length !== 5
    )
  ) {
    return false;
  }

  const seen = new Set();

  for (
    let row = 0;
    row < 5;
    row++
  ) {

    for (
      let column = 0;
      column < 5;
      column++
    ) {

      // Center FREE cell.
      if (
        row === 2 &&
        column === 2
      ) {
        continue;
      }

      const number =
        Number(
          card[row][column]
        );

      if (
        !Number.isInteger(number) ||
        number < 1 ||
        number > 75
      ) {
        return false;
      }

      if (seen.has(number)) {
        return false;
      }

      seen.add(number);
    }
  }

  return seen.size === 24;
}

// ============================================================================
// BINGO 75 MARKING
// ============================================================================

function bingo75Marked(
  card,
  drawnNumbers
) {

  const drawn =
    new Set(drawnNumbers);

  return card.map(
    (row, rowIndex) =>
      row.map(
        (value, columnIndex) => {

          // FREE center.
          if (
            rowIndex === 2 &&
            columnIndex === 2
          ) {
            return true;
          }

          return drawn.has(
            Number(value)
          );
        }
      )
  );
}

// ============================================================================
// BINGO 75 HORIZONTAL / VERTICAL / DIAGONAL
// ============================================================================

function has5x5BingoPattern(marked) {

  // Horizontal

  for (
    let row = 0;
    row < 5;
    row++
  ) {

    if (
      marked[row].every(Boolean)
    ) {
      return true;
    }
  }

  // Vertical

  for (
    let column = 0;
    column < 5;
    column++
  ) {

    let complete = true;

    for (
      let row = 0;
      row < 5;
      row++
    ) {

      if (
        !marked[row][column]
      ) {

        complete = false;

        break;
      }
    }

    if (complete) {
      return true;
    }
  }

  // Main diagonal

  let diagonalOne = true;

  for (
    let index = 0;
    index < 5;
    index++
  ) {

    if (
      !marked[index][index]
    ) {

      diagonalOne = false;

      break;
    }
  }

  if (diagonalOne) {
    return true;
  }

  // Reverse diagonal

  let diagonalTwo = true;

  for (
    let index = 0;
    index < 5;
    index++
  ) {

    if (
      !marked[index][4 - index]
    ) {

      diagonalTwo = false;

      break;
    }
  }

  return diagonalTwo;
}

// ============================================================================
// BINGO 90 VALIDATION
// ============================================================================
//
// Standard Bingo 90 ticket:
//
// 3 rows x 9 columns
// 5 numbers per row
// 15 numbers total
// Blank cells allowed.
//
// ============================================================================

function validateBingo90Card(card) {

  if (!Array.isArray(card)) {
    return false;
  }

  if (card.length !== 3) {
    return false;
  }

  if (
    card.some(
      row =>
        !Array.isArray(row) ||
        row.length !== 9
    )
  ) {
    return false;
  }

  const seen = new Set();

  for (const row of card) {

    let numberCount = 0;

    for (const value of row) {

      // Blank cell.

      if (
        value === null ||
        value === 0 ||
        value === ""
      ) {
        continue;
      }

      const number =
        Number(value);

      if (
        !Number.isInteger(number) ||
        number < 1 ||
        number > 90
      ) {
        return false;
      }

      if (seen.has(number)) {
        return false;
      }

      seen.add(number);

      numberCount++;
    }

    // Every row has exactly 5 numbers.

    if (numberCount !== 5) {
      return false;
    }
  }

  // 3 x 5 = 15 total numbers.

  return seen.size === 15;
}

// ============================================================================
// BINGO 90 MARKING
// ============================================================================

function bingo90Marked(
  card,
  drawnNumbers
) {

  const drawn =
    new Set(drawnNumbers);

  return card.map(
    row =>
      row.map(
        value => {

          // Blank cells do not block a row.

          if (
            value === null ||
            value === 0 ||
            value === ""
          ) {
            return true;
          }

          return drawn.has(
            Number(value)
          );
        }
      )
  );
}

// ============================================================================
// BINGO 90 PATTERN
// ============================================================================
//
// Horizontal, vertical and diagonal verification.
//
// ============================================================================

function hasBingo90Pattern(marked) {

  // Horizontal

  for (
    let row = 0;
    row < 3;
    row++
  ) {

    if (
      marked[row].every(Boolean)
    ) {
      return true;
    }
  }

  // Vertical

  for (
    let column = 0;
    column < 9;
    column++
  ) {

    if (
      marked[0][column] &&
      marked[1][column] &&
      marked[2][column]
    ) {
      return true;
    }
  }

  // Diagonal

  for (
    let column = 0;
    column <= 6;
    column++
  ) {

    if (
      marked[0][column] &&
      marked[1][column + 1] &&
      marked[2][column + 2]
    ) {
      return true;
    }

    if (
      marked[2][column] &&
      marked[1][column + 1] &&
      marked[0][column + 2]
    ) {
      return true;
    }
  }

  return false;
}

// ============================================================================
// KENO
// ============================================================================
//
// Numbers:
//   1-80
//
// Draw:
//   20 unique numbers
//
// Each slot:
//   3-10 unique numbers
//
// Player may use:
//   1 or 2 slots
//
// Final score:
//   highest match count among the player's slots.
//
// ============================================================================

function kenoScore(
  selection,
  drawnNumbers
) {

  const drawn =
    new Set(drawnNumbers);

  let matches = 0;

  for (
    const number of selection
  ) {

    if (
      drawn.has(number)
    ) {
      matches++;
    }
  }

  return matches;
}

// ============================================================================
// KENO PAYOUT CALCULATION
// ============================================================================
//
// Normal:
//
//   1st = 60%
//   2nd = 30%
//   House = 10%
//
// If two or more players tie for first:
//
//   Entire 90% winner pool is split equally.
//
// If first is clear and second is tied:
//
//   First = 60%
//   Second pool = 30% split
//
// No third-place payout.
//
// ============================================================================

function calculateKenoPayouts(
  entries,
  totalPool
) {

  if (
    !entries.length ||
    totalPool <= 0
  ) {
    return [];
  }

  const ranked =
    [...entries].sort(
      (a, b) =>
        b.score - a.score
    );

  const firstScore =
    ranked[0].score;

  const firstPlace =
    ranked.filter(
      entry =>
        entry.score ===
        firstScore
    );

  // --------------------------------------------------------------------------
  // TIE FOR FIRST
  // --------------------------------------------------------------------------

  if (
    firstPlace.length > 1
  ) {

    const payout =
      (
        totalPool * 0.90
      ) /
      firstPlace.length;

    return firstPlace.map(
      entry => ({

        ...entry,

        rank: 1,

        percentage:
          90 /
          firstPlace.length,

        payout
      })
    );
  }

  // --------------------------------------------------------------------------
  // CLEAR FIRST
  // --------------------------------------------------------------------------

  const result = [

    {

      ...ranked[0],

      rank: 1,

      percentage: 60,

      payout:
        totalPool * 0.60
    }

  ];

  // --------------------------------------------------------------------------
  // FIND SECOND SCORE
  // --------------------------------------------------------------------------

  const secondEntry =
    ranked.find(
      entry =>
        entry.score <
        firstScore
    );

  if (!secondEntry) {
    return result;
  }

  const secondScore =
    secondEntry.score;

  const secondPlace =
    ranked.filter(
      entry =>
        entry.score ===
        secondScore
    );

  const secondPayout =
    (
      totalPool * 0.30
    ) /
    secondPlace.length;

  for (
    const entry of secondPlace
  ) {

    result.push({

      ...entry,

      rank: 2,

      percentage:
        30 /
        secondPlace.length,

      payout:
        secondPayout
    });
  }

  return result;
}

// ============================================================================
// ROUND SUPERVISOR
// ============================================================================
//
// Every second:
//
// BETTING
//   ↓
// DRAWING
//   ↓
// FINISHED
//
// The server controls the draw.
//
// ============================================================================

function advanceRound(round) {

  // --------------------------------------------------------------------------
  // BETTING -> DRAWING
  // --------------------------------------------------------------------------

  if (
    round.status === "BETTING" &&
    currentTime() >=
      round.bettingEndsAt
  ) {

    round.status = "DRAWING";

    round.drawStartedAt =
      currentTime();
  }

  if (
    round.status !== "DRAWING"
  ) {
    return;
  }

  // --------------------------------------------------------------------------
  // KENO
  // --------------------------------------------------------------------------

  if (
    round.game === "keno"
  ) {

    if (
      round.drawIndex < 20
    ) {

      round.draw.push(
        round.drawPool[
          round.drawIndex
        ]
      );

      round.drawIndex++;
    }

    if (
      round.drawIndex >= 20
    ) {

      round.status =
        "FINISHED";

      round.finishedAt =
        currentTime();
    }

    return;
  }

  // --------------------------------------------------------------------------
  // BINGO
  // --------------------------------------------------------------------------

  if (
    round.drawIndex <
    round.drawPool.length
  ) {

    round.draw.push(
      round.drawPool[
        round.drawIndex
      ]
    );

    round.drawIndex++;
  }

  if (
    round.drawIndex >=
    round.drawPool.length
  ) {

    round.status =
      "FINISHED";

    round.finishedAt =
      currentTime();
  }
}

// Run the server round engine.

setInterval(
  () => {

    for (
      const round of rounds.values()
    ) {

      advanceRound(round);
    }

  },
  1000
);

// ============================================================================
// HEALTH
// ============================================================================

app.get(
  "/api/health",
  (_req, res) => {

    res.json({

      ok: true,

      service:
        "DESTA PLAY",

      engine:
        "server-authoritative",

      time:
        new Date().toISOString()
    });
  }
);

// ============================================================================
// AVAILABLE GAMES / EDITIONS
// ============================================================================

app.get(
  "/api/games",
  (_req, res) => {

    res.json({

      games:
        Object.entries(
          GAMES
        ).map(
          ([id, config]) => ({

            id,

            name:
              config.name,

            edition:
              config.edition,

            bettingSeconds:
              config.bettingSeconds,

            maxCards:
              config.maxCards,

            maxSlots:
              config.maxSlots,

            drawCount:
              config.drawCount
          })
        ),

      stakes:
        [...STAKES]
    });
  }
);

// ============================================================================
// STAKES
// ============================================================================

app.get(
  "/api/stakes",
  (_req, res) => {

    res.json({

      ok: true,

      stakes:
        [...STAKES]
    });
  }
);

// ============================================================================
// CURRENT ROUND
// ============================================================================

app.get(
  "/api/game/:game/round",
  (req, res) => {

    const {
      game
    } = req.params;

    const round =
      getRound(game);

    if (!round) {

      return res
        .status(404)
        .json({

          error:
            "Unknown game"
        });
    }

    res.json({

      round:
        publicRound(round)
    });
  }
);

// ============================================================================
// PLACE BET
// ============================================================================
//
// Entering the game does NOT deduct money.
//
// Selecting a stake does NOT deduct money.
//
// Selecting cards/numbers does NOT deduct money.
//
// ONLY this endpoint represents an accepted PLACE BET.
//
// Production version must atomically:
//
//   1. Authenticate player
//   2. Verify balance
//   3. Debit wallet
//   4. Create accepted bet
//   5. Create ledger record
//
// ============================================================================

app.post(
  "/api/game/:game/bet",
  (req, res) => {

    const {
      game
    } = req.params;

    const {
      playerId,
      stake,
      cards,
      slots
    } = req.body || {};

    // --------------------------------------------------------------------------
    // GAME CHECK
    // --------------------------------------------------------------------------

    if (!GAMES[game]) {

      return res
        .status(404)
        .json({

          error:
            "Unknown game"
        });
    }

    // --------------------------------------------------------------------------
    // PLAYER CHECK
    // --------------------------------------------------------------------------

    if (!playerId) {

      return res
        .status(400)
        .json({

          error:
            "playerId is required"
        });
    }

    // --------------------------------------------------------------------------
    // EXACT STAKE CHECK
    // --------------------------------------------------------------------------

    const amount =
      validStake(stake);

    if (amount === null) {

      return res
        .status(400)
        .json({

          error:
            "Invalid stake. Select an available DESTA PLAY stake."
        });
    }

    const round =
      getRound(game);

    // --------------------------------------------------------------------------
    // BETTING DEADLINE
    // --------------------------------------------------------------------------

    if (
      round.status !== "BETTING" ||
      currentTime() >=
        round.bettingEndsAt
    ) {

      return res
        .status(409)
        .json({

          error:
            "Betting is closed"
        });
    }

    // --------------------------------------------------------------------------
    // DUPLICATE PROTECTION
    // --------------------------------------------------------------------------

    const betKey =
      `${round.id}:${playerId}`;

    if (
      bets.has(betKey)
    ) {

      return res
        .status(409)
        .json({

          error:
            "Bet already accepted for this round"
        });
    }

    let normalized;

    try {

      // ========================================================================
      // BINGO
      // ========================================================================

      if (
        game === "bingo"
      ) {

        if (
          !Array.isArray(cards) ||
          cards.length < 1 ||
          cards.length > 2
        ) {

          throw new Error(
            "Select 1 or 2 Bingo cartellas"
          );
        }

        normalized =
          cards.map(
            card => {

              if (
                !validateBingo75Card(
                  card
                )
              ) {

                throw new Error(
                  "Invalid Bingo cartella"
                );
              }

              return card;
            }
          );
      }

      // ========================================================================
      // BINGO 75
      // ========================================================================

      else if (
        game === "bingo75"
      ) {

        if (
          !Array.isArray(cards) ||
          cards.length < 1 ||
          cards.length > 2
        ) {

          throw new Error(
            "Select 1 or 2 Bingo 75 cartellas"
          );
        }

        normalized =
          cards.map(
            card => {

              if (
                !validateBingo75Card(
                  card
                )
              ) {

                throw new Error(
                  "Invalid Bingo 75 cartella"
                );
              }

              return card;
            }
          );
      }

      // ========================================================================
      // BINGO 90
      // ========================================================================

      else if (
        game === "bingo90"
      ) {

        if (
          !Array.isArray(cards) ||
          cards.length < 1 ||
          cards.length > 2
        ) {

          throw new Error(
            "Select 1 or 2 Bingo 90 cartellas"
          );
        }

        normalized =
          cards.map(
            card => {

              if (
                !validateBingo90Card(
                  card
                )
              ) {

                throw new Error(
                  "Invalid Bingo 90 cartella"
                );
              }

              return card;
            }
          );
      }

      // ========================================================================
      // KENO
      // ========================================================================

      else if (
        game === "keno"
      ) {

        if (
          !Array.isArray(slots) ||
          slots.length < 1 ||
          slots.length > 2
        ) {

          throw new Error(
            "Select 1 or 2 Keno slots"
          );
        }

        normalized =
          slots.map(
            slot => {

              if (
                !validNumberArray(
                  slot,
                  1,
                  80,
                  3,
                  10
                )
              ) {

                throw new Error(
                  "Each Keno slot needs 3-10 unique numbers from 1-80"
                );
              }

              return [...slot];
            }
          );
      }

      // ========================================================================
      // SAFETY
      // ========================================================================

      else {

        throw new Error(
          "Unsupported game edition"
        );
      }

    } catch (error) {

      return res
        .status(400)
        .json({

          error:
            error.message
        });
    }

    // ========================================================================
    // PRODUCTION DATABASE INTEGRATION POINT
    // ========================================================================
    //
    // Replace the temporary Map operation below with an atomic Supabase
    // transaction/RPC against the existing permanent database.
    //
    // DO NOT trust the client balance.
    // DO NOT deduct money twice.
    // DO NOT accept a bet after the deadline.
    //
    // ========================================================================

    const bet = {

      id:
        createId("bet"),

      roundId:
        round.id,

      game,

      edition:
        GAMES[game].edition,

      playerId:
        String(playerId),

      stake:
        amount,

      cards:
        game === "keno"
          ? undefined
          : normalized,

      slots:
        game === "keno"
          ? normalized
          : undefined,

      acceptedAt:
        currentTime(),

      status:
        "ACCEPTED"
    };

    bets.set(
      betKey,
      bet
    );

    return res
      .status(201)
      .json({

        ok: true,

        message:
          "PLACE BET accepted",

        bet: {

          id:
            bet.id,

          roundId:
            bet.roundId,

          game:
            bet.game,

          edition:
            bet.edition,

          stake:
            bet.stake,

          status:
            bet.status,

          acceptedAt:
            bet.acceptedAt
        },

        round:
          publicRound(round)
      });
  }
);

// ============================================================================
// BINGO CLAIM
// ============================================================================
//
// Player presses BINGO.
//
// Server checks:
//
//   - correct game
//   - correct round
//   - round is drawing
//   - player identity
//   - accepted bet
//   - exact bet ID
//   - exact card
//   - card ownership
//   - card contents
//   - official draw history
//   - pattern
//   - duplicate claim
//
// Client NEVER tells the server "I won."
// Client only submits a claim.
//
// ============================================================================

app.post(
  "/api/game/:game/bingo-claim",
  (req, res) => {

    const {
      game
    } = req.params;

    const {
      playerId,
      betId,
      cardIndex
    } = req.body || {};

    // --------------------------------------------------------------------------
    // GAME CHECK
    // --------------------------------------------------------------------------

    if (
      game !== "bingo" &&
      game !== "bingo75" &&
      game !== "bingo90"
    ) {

      return res
        .status(400)
        .json({

          error:
            "Not a Bingo game"
        });
    }

    const round =
      getRound(game);

    // --------------------------------------------------------------------------
    // ROUND CHECK
    // --------------------------------------------------------------------------

    if (
      round.status !== "DRAWING"
    ) {

      return res
        .status(409)
        .json({

          error:
            "Bingo claims are closed"
        });
    }

    // --------------------------------------------------------------------------
    // REQUIRED DATA
    // --------------------------------------------------------------------------

    if (
      !playerId ||
      !betId ||
      !Number.isInteger(
        cardIndex
      )
    ) {

      return res
        .status(400)
        .json({

          error:
            "playerId, betId and cardIndex are required"
        });
    }

    // --------------------------------------------------------------------------
    // FIND EXACT ACCEPTED BET
    // --------------------------------------------------------------------------

    const bet =
      [...bets.values()]
        .find(
          item =>
            item.id === betId &&
            item.roundId ===
              round.id &&
            item.playerId ===
              String(playerId) &&
            item.game ===
              game &&
            item.status ===
              "ACCEPTED"
        );

    if (!bet) {

      return res
        .status(403)
        .json({

          error:
            "Accepted bet not found"
        });
    }

    // --------------------------------------------------------------------------
    // CARD CHECK
    // --------------------------------------------------------------------------

    if (
      cardIndex < 0 ||
      cardIndex >=
        bet.cards.length
    ) {

      return res
        .status(400)
        .json({

          error:
            "Invalid cartella"
        });
    }

    // --------------------------------------------------------------------------
    // DUPLICATE CLAIM PROTECTION
    // --------------------------------------------------------------------------

    const claimKey =
      `${round.id}:${playerId}:${cardIndex}`;

    if (
      claims.has(claimKey)
    ) {

      return res
        .status(409)
        .json({

          error:
            "Claim already submitted"
        });
    }

    const card =
      bet.cards[
        cardIndex
      ];

    let marked;

    let valid;

    // --------------------------------------------------------------------------
    // BINGO 90
    // --------------------------------------------------------------------------

    if (
      game === "bingo90"
    ) {

      marked =
        bingo90Marked(
          card,
          round.draw
        );

      valid =
        hasBingo90Pattern(
          marked
        );
    }

    // --------------------------------------------------------------------------
    // BINGO / BINGO 75
    // --------------------------------------------------------------------------

    else {

      marked =
        bingo75Marked(
          card,
          round.draw
        );

      valid =
        has5x5BingoPattern(
          marked
        );
    }

    // Claim can only be submitted once.

    claims.add(
      claimKey
    );

    // --------------------------------------------------------------------------
    // INVALID CLAIM
    // --------------------------------------------------------------------------

    if (!valid) {

      return res.json({

        ok: false,

        winner: false,

        message:
          "BINGO claim rejected by server"
      });
    }

    // ========================================================================
    // PRODUCTION SETTLEMENT POINT
    // ========================================================================
    //
    // A valid winner must be settled through an atomic database transaction.
    //
    // The final production settlement must prevent:
    //
    //   - duplicate payout
    //   - two simultaneous winners exceeding the pool
    //   - repeated requests
    //   - race conditions
    //
    // ========================================================================

    return res.json({

      ok: true,

      winner: true,

      message:
        "BINGO verified by server",

      roundId:
        round.id,

      betId:
        bet.id,

      cardIndex
    });
  }
);

// ============================================================================
// KENO RESULT
// ============================================================================
//
// After all 20 official numbers are drawn:
//
//   - server calculates every player's highest slot score
//   - server ranks scores
//   - server calculates tie distribution
//
// Client never sends a score.
//
// ============================================================================

app.get(
  "/api/game/keno/result/:roundId",
  (req, res) => {

    const {
      roundId
    } = req.params;

    const round =
      [...rounds.values()]
        .find(
          item =>
            item.id ===
              roundId &&
            item.game ===
              "keno"
        );

    if (!round) {

      return res
        .status(404)
        .json({

          error:
            "Keno round not found"
        });
    }

    if (
      round.status !==
      "FINISHED"
    ) {

      return res
        .status(409)
        .json({

          error:
            "Keno round is not finished"
        });
    }

    // --------------------------------------------------------------------------
    // COLLECT ACCEPTED KENO BETS
    // --------------------------------------------------------------------------

    const entries =
      [...bets.values()]
        .filter(
          bet =>
            bet.roundId ===
              round.id &&
            bet.game ===
              "keno" &&
            bet.status ===
              "ACCEPTED"
        )
        .map(
          bet => {

            const scores =
              bet.slots.map(
                slot =>
                  kenoScore(
                    slot,
                    round.draw
                  )
              );

            return {

              betId:
                bet.id,

              playerId:
                bet.playerId,

              stake:
                bet.stake,

              scores,

              // Highest score from either slot.

              score:
                Math.max(
                  ...scores
                )
            };
          }
        );

    // --------------------------------------------------------------------------
    // TOTAL ACCEPTED POOL
    // --------------------------------------------------------------------------

    const totalPool =
      entries.reduce(
        (
          total,
          entry
        ) =>
          total +
          entry.stake,
        0
      );

    // --------------------------------------------------------------------------
    // PAYOUT CALCULATION
    // --------------------------------------------------------------------------

    const payouts =
      calculateKenoPayouts(
        entries,
        totalPool
      );

    return res.json({

      ok: true,

      roundId:
        round.id,

      drawnNumbers:
        round.draw,

      totalPool,

      housePercentage:
        10,

      payouts
    });
  }
);

// ============================================================================
// 404
// ============================================================================

app.use(
  (req, res) => {

    res
      .status(404)
      .json({

        error:
          "Not found",

        path:
          req.path
      });
  }
);

// ============================================================================
// ERROR HANDLER
// ============================================================================

app.use(
  (
    error,
    _req,
    res,
    _next
  ) => {

    console.error(
      error
    );

    res
      .status(500)
      .json({

        error:
          "Internal server error"
      });
  }
);

// ============================================================================
// START SERVER
// ============================================================================

app.listen(
  PORT,
  () => {

    console.log(
      `DESTA PLAY server listening on port ${PORT}`
    );
  }
);
