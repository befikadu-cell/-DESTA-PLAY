/*
 * DESTA PLAY — NATURAL LIVE GAME VOICE
 *
 * Playback is server-generated Microsoft Neural TTS.
 * This deliberately does NOT depend on browser speechSynthesis, because
 * Telegram Android WebView may not expose a working speech engine.
 *
 * Rules:
 *   BINGO -> LETTER + NUMBER (B 12, G 47, O 71)
 *   KENO  -> NUMBER ONLY (12, 47, 71)
 *
 * The number is accepted only from the server-authoritative round state.
 * The same engine is used by the real room and Watch Live.
 */
const DestaVoice = (() => {
  let activeGame = null;
  let activeRoundId = null;
  let activeStake = null;
  let enabled = false;
  let speaking = false;
  let lastAnnouncementKey = null;
  let queue = [];
  let requestSeq = 0;
  let currentAudio = null;
  let unlocked = false;
  const MAX_QUEUE = 8;

  function getBingoLetter(number) {
    number = Number(number);
    if (!Number.isInteger(number)) return null;
    if (number >= 1 && number <= 15) return "B";
    if (number >= 16 && number <= 30) return "I";
    if (number >= 31 && number <= 45) return "N";
    if (number >= 46 && number <= 60) return "G";
    if (number >= 61 && number <= 75) return "O";
    return null;
  }

  function buildAnnouncement(game, number, language = "en") {
    game = String(game || "").toLowerCase();
    number = Number(number);
    const lang = String(language || "en").toLowerCase() === "am" ? "am" : "en";
    if (!Number.isInteger(number)) return null;

    if (game === "bingo") {
      const letter = getBingoLetter(number);
      if (!letter) return null;
      if (lang === "am") {
        const am = { B:"ቢ", I:"አይ", N:"ኤን", G:"ጂ", O:"ኦ" };
        return `${am[letter]} ${number}`;
      }
      return `${letter} ${number}`;
    }

    if (game === "keno" && number >= 1 && number <= 80) {
      return String(number);
    }
    return null;
  }

  function stopCurrentAudio() {
    const audio = currentAudio;
    currentAudio = null;
    if (!audio) return;
    try { audio.pause(); } catch (_) {}
    try { audio.currentTime = 0; } catch (_) {}
    try { audio.removeAttribute("src"); audio.load(); } catch (_) {}
  }

  function stopVoice() {
    requestSeq++;
    queue = [];
    speaking = false;
    stopCurrentAudio();
  }

  function enterLiveGame(game, roundId, stake) {
    stopVoice();
    activeGame = String(game || "").toLowerCase();
    activeRoundId = roundId == null ? null : String(roundId);
    activeStake = stake == null ? null : Number(stake);
    lastAnnouncementKey = null;
  }

  function leaveLiveGame() {
    stopVoice();
    activeGame = null;
    activeRoundId = null;
    activeStake = null;
    lastAnnouncementKey = null;
  }

  function isActive(game, roundId, stake) {
    game = String(game || "").toLowerCase();
    if (activeGame !== game) return false;
    if (activeRoundId !== null && roundId != null && String(activeRoundId) !== String(roundId)) return false;
    if (activeStake !== null && stake != null && Number(activeStake) !== Number(stake)) return false;
    return true;
  }

  function audioUrl(text, language) {
    return `/api/voice?lang=${encodeURIComponent(language)}&text=${encodeURIComponent(text)}`;
  }

  async function playItem(item, seq) {
    if (!enabled || seq !== requestSeq) return false;
    const text = String(item.text || "").trim();
    if (!text) return false;

    const audio = new Audio();
    audio.preload = "auto";
    audio.volume = 1;
    currentAudio = audio;

    const cleanup = () => {
      if (currentAudio === audio) currentAudio = null;
      speaking = false;
    };

    audio.onended = () => {
      cleanup();
      if (seq === requestSeq) playNext();
    };
    audio.onerror = () => {
      cleanup();
      if (seq === requestSeq) playNext();
    };

    try {
      audio.src = audioUrl(text, item.language);
      speaking = true;
      await audio.play();
      unlocked = true;
      return true;
    } catch (_) {
      cleanup();
      return false;
    }
  }

  async function playNext() {
    if (!enabled || speaking || !queue.length) return;
    const item = queue.shift();
    const seq = requestSeq;
    const ok = await playItem(item, seq);
    if (!ok && seq === requestSeq) {
      speaking = false;
      setTimeout(playNext, 0);
    }
  }

  /* Called by the Voice button user gesture. A short natural test phrase
     is intentionally handled by the normal server TTS endpoint. */
  async function unlock() {
    unlocked = true;
    if (!enabled) return true;
    return true;
  }

  function speakText(text, language = "en") {
    if (!enabled || !String(text || "").trim()) return false;
    queue.unshift({
      text: String(text),
      language: String(language || "en").toLowerCase() === "am" ? "am" : "en"
    });
    if (queue.length > MAX_QUEUE) queue.length = MAX_QUEUE;
    playNext();
    return true;
  }

  function announceDraw({ game, roundId, stake, number, language = "en" }) {
    game = String(game || "").toLowerCase();
    number = Number(number);
    const lang = String(language || "en").toLowerCase() === "am" ? "am" : "en";

    if (!enabled || !isActive(game, roundId, stake)) return false;
    if (game === "bingo" && (!Number.isInteger(number) || number < 1 || number > 75)) return false;
    if (game === "keno" && (!Number.isInteger(number) || number < 1 || number > 80)) return false;

    const text = buildAnnouncement(game, number, lang);
    if (!text) return false;

    const key = `${game}:${roundId}:${stake}:${number}:${lang}`;
    if (key === lastAnnouncementKey) return false;
    lastAnnouncementKey = key;

    queue.push({ text, language: lang });
    if (queue.length > MAX_QUEUE) queue.shift();
    playNext();
    return true;
  }

  function setEnabled(value) {
    enabled = Boolean(value);
    if (!enabled) stopVoice();
    else unlock();
  }

  function toggle() {
    setEnabled(!enabled);
    return enabled;
  }

  function getState() {
    return {
      enabled,
      speaking,
      activeGame,
      activeRoundId,
      activeStake,
      supported: true,
      unlocked
    };
  }

  if (typeof window !== "undefined") {
    window.addEventListener("pagehide", stopVoice);
  }

  return {
    enterLiveGame,
    leaveLiveGame,
    announceDraw,
    buildAnnouncement,
    getBingoLetter,
    setEnabled,
    toggle,
    stopVoice,
    speakText,
    unlock,
    getState
  };
})();

if (typeof window !== "undefined") window.DestaVoice = DestaVoice;
