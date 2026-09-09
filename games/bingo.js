// ============================================================================
// DESTA PLAY — BINGO ENGINE
// ============================================================================

import crypto from "node:crypto";

const BALL_COUNT = 75;
const MAX_CARDS = 2;

// ============================================================================
// SECURE SHUFFLE
// ============================================================================

export function secureShuffle(values) {
  const array = [...values];

  for (let i = array.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);

    [array[i], array[j]] = [
      array[j],
      array[i]
    ];
  }

  return array;
}

// ============================================================================
// CREATE BINGO DRAW
// ============================================================================

export function createDraw() {
  return secureShuffle(
    Array.from(
      { length: BALL_COUNT },
      (_, index) => index + 1
    )
  );
}

// ============================================================================
// CREATE STANDARD 75-BALL CARD
// ============================================================================
//
// B: 1-15
// I: 16-30
// N: 31-45
// G: 46-60
// O: 61-75
//
// Center = FREE
// ============================================================================

export function generateCard() {
  const columns = [
    [1, 15],
    [16, 30],
    [31, 45],
    [46, 60],
    [61, 75]
  ];

  const card = Array.from(
    { length: 5 },
    () => Array(5).fill(null)
  );

  for (let column = 0; column < 5; column++) {

    const numbers = secureShuffle(
      Array.from(
        {
          length:
            columns[column][1] -
            columns[column][0] +
            1
        },
        (_, index) =>
          columns[column][0] + index
      )
    ).slice(0, 5);

    for (let row = 0; row < 5; row++) {

      if (
        row === 2 &&
        column === 2
      ) {
        card[row][column] = "FREE";
      } else {
        card[row][column] =
          numbers[row];
      }
    }
  }

  return card;
}

// ============================================================================
// VALIDATE CARD
// ============================================================================

export function validateCard(card) {

  if (
    !Array.isArray(card) ||
    card.length !== 5
  ) {
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

  for (let row = 0; row < 5; row++) {

    for (let column = 0; column < 5; column++) {

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
    }
  }

  return true;
}

// ============================================================================
// MARK CARD
// ============================================================================

export function getMarkedCard(
  card,
  drawnNumbers
) {

  const drawn =
    new Set(drawnNumbers);

  return card.map(
    (row, rowIndex) =>
      row.map(
        (value, columnIndex) => {

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
// WINNING PATTERN
// ============================================================================
//
// Horizontal
// Vertical
// Diagonal
//
// ============================================================================

export function checkWinningPattern(
  marked
) {

  // Horizontal
  for (let row = 0; row < 5; row++) {

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
      return {
        winner: true,
        pattern: "VERTICAL"
      };
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
    return {
      winner: true,
      pattern: "DIAGONAL"
    };
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

  if (diagonalTwo) {
    return {
      winner: true,
      pattern: "DIAGONAL"
    };
  }

  return {
    winner: false,
    pattern: null
  };
}

// ============================================================================
// VERIFY BINGO CLAIM
// ============================================================================

export function verifyClaim(
  card,
  drawnNumbers
) {

  if (!validateCard(card)) {
    return {
      valid: false,
      reason: "INVALID_CARD"
    };
  }

  const marked =
    getMarkedCard(
      card,
      drawnNumbers
    );

  const result =
    checkWinningPattern(
      marked
    );

  return {
    valid: result.winner,
    pattern: result.pattern,
    marked
  };
}

// ============================================================================
// CONFIG
// ============================================================================

export const BINGO_CONFIG = {
  name: "Bingo",
  ballCount: 75,
  bettingSeconds: 30,
  maxCards: MAX_CARDS,
  housePercent: 10,
  winnerPoolPercent: 90
};
