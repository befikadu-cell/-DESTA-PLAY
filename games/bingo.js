"use strict";

import crypto from "node:crypto";
import { shuffle } from "../utils/random.js";

/*
|--------------------------------------------------------------------------
| DESTA PLAY — COMPLETE BINGO GAME ENGINE
|--------------------------------------------------------------------------
|
| Features:
|   - 75-Ball Bingo (B: 1-15, I: 16-30, N: 31-45, G: 46-60, O: 61-75)
|   - 120 Unique Pre-seeded Cartelas (SHA-256 deterministic generation)
|   - Fixed Bet Tiers (20 to 1000 ETB)
|   - Dual-Slot Cartela System (Slot 1 permanent, Slot 2 optional with +/- support)
|   - 90% Player Prize Pool / 10% House Edge Settlement Model
|   - Sequential Voice Calls (English & Amharic translations)
|
|--------------------------------------------------------------------------
*/

export const GAME_NAME = "bingo";

const BINGO_SIZE = 5;
const BINGO_NUMBERS = 75;
const TOTAL_CARTELAS = 120;

/*
|--------------------------------------------------------------------------
| FIXED BET AMOUNTS (ETB)
|--------------------------------------------------------------------------
*/

export const FIXED_BET_AMOUNTS = [
    20, 30, 50, 80, 100, 150, 200, 250, 300, 350, 400, 450, 500, 600, 700, 800, 1000
];

export function validateBetAmount(amount) {
    const value = Number(amount);
    if (!FIXED_BET_AMOUNTS.includes(value)) {
        throw new Error(`Invalid bet amount. Choose from: ${FIXED_BET_AMOUNTS.join(", ")}`);
    }
    return value;
}


/*
|--------------------------------------------------------------------------
| FINANCIAL CONFIGURATION (90% RTP / 10% HOUSE EDGE)
|--------------------------------------------------------------------------
*/

const HOUSE_EDGE_PERCENTAGE = 10;
const PLAYER_POOL_PERCENTAGE = 90;


/*
|--------------------------------------------------------------------------
| TIMING & VOICE SETTINGS
|--------------------------------------------------------------------------
*/

const BETTING_SECONDS = 40;
const DRAW_INTERVAL_SECONDS = 3;
const DRAW_INTERVAL_MS = DRAW_INTERVAL_SECONDS * 1000;
const SPEECH_RATE = 0.75;


/*
|--------------------------------------------------------------------------
| WAITING MESSAGES
|--------------------------------------------------------------------------
*/

const WAITING_MESSAGE = "WAITING FOR NEXT ROUND";
const WAITING_MESSAGE_AM = "ቀጣዩን ዙር በመጠበቅ ላይ";


/*
|--------------------------------------------------------------------------
| BINGO COLUMN RANGES & LETTERS
|--------------------------------------------------------------------------
*/

const COLUMN_RANGES = [
    [1, 15],   // B
    [16, 30],  // I
    [31, 45],  // N
    [46, 60],  // G
    [61, 75]   // O
];

const COLUMN_LETTERS = ["B", "I", "N", "G", "O"];


/*
|--------------------------------------------------------------------------
| SEEDED RANDOM & CARTELA GENERATION
|--------------------------------------------------------------------------
*/

