/* DESTA PLAY — LIVE GAME VOICE ENGINE */
const DestaVoice = (() => {
  let activeGame = null;
  let activeRoundId = null;
  let activeStake = null;
  let enabled = false;
  let speaking = false;
  let lastAnnouncementKey = null;
  let queue = [];
  let voices = [];
  let voicesReady = false;

  function refreshVoices(){
    if(typeof window === "undefined" || !window.speechSynthesis) return;
    try{
      voices = window.speechSynthesis.getVoices() || [];
      voicesReady = voices.length > 0;
    }catch(e){ voices=[]; }
  }

  function initVoices(){
    refreshVoices();
    if(typeof window !== "undefined" && window.speechSynthesis){
      try{ window.speechSynthesis.addEventListener("voiceschanged", refreshVoices); }catch(e){}
    }
  }
  initVoices();

  function getBingoLetter(number){
    number=Number(number);
    if(!Number.isInteger(number)) return null;
    if(number>=1 && number<=15) return "B";
    if(number<=30) return "I";
    if(number<=45) return "N";
    if(number<=60) return "G";
    if(number<=75) return "O";
    return null;
  }

  function buildAnnouncement(game, number, language="en"){
    game=String(game||"").toLowerCase();
    number=Number(number);
    language=String(language||"en").toLowerCase()==="am" ? "am" : "en";
    if(!Number.isInteger(number)) return null;
    if(game==="bingo"){
      const letter=getBingoLetter(number);
      if(!letter) return null;
      if(language==="am"){
        const am={B:"ቢ",I:"አይ",N:"ኤን",G:"ጂ",O:"ኦ"};
        return `${am[letter]} ${number}`;
      }
      return `${letter} ${number}`;
    }
    if(game==="keno" && number>=1 && number<=80) return String(number);
    return null;
  }

  function stopVoice(){
    queue=[];
    if(typeof window!=="undefined" && window.speechSynthesis){
      try{ window.speechSynthesis.cancel(); }catch(e){}
    }
    speaking=false;
  }

  function chooseVoice(language){
    refreshVoices();
    const prefix=language==="am" ? "am" : "en";
    const exact=voices.find(v=>String(v.lang||"").toLowerCase()===`${prefix}-${language==="am"?"et":"us"}`);
    if(exact) return exact;
    const regional=voices.find(v=>String(v.lang||"").toLowerCase().startsWith(prefix+"-"));
    if(regional) return regional;
    return voices.find(v=>String(v.lang||"").toLowerCase()===prefix) || null;
  }

  function speak(text, language="en"){
    if(!enabled || !text || typeof window==="undefined" || !window.speechSynthesis || typeof SpeechSynthesisUtterance==="undefined") return false;
    language=String(language||"en").toLowerCase()==="am" ? "am" : "en";
    const utterance=new SpeechSynthesisUtterance(String(text));
    utterance.lang=language==="am" ? "am-ET" : "en-US";
    const voice=chooseVoice(language);
    if(voice) utterance.voice=voice;
    utterance.rate=0.9;
    utterance.pitch=1;
    utterance.volume=1;
    speaking=true;
    utterance.onend=()=>{ speaking=false; playNext(); };
    utterance.onerror=()=>{ speaking=false; playNext(); };
    try{
      window.speechSynthesis.resume();
      window.speechSynthesis.speak(utterance);
      return true;
    }catch(e){ speaking=false; return false; }
  }

  function playNext(){
    if(!enabled || speaking || !queue.length) return;
    const item=queue.shift();
    speak(item.text,item.language);
  }

  function enterLiveGame(game, roundId, stake){
    stopVoice();
    activeGame=String(game||"").toLowerCase();
    activeRoundId=roundId==null?null:String(roundId);
    activeStake=stake==null?null:Number(stake);
    lastAnnouncementKey=null;
    refreshVoices();
  }

  function leaveLiveGame(){
    stopVoice();
    activeGame=null;
    activeRoundId=null;
    activeStake=null;
    lastAnnouncementKey=null;
  }

  function isActive(game, roundId, stake){
    game=String(game||"").toLowerCase();
    if(activeGame!==game) return false;
    if(activeRoundId!==null && roundId!=null && String(activeRoundId)!==String(roundId)) return false;
    if(activeStake!==null && stake!=null && Number(activeStake)!==Number(stake)) return false;
    return true;
  }

  function announceDraw({game,roundId,stake,number,language="en"}){
    game=String(game||"").toLowerCase();
    number=Number(number);
    if(!enabled || !isActive(game,roundId,stake)) return false;
    if(game==="bingo" && (!Number.isInteger(number)||number<1||number>75)) return false;
    if(game==="keno" && (!Number.isInteger(number)||number<1||number>80)) return false;
    const text=buildAnnouncement(game,number,language);
    if(!text) return false;
    const key=`${game}:${roundId}:${stake}:${number}`;
    if(key===lastAnnouncementKey) return false;
    lastAnnouncementKey=key;
    queue.push({text,language:String(language||"en").toLowerCase()==="am"?"am":"en"});
    if(queue.length>8) queue.splice(0,queue.length-8);
    playNext();
    return true;
  }

  function setEnabled(value){
    enabled=Boolean(value);
    if(!enabled) stopVoice();
    else { refreshVoices(); if(typeof window!=="undefined"&&window.speechSynthesis){try{window.speechSynthesis.resume();}catch(e){}} }
  }

  function toggle(){ setEnabled(!enabled); return enabled; }

  function speakText(text, language="en"){
    if(!enabled || !text) return false;
    const normalized=String(language||"en").toLowerCase()==="am" ? "am" : "en";
    queue.unshift({text:String(text),language:normalized});
    playNext();
    return true;
  }

  function getState(){ return {enabled,speaking,activeGame,activeRoundId,activeStake,voicesReady,voiceCount:voices.length}; }

  return {enterLiveGame,leaveLiveGame,announceDraw,buildAnnouncement,getBingoLetter,setEnabled,toggle,stopVoice,speakText,getState};
})();

if(typeof window!=="undefined") window.DestaVoice=DestaVoice;
