// ============================================================================
// DESTA PLAY — BINGO 90 ENGINE
// ============================================================================
//
// Standard 90-ball ticket:
//
// 3 rows × 9 columns
// 5 numbers per row
// 15 numbers total
// Blank cells allowed
//
// Server remains authoritative.
// ============================================================================

import crypto from "node:crypto";

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
// DRAW
// ============================================================================

export function createDraw() {

  return secureShuffle(
    Array.from(
      { length: 90 },
      (_, index) => index + 1
    )
  );
}

// ============================================================================
// VALIDATE TICKET
// ============================================================================

export function validateCard(
  card
) {

  if (
    !Array.isArray(card) ||
    card.length !== 3
  ) {
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

  const seen =
    new Set();

  for (
    const row of card
  ) {

    let numbersInRow = 0;

    for (
      const value of row
    ) {

      // Blank position.
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

      if (
        seen.has(number)
      ) {
        return false;
      }

      seen.add(number);

      numbersInRow++;
    }

    if (
      numbersInRow !== 5
    ) {
      return false;
    }
  }

  return seen.size === 15;
}

// ============================================================================
// MARK TICKET
// ============================================================================

export function markCard(
  card,
  drawnNumbers
) {

  const drawn =
    new Set(drawnNumbers);

  return card.map(
    row =>
      row.map(
        value => {

          // Blank cells are treated as
          // already satisfied for line checks.
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
// CHECK WINNING PATTERN
// ============================================================================
//
// Horizontal
// Vertical
// Diagonal
//
// ============================================================================

export function checkPattern(
  marked
) {

  // Horizontal
  for (
    let row = 0;
    row < 3;
    row++
  ) {

    if (
      marked[row].every(Boolean)
    ) {

      return {
        winner: true,
        pattern: "HORIZONTAL"
      };
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

      return {
        winner: true,
        pattern: "VERTICAL"
      };
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

      return {
        winner: true,
        pattern: "DIAGONAL"
      };
    }

    if (
      marked[2][column] &&
      marked[1][column + 1] &&
      marked[0][column + 2]
    ) {

      return {
        winner: true,
        pattern: "DIAGONAL"
      };
    }
  }

  return {
    winner: false,
    pattern: null
  };
}

// ============================================================================
// VERIFY CLAIM
// ============================================================================

export function verifyClaim(
  card,
  drawnNumbers
) {

  if (
    !validateCard(card)
  ) {

    return {
      valid: false,
      reason: "INVALID_CARD"
    };
  }

  const marked =
    markCard(
      card,
      drawnNumbers
    );

  const result =
    checkPattern(
      marked
    );

  return {
    valid:
      result.winner,

    pattern:
      result.pattern,

    marked
  };
}

// ============================================================================
// PAYOUT
// ============================================================================

export function calculatePayouts(
  winners,
  totalPool
) {

  if (
    !Array.isArray(winners) ||
    winners.length === 0 ||
    totalPool <= 0
  ) {
    return [];
  }

  const winnerPool =
    totalPool * 0.90;

  const payout =
    winnerPool /
    winners.length;

  return winners.map(
    winner => ({
      ...winner,

      payout,

      percentage:
        90 /
        winners.length
    })
  );
}

// ============================================================================
// CONFIG
// ============================================================================

export const BINGO90_CONFIG = {

  name:
    "Bingo 90",

  balls:
    90,

  rows:
    3,

  columns:
    9,

  numbersPerRow:
    5,

  totalNumbers:
    15,

  bettingSeconds:
    30,

  maxCards:
    2,

  housePercent:
    10,

  winnerPercent:
    90,

  patterns: [
    "HORIZONTAL",
    "VERTICAL",
    "DIAGONAL"
  ]
};
