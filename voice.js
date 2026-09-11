/* DESTA PLAY — LIVE GAME VOICE ENGINE
   Voice playback is deliberately independent of the game engine.
   It uses server-proxied TTS audio so it works in Telegram Android WebView
   instead of depending on speechSynthesis support.
*/
const DestaVoice = (() => {
  let activeGame = null;
  let activeRoundId = null;
  let activeStake = null;
  let enabled = false;
  let speaking = false;
  let lastAnnouncementKey = null;
  let queue = [];
  let audio = null;
  let voices = [];
  let voicesReady = false;
  let unlocked = false;

  const MAX_QUEUE = 8;
  const VOICE_ENDPOINT = "/api/voice";

  function getBingoLetter(number){
    number = Number(number);
    if(!Number.isInteger(number)) return null;
    if(number >= 1 && number <= 15) return "B";
    if(number <= 30) return "I";
    if(number <= 45) return "N";
    if(number <= 60) return "G";
    if(number <= 75) return "O";
    return null;
  }

  function buildAnnouncement(game, number, language="en"){
    game = String(game || "").toLowerCase();
    number = Number(number);
    language = String(language || "en").toLowerCase() === "am" ? "am" : "en";
    if(!Number.isInteger(number)) return null;

    if(game === "bingo"){
      const letter = getBingoLetter(number);
      if(!letter) return null;
      if(language === "am"){
        const am = {B:"ቢ", I:"አይ", N:"ኤን", G:"ጂ", O:"ኦ"};
        return `${am[letter]} ${number}`;
      }
      return `${letter} ${number}`;
    }

    if(game === "keno" && number >= 1 && number <= 80)
      return String(number);

    return null;
  }

  function refreshVoices(){
    if(typeof window === "undefined" || !window.speechSynthesis) return;
    try{
      voices = window.speechSynthesis.getVoices() || [];
      voicesReady = voices.length > 0;
    }catch(e){
      voices = [];
      voicesReady = false;
    }
  }

  function init(){
    refreshVoices();
    if(typeof window !== "undefined" && window.speechSynthesis){
      try{ window.speechSynthesis.addEventListener("voiceschanged", refreshVoices); }catch(e){}
    }

    if(typeof window !== "undefined"){
      audio = document.createElement("audio");
      audio.id = "destaLiveVoiceAudio";
      audio.preload = "auto";
      audio.autoplay = false;
      audio.setAttribute("playsinline", "");
      audio.style.display = "none";
      document.addEventListener("DOMContentLoaded", () => {
        if(!document.getElementById("destaLiveVoiceAudio")){
          document.body.appendChild(audio);
        }
      });
      audio.onended = () => {
        speaking = false;
        playNext();
      };
      audio.onerror = () => {
        speaking = false;
        playNext();
      };
    }
  }

  function ensureAudioElement(){
    if(typeof window === "undefined") return null;
    if(audio && audio.isConnected) return audio;
    audio = document.getElementById("destaLiveVoiceAudio") || document.createElement("audio");
    audio.id = "destaLiveVoiceAudio";
    audio.preload = "auto";
    audio.autoplay = false;
    audio.setAttribute("playsinline", "");
    audio.style.display = "none";
    if(!audio.isConnected && document.body) document.body.appendChild(audio);
    audio.onended = () => { speaking = false; playNext(); };
    audio.onerror = () => { speaking = false; playNext(); };
    return audio;
  }

  /* Mobile autoplay unlock. This is called from the user's tap.
     A tiny silent WAV is played synchronously through the media element.
     The later TTS clips reuse the same media element. */
  function unlock(){
    const el = ensureAudioElement();
    if(!el) return false;

    try{
      const silentWav =
        "data:audio/wav;base64,UklGRkQDAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YSADAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==";
      el.src = silentWav;
      const p = el.play();
      if(p && typeof p.then === "function"){
        p.then(() => {
          try{ el.pause(); el.currentTime = 0; }catch(e){}
          unlocked = true;
        }).catch(() => {});
      }else{
        unlocked = true;
      }
      return true;
    }catch(e){
      return false;
    }
  }

  function stopVoice(){
    queue = [];
    lastAnnouncementKey = null;
    speaking = false;
    const el = ensureAudioElement();
    if(el){
      try{ el.pause(); el.currentTime = 0; el.removeAttribute("src"); el.load(); }catch(e){}
    }
    if(typeof window !== "undefined" && window.speechSynthesis){
      try{ window.speechSynthesis.cancel(); }catch(e){}
    }
  }

  function enterLiveGame(game, roundId, stake){
    stopVoice();
    activeGame = String(game || "").toLowerCase();
    activeRoundId = roundId == null ? null : String(roundId);
    activeStake = stake == null ? null : Number(stake);
    lastAnnouncementKey = null;
  }

  function leaveLiveGame(){
    stopVoice();
    activeGame = null;
    activeRoundId = null;
    activeStake = null;
  }

  function isActive(game, roundId, stake){
    game = String(game || "").toLowerCase();
    if(activeGame !== game) return false;
    if(activeRoundId !== null && roundId != null &&
       String(activeRoundId) !== String(roundId)) return false;
    if(activeStake !== null && stake != null &&
       Number(activeStake) !== Number(stake)) return false;
    return true;
  }

  function ttsUrl(text, language){
    const lang = String(language || "en").toLowerCase() === "am" ? "am" : "en";
    return `${VOICE_ENDPOINT}?lang=${encodeURIComponent(lang)}&text=${encodeURIComponent(String(text))}`;
  }

  function playNext(){
    if(!enabled || speaking || !queue.length) return;

    const item = queue.shift();
    const el = ensureAudioElement();
    if(!el){
      speaking = false;
      return;
    }

    speaking = true;
    try{
      el.src = ttsUrl(item.text, item.language);
      el.load();
      const p = el.play();
      if(p && typeof p.catch === "function"){
        p.catch(() => {
          /* If the WebView rejects the clip, do not loop forever.
             The next server draw will try again after the user has
             interacted with the page. */
          speaking = false;
          playNext();
        });
      }
    }catch(e){
      speaking = false;
      playNext();
    }
  }

  function speakText(text, language="en"){
    if(!enabled || !String(text || "").trim()) return false;
    const normalized = String(language || "en").toLowerCase() === "am" ? "am" : "en";
    unlock();
    queue.unshift({text:String(text), language:normalized});
    if(queue.length > MAX_QUEUE) queue.length = MAX_QUEUE;
    playNext();
    return true;
  }

  function announceDraw({game, roundId, stake, number, language="en"}){
    game = String(game || "").toLowerCase();
    number = Number(number);

    if(!enabled || !isActive(game, roundId, stake)) return false;
    if(game === "bingo" && (!Number.isInteger(number) || number < 1 || number > 75)) return false;
    if(game === "keno" && (!Number.isInteger(number) || number < 1 || number > 80)) return false;

    const text = buildAnnouncement(game, number, language);
    if(!text) return false;

    const key = `${game}:${roundId}:${stake}:${number}:${String(language || "en").toLowerCase()}`;
    if(key === lastAnnouncementKey) return false;
    lastAnnouncementKey = key;

    queue.push({
      text,
      language:String(language || "en").toLowerCase() === "am" ? "am" : "en"
    });
    if(queue.length > MAX_QUEUE) queue.shift();
    playNext();
    return true;
  }

  function setEnabled(value){
    enabled = Boolean(value);
    if(!enabled) stopVoice();
    else unlock();
  }

  function toggle(){
    setEnabled(!enabled);
    return enabled;
  }

  function getState(){
    return {
      enabled,
      speaking,
      activeGame,
      activeRoundId,
      activeStake,
      voicesReady,
      voiceCount:voices.length,
      unlocked
    };
  }

  init();

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

if(typeof window !== "undefined") window.DestaVoice = DestaVoice;
