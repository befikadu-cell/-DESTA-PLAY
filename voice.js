/*
|--------------------------------------------------------------------------
| DESTA PLAY — LIVE GAME VOICE ENGINE
|--------------------------------------------------------------------------
|
| GAME VOICE RULES
|
| BINGO / BINGO 75 / BINGO 90
|   → Announces LETTER + NUMBER
|   → Example: "B 7", "I 18", "N 32", "G 55", "O 71"
|
| KENO
|   → Announces NUMBER ONLY
|   → Example: "7", "18", "32", "55"
|
| IMPORTANT
|   → Voice is ONLY active while the player is watching
|     the corresponding LIVE game screen.
|   → Leaving the screen immediately stops voice.
|   → Different rounds/stakes are isolated.
|   → Client NEVER decides the drawn number.
|   → Server sends the authoritative draw event.
|
|--------------------------------------------------------------------------
*/

const DestaVoice = (() => {

  let activeGame = null;
  let activeRoundId = null;
  let activeStake = null;

  let enabled = true;
  let speaking = false;

  let lastAnnouncementKey = null;

  /*
  |--------------------------------------------------------------------------
  | GAME TYPES
  |--------------------------------------------------------------------------
  */

  const BINGO_GAMES = new Set([
    "bingo",
    "bingo75",
    "bingo90"
  ]);

  const KENO_GAME = "keno";

  /*
  |--------------------------------------------------------------------------
  | BINGO LETTER
  |--------------------------------------------------------------------------
  |
  | Bingo 75:
  | B = 1-15
  | I = 16-30
  | N = 31-45
  | G = 46-60
  | O = 61-75
  |
  | For Bingo 90, the same B-I-N-G-O voice format is
  | used as requested for DESTA PLAY.
  |
  |--------------------------------------------------------------------------
  */

  function getBingoLetter(number) {

    number = Number(number);

    if (!Number.isInteger(number)) {
      return null;
    }

    if (number >= 1 && number <= 15) {
      return "B";
    }

    if (number >= 16 && number <= 30) {
      return "I";
    }

    if (number >= 31 && number <= 45) {
      return "N";
    }

    if (number >= 46 && number <= 60) {
      return "G";
    }

    if (number >= 61 && number <= 75) {
      return "O";
    }

    return null;
  }

  /*
  |--------------------------------------------------------------------------
  | VALIDATE NUMBER
  |--------------------------------------------------------------------------
  */

  function validNumber(number) {

    number = Number(number);

    return (
      Number.isInteger(number) &&
      number >= 1 &&
      number <= 90
    );
  }

  /*
  |--------------------------------------------------------------------------
  | BUILD ANNOUNCEMENT
  |--------------------------------------------------------------------------
  */

  function buildAnnouncement(game, number) {

    number = Number(number);

    if (!validNumber(number)) {
      return null;
    }

    /*
     * ALL BINGO GAMES
     * Letter + number
     */
    if (BINGO_GAMES.has(game)) {

      const letter = getBingoLetter(number);

      if (!letter) {
        return null;
      }

      return `${letter} ${number}`;
    }

    /*
     * KENO
     * Number only
     */
    if (game === KENO_GAME) {
      return `${number}`;
    }

    return null;
  }

  /*
  |--------------------------------------------------------------------------
  | STOP CURRENT VOICE
  |--------------------------------------------------------------------------
  */

  function stopVoice() {

    if (
      typeof window !== "undefined" &&
      "speechSynthesis" in window
    ) {
      window.speechSynthesis.cancel();
    }

    speaking = false;
  }

  /*
  |--------------------------------------------------------------------------
  | SPEAK
  |--------------------------------------------------------------------------
  */

  function speak(text) {

    if (!enabled) {
      return;
    }

    if (!text) {
      return;
    }

    if (
      typeof window === "undefined" ||
      !("speechSynthesis" in window) ||
      typeof SpeechSynthesisUtterance === "undefined"
    ) {
      return;
    }

    stopVoice();

    const utterance =
      new SpeechSynthesisUtterance(text);

    /*
     * Clear, short live-game announcement.
     */
    utterance.rate = 0.95;
    utterance.pitch = 1;
    utterance.volume = 1;

    utterance.onstart = () => {
      speaking = true;
    };

    utterance.onend = () => {
      speaking = false;
    };

    utterance.onerror = () => {
      speaking = false;
    };

    window.speechSynthesis.speak(utterance);
  }

  /*
  |--------------------------------------------------------------------------
  | ENTER LIVE GAME
  |--------------------------------------------------------------------------
  |
  | Called when player opens a specific live round/stake.
  |
  | Example:
  |
  | enterLiveGame("bingo75", "round_123", 20)
  |
  |--------------------------------------------------------------------------
  */

  function enterLiveGame(game, roundId, stake) {

    game = String(game || "").toLowerCase();

    /*
     * Always stop previous game voice.
     */
    stopVoice();

    activeGame = game;
    activeRoundId = roundId ?? null;
    activeStake = stake ?? null;

    lastAnnouncementKey = null;
  }

  /*
  |--------------------------------------------------------------------------
  | LEAVE LIVE GAME
  |--------------------------------------------------------------------------
  */

  function leaveLiveGame() {

    stopVoice();

    activeGame = null;
    activeRoundId = null;
    activeStake = null;

    lastAnnouncementKey = null;
  }

  /*
  |--------------------------------------------------------------------------
  | CHECK ACTIVE SESSION
  |--------------------------------------------------------------------------
  */

  function isActive(game, roundId, stake) {

    if (!activeGame) {
      return false;
    }

    if (activeGame !== String(game).toLowerCase()) {
      return false;
    }

    if (
      activeRoundId !== null &&
      roundId !== undefined &&
      roundId !== null &&
      String(activeRoundId) !== String(roundId)
    ) {
      return false;
    }

    if (
      activeStake !== null &&
      stake !== undefined &&
      stake !== null &&
      Number(activeStake) !== Number(stake)
    ) {
      return false;
    }

    return true;
  }

  /*
  |--------------------------------------------------------------------------
  | ANNOUNCE DRAW
  |--------------------------------------------------------------------------
  |
  | IMPORTANT:
  | This function must receive the number coming from the
  | authoritative server draw.
  |
  |--------------------------------------------------------------------------
  */

  function announceDraw({
    game,
    roundId,
    stake,
    number
  }) {

    game = String(game || "").toLowerCase();

    /*
     * Player must currently be watching this game.
     */
    if (!isActive(game, roundId, stake)) {
      return false;
    }

    number = Number(number);

    /*
     * Prevent invalid announcements.
     */
    if (!validNumber(number)) {
      return false;
    }

    /*
     * Bingo 75 cannot exceed 75.
     */
    if (
      game === "bingo" ||
      game === "bingo75"
    ) {

      if (number > 75) {
        return false;
      }
    }

    /*
     * Build correct voice.
     */
    const announcement =
      buildAnnouncement(game, number);

    if (!announcement) {
      return false;
    }

    /*
     * Prevent duplicate voice caused by
     * websocket/network retry.
     */
    const announcementKey =
      `${game}:${roundId}:${stake}:${number}`;

    if (lastAnnouncementKey === announcementKey) {
      return false;
    }

    lastAnnouncementKey = announcementKey;

    speak(announcement);

    return true;
  }

  /*
  |--------------------------------------------------------------------------
  | VOICE ON / OFF
  |--------------------------------------------------------------------------
  */

  function setEnabled(value) {

    enabled = Boolean(value);

    if (!enabled) {
      stopVoice();
    }
  }

  function toggle() {

    setEnabled(!enabled);

    return enabled;
  }

  /*
  |--------------------------------------------------------------------------
  | STATE
  |--------------------------------------------------------------------------
  */

  function getState() {

    return {
      enabled,
      speaking,
      activeGame,
      activeRoundId,
      activeStake
    };
  }

  /*
  |--------------------------------------------------------------------------
  | PUBLIC API
  |--------------------------------------------------------------------------
  */

  return {
    enterLiveGame,
    leaveLiveGame,
    announceDraw,
    buildAnnouncement,
    getBingoLetter,
    setEnabled,
    toggle,
    stopVoice,
    getState
  };

})();

/*
|--------------------------------------------------------------------------
| OPTIONAL GLOBAL ACCESS
|--------------------------------------------------------------------------
|
| Allows index.html to use:
|
| DestaVoice.enterLiveGame(...)
| DestaVoice.announceDraw(...)
| DestaVoice.leaveLiveGame()
|
|--------------------------------------------------------------------------
*/

if (typeof window !== "undefined") {
  window.DestaVoice = DestaVoice;
}
