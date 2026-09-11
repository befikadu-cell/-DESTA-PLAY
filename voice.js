/* DESTA PLAY — SINGLE LIVE GAME VOICE ENGINE */
const DestaVoice = (() => {
  let enabled = false;
  let speaking = false;
  let activeGame = null;
  let activeRoundId = null;
  let activeStake = null;
  let queue = [];
  let voices = [];
  let voicesReady = false;
  let lastAnnouncementKey = null;
  let unlocked = false;

  const synth = () => (typeof window !== "undefined" ? window.speechSynthesis : null);

  function refreshVoices(){
    const s=synth();
    if(!s) return;
    try{ voices=s.getVoices()||[]; voicesReady=voices.length>0; }catch(e){ voices=[]; voicesReady=false; }
  }

  function init(){
    refreshVoices();
    const s=synth();
    if(s){
      try{s.addEventListener("voiceschanged",refreshVoices);}catch(e){}
      try{setTimeout(refreshVoices,250);setTimeout(refreshVoices,1000);}catch(e){}
    }
  }
  init();

  function normalizeLanguage(language){
    return String(language||"en").toLowerCase().startsWith("am") ? "am" : "en";
  }

  function getBingoLetter(number){
    const n=Number(number);
    if(!Number.isInteger(n)||n<1||n>75) return null;
    if(n<=15) return "B";
    if(n<=30) return "I";
    if(n<=45) return "N";
    if(n<=60) return "G";
    return "O";
  }

  function buildAnnouncement(game,number,language="en"){
    const g=String(game||"").toLowerCase();
    const n=Number(number);
    const lang=normalizeLanguage(language);
    if(!Number.isInteger(n)) return null;
    if(g==="bingo"){
      const letter=getBingoLetter(n);
      if(!letter) return null;
      if(lang==="am"){
        const am={B:"ቢ",I:"አይ",N:"ኤን",G:"ጂ",O:"ኦ"};
        return `${am[letter]} ${n}`;
      }
      return `${letter} ${n}`;
    }
    if(g==="keno" && n>=1 && n<=80) return String(n);
    return null;
  }

  function chooseVoice(language){
    refreshVoices();
    const lang=normalizeLanguage(language);
    const prefix=lang==="am"?"am":"en";
    if(lang==="am"){
      return voices.find(v=>String(v.lang||"").toLowerCase()==="am-et") ||
             voices.find(v=>String(v.lang||"").toLowerCase().startsWith("am-")) ||
             null;
    }
    return voices.find(v=>String(v.lang||"").toLowerCase()==="en-us") ||
           voices.find(v=>String(v.lang||"").toLowerCase().startsWith(prefix+"-")) ||
           voices.find(v=>String(v.lang||"").toLowerCase()==="en") || null;
  }

  function stopVoice(){
    queue=[];
    const s=synth();
    if(s){try{s.cancel();}catch(e){}}
    speaking=false;
  }

  function unlock(){
    const s=synth();
    unlocked=true;
    if(!s) return false;
    try{s.resume();}catch(e){}
    return true;
  }

  function speakNow(text,language="en"){
    if(!enabled || !String(text||"").trim()) return false;
    const s=synth();
    if(!s || typeof SpeechSynthesisUtterance==="undefined") return false;
    const lang=normalizeLanguage(language);
    try{
      s.resume();
      const u=new SpeechSynthesisUtterance(String(text));
      u.lang=lang==="am"?"am-ET":"en-US";
      const v=chooseVoice(lang);
      if(v) u.voice=v;
      u.rate=0.86;
      u.pitch=1;
      u.volume=1;
      speaking=true;
      u.onend=()=>{speaking=false;playNext();};
      u.onerror=()=>{speaking=false;playNext();};
      s.speak(u);
      return true;
    }catch(e){speaking=false;return false;}
  }

  function playNext(){
    if(!enabled || speaking || !queue.length) return;
    const item=queue.shift();
    if(!speakNow(item.text,item.language)){
      speaking=false;
      if(queue.length) setTimeout(playNext,120);
    }
  }

  function enqueue(text,language="en",front=false){
    if(!enabled || !String(text||"").trim()) return false;
    const item={text:String(text),language:normalizeLanguage(language)};
    if(front) queue.unshift(item); else queue.push(item);
    if(queue.length>12) queue.splice(0,queue.length-12);
    playNext();
    return true;
  }

  function speakText(text,language="en"){
    unlock();
    return enqueue(text,language,true);
  }

  function enterLiveGame(game,roundId,stake){
    stopVoice();
    activeGame=String(game||"").toLowerCase();
    activeRoundId=roundId==null?null:String(roundId);
    activeStake=stake==null?null:Number(stake);
    lastAnnouncementKey=null;
    refreshVoices();
    unlock();
  }

  function leaveLiveGame(){
    stopVoice();
    activeGame=null;
    activeRoundId=null;
    activeStake=null;
    lastAnnouncementKey=null;
  }

  function isActive(game,roundId,stake){
    const g=String(game||"").toLowerCase();
    if(activeGame!==g) return false;
    if(activeRoundId!==null && roundId!=null && String(activeRoundId)!==String(roundId)) return false;
    return true;
  }

  function announceDraw({game,roundId,stake,number,language="en"}){
    const g=String(game||"").toLowerCase();
    const n=Number(number);
    if(!enabled || !isActive(g,roundId,stake)) return false;
    if(g==="bingo" && (!Number.isInteger(n)||n<1||n>75)) return false;
    if(g==="keno" && (!Number.isInteger(n)||n<1||n>80)) return false;
    const lang=normalizeLanguage(language);
    const text=buildAnnouncement(g,n,lang);
    if(!text) return false;
    const key=`${g}:${String(roundId??"")}:${n}:${lang}`;
    if(key===lastAnnouncementKey) return false;
    lastAnnouncementKey=key;
    unlock();
    return enqueue(text,lang,false);
  }

  function setEnabled(value){
    enabled=Boolean(value);
    if(!enabled) stopVoice();
    else {refreshVoices();unlock();}
  }

  function toggle(){setEnabled(!enabled);return enabled;}

  function getState(){
    refreshVoices();
    return {enabled,speaking,activeGame,activeRoundId,activeStake,voicesReady,voiceCount:voices.length,unlocked};
  }

  return {enterLiveGame,leaveLiveGame,announceDraw,buildAnnouncement,getBingoLetter,setEnabled,toggle,stopVoice,speakText,unlock,getState};
})();

if(typeof window!=="undefined") window.DestaVoice=DestaVoice;