function seededRandom(seed) {
    let value = seed >>> 0;
    return function () {
        value += 0x6D2B79F5;
        let t = value;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function cartelaSeed(cartelaNumber) {
    const hash = crypto
        .createHash("sha256")
        .update(`DESTA-PLAY-BINGO-CARTELA-${cartelaNumber}`)
        .digest();
    return hash.readUInt32BE(0);
}

function seededShuffle(array, random) {
    const result = [...array];
    for (let i = result.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
}

function generateColumn(min, max, count, random) {
    const numbers = [];
    for (let number = min; number <= max; number++) {
        numbers.push(number);
    }
    return seededShuffle(numbers, random).slice(0, count).sort((a, b) => a - b);
}

function validateCartelaNumber(cartelaNumber) {
    const number = Number(cartelaNumber);
    if (!Number.isInteger(number) || number < 1 || number > TOTAL_CARTELAS) {
        throw new Error(`Cartela number must be between 1 and ${TOTAL_CARTELAS}`);
    }
    return number;
}

export function getCartela(cartelaNumber) {
    const number = validateCartelaNumber(cartelaNumber);
    return CARTELAS[number];
}

function generateCartela(cartelaNumber) {
    const number = validateCartelaNumber(cartelaNumber);
    const random = seededRandom(cartelaSeed(number));
    const card = Array.from({ length: BINGO_SIZE }, () => Array(BINGO_SIZE));

    for (let column = 0; column < 5; column++) {
        const [min, max] = COLUMN_RANGES[column];
        const count = column === 2 ? 4 : 5;
        const numbers = generateColumn(min, max, count, random);

        if (column === 2) {
            let numberIndex = 0;
            for (let row = 0; row < 5; row++) {
                if (row === 2) {
                    card[row][column] = "FREE";
                } else {
                    card[row][column] = numbers[numberIndex];
                    numberIndex++;
                }
            }
        } else {
            for (let row = 0; row < 5; row++) {
                card[row][column] = numbers[row];
            }
        }
    }

    return { number, card };
}

function validateCard(card) {
    if (!Array.isArray(card) || card.length !== 5) return false;
    for (let row = 0; row < 5; row++) {
        if (!Array.isArray(card[row]) || card[row].length !== 5) return false;
    }
    if (card[2][2] !== "FREE") return false;

    for (let column = 0; column < 5; column++) {
        const [min, max] = COLUMN_RANGES[column];
        const values = [];
        for (let row = 0; row < 5; row++) {
            const value = card[row][column];
            if (value === "FREE") continue;
            if (!Number.isInteger(value) || value < min || value > max) return false;
            values.push(value);
        }
        if (new Set(values).size !== values.length) return false;
    }
    return true;
}

function generateAllCartelas() {
    const cartelas = {};
    const signatures = new Set();

    for (let number = 1; number <= TOTAL_CARTELAS; number++) {
        const cartela = generateCartela(number);
        if (!validateCard(cartela.card)) {
            throw new Error(`Invalid Cartela #${number}`);
        }
        const signature = JSON.stringify(cartela.card);
        if (signatures.has(signature)) {
            throw new Error(`Duplicate Cartela configuration detected: #${number}`);
        }
        signatures.add(signature);
        cartelas[number] = cartela;
    }
    return cartelas;
}

const CARTELAS = generateAllCartelas();


/*
|--------------------------------------------------------------------------
| SLOT MANAGEMENT (Slot 1 & Slot 2 Logic)
|--------------------------------------------------------------------------
*/

const MIN_SLOTS = 1;
const DEFAULT_SLOTS = 2;
const MAX_SLOTS = 2;

export function createSlot(slotNumber) {
    const slot = Number(slotNumber);
    if (!Number.isInteger(slot) || slot < MIN_SLOTS || slot > MAX_SLOTS) {
        throw new Error(`Slot must be between ${MIN_SLOTS} and ${MAX_SLOTS}`);
    }

    return {
        slot,
        permanent: slot === 1,
        optional: slot === 2,
        active: true,
        cartelaNumber: null,
        betAmount: 0,
        placed: false,
        result: null
    };
}

export function createDefaultSlots() {
    return [createSlot(1), createSlot(2)];
}

export function createSingleSlot() {
    return [createSlot(1)];
}


/*
|--------------------------------------------------------------------------
| B-I-N-G-O CALLS & VOICE GENERATION
|--------------------------------------------------------------------------
*/

function getCallLetter(number) {
    const value = Number(number);
    if (!Number.isInteger(value) || value < 1 || value > 75) {
        throw new Error("Bingo number must be between 1 and 75");
    }
    if (value <= 15) return "B";
    if (value <= 30) return "I";
    if (value <= 45) return "N";
    if (value <= 60) return "G";
    return "O";
}

function getAmharicLetter(letter) {
    const letters = { B: "ቢ", I: "አይ", N: "ኤን", G: "ጂ", O: "ኦ" };
    return letters[letter] || letter;
}

export function createCall(number) {
    const value = Number(number);
    const letter = getCallLetter(value);

    return {
        number: value,
        letter,
        display: `${letter}-${value}`,
        voiceText: `${letter}, ${value}`,
        voiceTextAm: `${getAmharicLetter(letter)} ${value}`,
        speechRate: SPEECH_RATE
    };
}


/*
|--------------------------------------------------------------------------
| PATTERN VALIDATION (Lines, Corners, Full House)
|--------------------------------------------------------------------------
*/

export function checkWinningPatterns(card, drawnNumbersSet) {
    const matrix = [
        [card[0][0], card[0][1], card[0][2], card[0][3], card[0][4]],
        [card[1][0], card[1][1], card[1][2], card[1][3], card[1][4]],
        [card[2][0], card[2][1], card[2][2], card[2][3], card[2][4]],
        [card[3][0], card[3][1], card[3][2], card[3][3], card[3][4]],
        [card[4][0], card[4][1], card[4][2], card[4][3], card[4][4]]
    ];

    const isMarked = (val) => val === "FREE" || drawnNumbersSet.has(val);
    let linesCount = 0;

    // Rows
    for (let r = 0; r < 5; r++) {
        if (matrix[r].every(isMarked)) linesCount++;
    }

    // Columns
    for (let c = 0; c < 5; c++) {
        let colWin = true;
        for (let r = 0; r < 5; r++) {
            if (!isMarked(matrix[r][c])) {
                colWin = false;
                break;
            }
        }
        if (colWin) linesCount++;
    }

    // Diagonals
    const diag1 = [matrix[0][0], matrix[1][1], matrix[2][2], matrix[3][3], matrix[4][4]];
    const diag2 = [matrix[0][4], matrix[1][3], matrix[2][2], matrix[3][1], matrix[4][0]];
    if (diag1.every(isMarked)) linesCount++;
    if (diag2.every(isMarked)) linesCount++;

    // Full House Check
    let totalCells = 25;
    let markedCells = 0;
    for (let r = 0; r < 5; r++) {
        for (let c = 0; c < 5; c++) {
            if (isMarked(matrix[r][c])) markedCells++;
        }
    }
    const hasFullHouse = (markedCells === totalCells);

    let completedPatterns = [];
    if (hasFullHouse || linesCount > 0) {
        completedPatterns.push({ lines: linesCount, fullHouse: hasFullHouse });
    }

    return completedPatterns;
}


/*
|--------------------------------------------------------------------------
| CREATE ROUND & DRAW LOGIC
|--------------------------------------------------------------------------
*/

function generateDrawOrder() {
    const numbers = [];
    for (let number = 1; number <= BINGO_NUMBERS; number++) {
        numbers.push(number);
    }
    return shuffle(numbers);
}

export function createRound() {
    const now = Date.now();

    return {
        game: GAME_NAME,
        status: "BETTING",
        bettingSeconds: BETTING_SECONDS,
        bettingStartedAt: new Date(now).toISOString(),
        bettingEndsAt: now + BETTING_SECONDS * 1000,
        drawIntervalSeconds: DRAW_INTERVAL_SECONDS,
        drawIntervalMs: DRAW_INTERVAL_MS,
        nextDrawAt: null,
        totalCartelas: TOTAL_CARTELAS,
        drawOrder: generateDrawOrder(),
        drawIndex: 0,
        drawnNumbers: [],
        calls: [],
        currentCall: null,
        players: {},
        financials: null,
        waitingMessage: WAITING_MESSAGE,
        waitingMessageAm: WAITING_MESSAGE_AM,
        createdAt: new Date(now).toISOString(),
        finishedAt: null
    };
}


/*
|--------------------------------------------------------------------------
| FINANCIAL SETTLEMENT (POOL MODEL)
|--------------------------------------------------------------------------
*/

export function settleBingoPoolRound(round) {
    if (!round || round.status !== "FINISHED") {
        throw new Error("Round must be finished before pool settlement.");
    }

    const drawnSet = new Set(round.drawnNumbers);
    let totalHandle = 0;
    let winningEntries = [];

    for (const [playerId, player] of Object.entries(round.players || {})) {
        for (const slot of (player.slots || [])) {
            if (!slot.placed || !slot.betAmount || !slot.cartelaNumber) continue;

            const betAmount = validateBetAmount(slot.betAmount);
            totalHandle += betAmount;

            const cartela = getCartela(slot.cartelaNumber);
            const matches = checkWinningPatterns(cartela.card, drawnSet);

            if (matches.length > 0) {
                winningEntries.push({
                    playerId,
                    slotNumber: slot.slot,
                    cartelaNumber: slot.cartelaNumber,
                    betAmount,
                    matches
                });
            }
        }
    }

    let houseRevenue = (totalHandle * HOUSE_EDGE_PERCENTAGE) / 100;
    let prizePool = (totalHandle * PLAYER_POOL_PERCENTAGE) / 100;

    let playerSettlements = {};
    let totalPayouts = 0;

    if (winningEntries.length > 0) {
        const payoutPerWinner = prizePool / winningEntries.length;

        for (const winner of winningEntries) {
            if (!playerSettlements[winner.playerId]) {
                playerSettlements[winner.playerId] = {
                    totalBet: 0,
                    totalPayout: 0,
                    netProfit: 0,
                    winningCards: []
                };
            }

            playerSettlements[winner.playerId].totalBet += winner.betAmount;
            playerSettlements[winner.playerId].totalPayout += payoutPerWinner;
            playerSettlements[winner.playerId].winningCards.push({
                cartelaNumber: winner.cartelaNumber,
                payout: payoutPerWinner
            });

            totalPayouts += payoutPerWinner;
        }

        for (const playerId of Object.keys(playerSettlements)) {
            playerSettlements[playerId].netProfit =
                playerSettlements[playerId].totalPayout - playerSettlements[playerId].totalBet;
        }
    } else {
        houseRevenue += prizePool;
    }

    round.financials = {
        totalHandle,
        houseRevenue,
        prizePool,
        totalPayouts,
        houseEdgePercentage: HOUSE_EDGE_PERCENTAGE,
        playerPoolPercentage: PLAYER_POOL_PERCENTAGE,
        actualRTP: totalHandle > 0 ? (totalPayouts / totalHandle) * 100 : 0,
        settledAt: new Date().toISOString()
    };

    round.playerSettlements = playerSettlements;
    return round;
}
