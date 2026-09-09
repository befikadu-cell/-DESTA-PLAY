// ============================================================================
// DESTA PLAY — BINGO 75 ENGINE
// ============================================================================

import {
  secureShuffle,
  generateCard,
  validateCard,
  getMarkedCard,
  checkWinningPattern,
  verifyClaim
} from "./bingo.js";

// ============================================================================
// DRAW
// ============================================================================

export function createDraw() {
  return secureShuffle(
    Array.from(
      { length: 75 },
      (_, index) => index + 1
    )
  );
}

// ============================================================================
// CARD
// ============================================================================

export function createCard() {
  return generateCard();
}

// ============================================================================
// VALIDATE
// ============================================================================

export function validateBingo75Card(
  card
) {
  return validateCard(card);
}

// ============================================================================
// MARK
// ============================================================================

export function markCard(
  card,
  drawnNumbers
) {
  return getMarkedCard(
    card,
    drawnNumbers
  );
}

// ============================================================================
// CLAIM
// ============================================================================

export function verifyBingo75Claim(
  card,
  drawnNumbers
) {
  return verifyClaim(
    card,
    drawnNumbers
  );
}

// ============================================================================
// PATTERN
// ============================================================================

export function checkPattern(
  marked
) {
  return checkWinningPattern(
    marked
  );
}

// ============================================================================
// PAYOUT
// ============================================================================
//
// Total pool:
//
// 10% = house
// 90% = winner pool
//
// One winner:
// 90%
//
// Two winners:
// 45% + 45%
//
// No third-place payout.
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

  const individual =
    winnerPool /
    winners.length;

  return winners.map(
    winner => ({
      ...winner,

      payout:
        individual,

      percentage:
        90 /
        winners.length
    })
  );
}

// ============================================================================
// CONFIG
// ============================================================================

export const BINGO75_CONFIG = {

  name:
    "Bingo 75",

  balls:
    75,

  rows:
    5,

  columns:
    5,

  freeCenter:
    true,

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
