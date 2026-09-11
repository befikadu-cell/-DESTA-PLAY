const DestaVoice = (() => {
  let activeGame = null;
  let activeRoundId = null;
  let activeStake = null;
  let enabled = true;
  let speaking = false;
  let lastAnnouncementKey = null;
  let queue = [];
  let currentAudio = null;
  let requestSeq = 0;
  const MAX_QUEUE = 12;
  const VOICE_API_BASE = "https://desta-play.onrender.com";

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
      if (letter === "O") return `O, ${number}`;
      return `${letter} ${number}`;
    }

    if (game === "keno" && number >= 1 && number <= 80) return String(number);
    return null;
  }

  function stopVoice() {
    queue = [];
    requestSeq++;
    if (currentAudio) {
      try { currentAudio.pause(); } catch (_) {}
      try { currentAudio.currentTime = 0; } catch (_) {}
      currentAudio = null;
    }
    speaking = false;
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

  function playNext() {
    if (!enabled || speaking || !queue.length) return;
    if (!activeGame || (activeGame !== "bingo" && activeGame !== "keno")) { stopVoice(); return; }
    const gameScreen = document.getElementById("gameScreen");
    if (gameScreen && gameScreen.classList.contains("hidden")) { stopVoice(); return; }
    const item = queue.shift();
    const seq = requestSeq;
    const lang = item.language === "am" ? "am" : "en";
    const text = String(item.text || "").trim();
    if (!text) return playNext();

    speaking = true;
    const url = VOICE_API_BASE + "/api/voice?lang=" + encodeURIComponent(lang) + "&text=" + encodeURIComponent(text);
    const audio = new Audio(url);
    currentAudio = audio;
    audio.preload = "auto";
    audio.volume = 1;

    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      if (seq === requestSeq) {
        currentAudio = null;
        speaking = false;
        playNext();
      }
    };

    audio.onended = finish;
    audio.onerror = finish;
    audio.onabort = finish;
    setTimeout(finish, 8000);

    audio.play().catch(() => finish());
  }

  function queueText(text, language = "en", priority = false) {
    if (!enabled || !String(text || "").trim()) return false;
    if (!activeGame || (activeGame !== "bingo" && activeGame !== "keno")) return false;
    const gameScreen = document.getElementById("gameScreen");
    if (gameScreen && gameScreen.classList.contains("hidden")) return false;
    const item = { text:String(text), language:language === "am" ? "am" : "en" };
    if (priority) queue.unshift(item); else queue.push(item);
    if (queue.length > MAX_QUEUE) queue.splice(0, queue.length - MAX_QUEUE);
    playNext();
    return true;
  }

  function speakText(text, language = "en") {
    return queueText(text, language, true);
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

    return queueText(text, lang, false);
  }

  function unlock() { return true; }

  function setEnabled(value) {
    enabled = Boolean(value);
    if (!enabled) stopVoice();
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
      supported: true
    };
  }

  if (typeof window !== "undefined") {
    window.addEventListener("pagehide", stopVoice);
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) stopVoice();
    });
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
