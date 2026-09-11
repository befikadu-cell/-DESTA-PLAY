/*
|--------------------------------------------------------------------------
| DESTA PLAY — LIVE GAME VOICE ENGINE
|--------------------------------------------------------------------------
|
| GAME VOICE RULES
|
| BINGO (75-ball)
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

  let enabled = false;
  let speaking = false;
  let voices = [];

  let lastAnnouncementKey = null;

  /*
  |--------------------------------------------------------------------------
  | GAME TYPES
  |--------------------------------------------------------------------------
  */

  const BINGO_GAMES = new Set([
    "bingo"
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
  | Amharic mode uses the same B-I-N-G-O column mapping while
  | selecting the Amharic speech voice.
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

  function buildAnnouncement(game, number, language = "en") {

    number = Number(number);
    if (!validNumber(number)) {
      return null;
    }

    language = String(language || "en").toLowerCase() === "am" ? "am" : "en";

    /* BINGO: letter + number. Amharic uses the same B-I-N-G-O
       columns, but the spoken text is sent to the Amharic voice. */
    if (BINGO_GAMES.has(game)) {

      const letter = getBingoLetter(number);
      if (!letter) {
        return null;
      }

      if (language === "am") {
        const amLetter = { B: "ቢ", I: "አይ", N: "ኤን", G: "ጂ", O: "ኦ" }[letter];
        return `${amLetter} ${number}`;
      }

      return `${letter} ${number}`;
    }

    /* KENO: number only. */
    if (game === KENO_GAME) {
      return `${number}`;
    }

    return null;
  }

  function refreshVoices() {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    try { voices = window.speechSynthesis.getVoices() || []; } catch (_) { voices = []; }
  }

  function pickVoice(language) {
    refreshVoices();
    const wanted = language === "am" ? ["am-ET", "am"] : ["en-US", "en"];
    for (const prefix of wanted) {
      const exact = voices.find(v => String(v.lang || "").toLowerCase() === prefix.toLowerCase());
      if (exact) return exact;
    }
    for (const prefix of wanted) {
      const partial = voices.find(v => String(v.lang || "").toLowerCase().startsWith(prefix.toLowerCase().split("-")[0]));
      if (partial) return partial;
    }
    return null;
  }

  if (typeof window !== "undefined" && "speechSynthesis" in window) {
    refreshVoices();
    try { window.speechSynthesis.addEventListener("voiceschanged", refreshVoices); } catch (_) {}
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

  function speak(text, language = "en") {

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

    language = String(language || "en").toLowerCase() === "am" ? "am" : "en";

    const utterance =
      new SpeechSynthesisUtterance(text);
    utterance.lang = language === "am" ? "am-ET" : "en-US";

    const selectedVoice = pickVoice(language);
    if (selectedVoice) utterance.voice = selectedVoice;

    /*
     * Clear, short live-game announcement.
     */
    utterance.rate = 0.88;
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
    number,
    language = "en"
  }) {

    game = String(game || "").toLowerCase();

    /*
     * Player must currently be watching this game.
     */
    if (!isActive(game, roundId, stake)) {
      return false;
    }

    number = Number(number);

    /* Prevent invalid announcements for the selected active game. */
    if (game === "bingo") {
      if (!Number.isInteger(number) || number < 1 || number > 75) {
        return false;
      }
    } else if (game === "keno") {
      if (!Number.isInteger(number) || number < 1 || number > 80) {
        return false;
      }
    } else {
      return false;
    }

    /*
     * Build correct voice.
     */
    const announcement =
      buildAnnouncement(game, number, language);

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

    speak(announcement, language);

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
