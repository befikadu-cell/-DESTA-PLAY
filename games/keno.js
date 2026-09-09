// ============================================================================
// DESTA PLAY — KENO ENGINE
// ============================================================================
//
// Numbers: 1-80
// Draw: 20 unique numbers
// Slots: 1 or 2
// Numbers per slot: 3-10
//
// Final score:
//   highest match count from either slot.
//
// Payout:
//
// Clear first:
//   60% first
//   30% second
//   10% house
//
// Tie first:
//   entire 90% winner pool is split equally
//   no second-place payout
//
// Clear first + tied second:
//   first gets 60%
//   second-place winners split 30%
//   house gets 10%
//
// ============================================================================

import crypto from "node:crypto";

// ============================================================================
// CONSTANTS
// ============================================================================

export const KENO_CONFIG = {

  name:
    "Keno",

  minNumber:
    1,

  maxNumber:
    80,

  drawCount:
    20,

  minSelection:
    3,

  maxSelection:
    10,

  maxSlots:
    2,

  bettingSeconds:
    40,

  firstPercent:
    60,

  secondPercent:
    30,

  housePercent:
    10
};

// ============================================================================
// SECURE SHUFFLE
// ============================================================================

export function secureShuffle(
  values
) {

  const array = [...values];

  for (
    let i = array.length - 1;
    i > 0;
    i--
  ) {

    const j =
      crypto.randomInt(i + 1);

    [
      array[i],
      array[j]
    ] = [
      array[j],
      array[i]
    ];
  }

  return array;
}

// ============================================================================
// CREATE OFFICIAL DRAW
// ============================================================================
//
// Exactly 20 unique numbers.
// No replacement.
// ============================================================================

export function createDraw() {

  return secureShuffle(
    Array.from(
      {
        length: 80
      },
      (_, index) =>
        index + 1
    )
  ).slice(
    0,
    20
  );
}

// ============================================================================
// VALIDATE SLOT
// ============================================================================

export function validateSlot(
  slot
) {

  if (
    !Array.isArray(slot)
  ) {
    return false;
  }

  if (
    slot.length < 3 ||
    slot.length > 10
  ) {
    return false;
  }

  for (
    const number of slot
  ) {

    if (
      !Number.isInteger(number) ||
      number < 1 ||
      number > 80
    ) {
      return false;
    }
  }

  return (
    new Set(slot).size ===
    slot.length
  );
}

// ============================================================================
// VALIDATE ALL PLAYER SLOTS
// ============================================================================

export function validateSlots(
  slots
) {

  if (
    !Array.isArray(slots)
  ) {
    return false;
  }

  if (
    slots.length < 1 ||
    slots.length > 2
  ) {
    return false;
  }

  return slots.every(
    slot =>
      validateSlot(slot)
  );
}

// ============================================================================
// COUNT MATCHES
// ============================================================================

export function countMatches(
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
// CALCULATE PLAYER SCORE
// ============================================================================
//
// If player has two slots:
//
// Slot 1 = 3 matches
// Slot 2 = 7 matches
//
// Final score = 7
//
// ============================================================================

export function calculatePlayerScore(
  slots,
  drawnNumbers
) {

  if (
    !validateSlots(slots)
  ) {

    throw new Error(
      "Invalid Keno slots"
    );
  }

  const scores =
    slots.map(
      slot =>
        countMatches(
          slot,
          drawnNumbers
        )
    );

  return {
    scores,

    score:
      Math.max(
        ...scores
      )
  };
}

// ============================================================================
// VERIFY DRAW
// ============================================================================

export function validateDraw(
  drawnNumbers
) {

  if (
    !Array.isArray(
      drawnNumbers
    )
  ) {
    return false;
  }

  if (
    drawnNumbers.length !== 20
  ) {
    return false;
  }

  if (
    drawnNumbers.some(
      number =>
        !Number.isInteger(number) ||
        number < 1 ||
        number > 80
    )
  ) {
    return false;
  }

  return (
    new Set(
      drawnNumbers
    ).size === 20
  );
}

// ============================================================================
// CALCULATE ALL PLAYER SCORES
// ============================================================================

export function scorePlayers(
  players,
  drawnNumbers
) {

  if (
    !validateDraw(
      drawnNumbers
    )
  ) {

    throw new Error(
      "Invalid Keno draw"
    );
  }

  return players.map(
    player => {

      const result =
        calculatePlayerScore(
          player.slots,
          drawnNumbers
        );

      return {
        ...player,

        scores:
          result.scores,

        score:
          result.score
      };
    }
  );
}

// ============================================================================
// PAYOUT ENGINE
// ============================================================================

export function calculatePayouts(
  players,
  totalPool
) {

  if (
    !Array.isArray(players) ||
    players.length === 0
  ) {
    return [];
  }

  if (
    !Number.isFinite(totalPool) ||
    totalPool <= 0
  ) {
    return [];
  }

  const ranked =
    [...players].sort(
      (a, b) =>
        b.score - a.score
    );

  // ========================================================================
  // FIRST PLACE
  // ========================================================================

  const firstScore =
    ranked[0].score;

  const firstPlace =
    ranked.filter(
      player =>
        player.score ===
        firstScore
    );

  // ========================================================================
  // TIE FOR FIRST
  // ========================================================================
  //
  // Entire 90% winner pool is shared.
  //
  // Example:
  //
  // A = 5
  // B = 5
  // C = 3
  //
  // A = 45%
  // B = 45%
  // House = 10%
  //
  // ========================================================================

  if (
    firstPlace.length > 1
  ) {

    const payout =
      (totalPool * 0.90) /
      firstPlace.length;

    return firstPlace.map(
      player => ({

        ...player,

        rank:
          1,

        percentage:
          90 /
          firstPlace.length,

        payout
      })
    );
  }

  // ========================================================================
  // CLEAR FIRST
  // ========================================================================

  const result = [

    {

      ...ranked[0],

      rank:
        1,

      percentage:
        60,

      payout:
        totalPool * 0.60
    }

  ];

  // ========================================================================
  // SECOND PLACE
  // ========================================================================

  const secondScoreEntry =
    ranked.find(
      player =>
        player.score <
        firstScore
    );

  if (
    !secondScoreEntry
  ) {
    return result;
  }

  const secondScore =
    secondScoreEntry.score;

  const secondPlace =
    ranked.filter(
      player =>
        player.score ===
        secondScore
    );

  const secondPayout =
    (totalPool * 0.30) /
    secondPlace.length;

  for (
    const player of
    secondPlace
  ) {

    result.push({

      ...player,

      rank:
        2,

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
// COMPLETE KENO RESULT
// ============================================================================

export function calculateResult(
  players,
  drawnNumbers
) {

  const scored =
    scorePlayers(
      players,
      drawnNumbers
    );

  const totalPool =
    scored.reduce(
      (total, player) =>
        total +
        Number(
          player.stake || 0
        ),
      0
    );

  const payouts =
    calculatePayouts(
      scored,
      totalPool
    );

  return {

    drawnNumbers,

    totalPool,

    houseAmount:
      totalPool * 0.10,

    players:
      scored,

    payouts
  };
}
