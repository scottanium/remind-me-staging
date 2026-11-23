/* Remind Me speech input. Loaded after ics.js and before app.js.
 * Receives shared page helpers through RemindMeSpeech.attach(api).
 */
window.RemindMeSpeech = {
  attach: function (api) {
    "use strict";
    var $ = api.$;
    var show = api.show;
    var hide = api.hide;
    var toast = api.toast;
    var setStatus = api.setStatus;
    var recognition = null;
    var listening = false;

/* ---------- speech ---------- */
var SpeechAPI = window.SpeechRecognition || window.webkitSpeechRecognition || null;
var wantListening = false;
var finalizedThisTurn = false;
var restartCount = 0;
var listenTimer = null;
var silenceTimer = null;
var lastFinal = "";
var lastInterim = "";
var keyboardMicMode = false;
var keyboardParseTimer = null;
var MAX_RESTARTS = 1;
var MAX_LISTEN_MS = 10000;
var SILENCE_MS = 1600;

function isIOSDevice() {
  var ua = navigator.userAgent || "";
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  if (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1) return true;
  return false;
}

function isStandalonePwa() {
  if (navigator.standalone === true) return true;
  try {
    if (window.matchMedia("(display-mode: standalone)").matches) return true;
    if (window.matchMedia("(display-mode: fullscreen)").matches) return true;
  } catch (e) {}
  return false;
}

function clearSpeechTimers() {
  clearTimeout(listenTimer);
  clearTimeout(silenceTimer);
  listenTimer = null;
  silenceTimer = null;
}

function setListeningUI(on) {
  listening = !!on;
  $("micBtn").classList.toggle("listening", !!on);
  $("micBtn").setAttribute("aria-pressed", on ? "true" : "false");
  $("micHint").textContent = on ? "Listening… tap to stop" : (SpeechAPI ? "Tap to speak" : "Use the keyboard mic");
}

function bindRecognizer(rec) {
  rec.lang = "en-US";
  rec.interimResults = true;
  rec.continuous = false;
  rec.maxAlternatives = 1;
  rec.onstart = function () {
    listening = true;
    setListeningUI(true);
    if (!finalizedThisTurn) setStatus("");
  };
  rec.onaudiostart = function () {
    listening = true;
    setListeningUI(true);
  };
  rec.onerror = onSpeechError;
  rec.onend = onSpeechEnd;
  rec.onresult = onSpeechResult;
}

function ensureRecognizer() {
  if (!SpeechAPI) return null;
  if (!recognition) {
    recognition = new SpeechAPI();
    bindRecognizer(recognition);
  }
  recognition.lang = "en-US";
  recognition.interimResults = true;
  recognition.continuous = false;
  return recognition;
}

function onSpeechResult(ev) {
  var text = "";
  var finalText = "";
  for (var i = 0; i < ev.results.length; i++) {
    var piece = ev.results[i][0].transcript;
    text += piece + " ";
    if (ev.results[i].isFinal) finalText += piece + " ";
  }
  lastInterim = text.trim();
  if (finalText.trim()) lastFinal = finalText.trim();
  var shown = lastFinal || lastInterim;
  if (shown) {
    var box = $("transcript");
    box.textContent = "“" + shown + "”";
    show(box);
    $("typeInput").value = shown;
  }
  clearTimeout(silenceTimer);
  silenceTimer = setTimeout(function () {
    finalizeListen("silence");
  }, SILENCE_MS);
}

function onSpeechError(ev) {
  var err = ev && ev.error;
  if (err === "aborted") return;
  var ios = isIOSDevice();
  var messages = {
    "not-allowed": ios
      ? "This page doesn’t have permission to use the mic. In Safari, tap the Page Menu (left of the address bar) → Website Settings → Microphone → Allow. Or use the keyboard mic — that uses Apple’s dictation and doesn’t need this permission."
      : "I couldn’t use the microphone. Check this site’s permission, or type instead.",
    "service-not-allowed": "Voice recognition looks turned off on this iPhone. Go to Settings → General → Keyboard and turn on Enable Dictation. Siri being on can help too. Or use the keyboard mic after Dictation is on.",
    "service-not-available": "Voice recognition isn’t available right now. Use the keyboard mic, or try the yellow button again in Safari.",
    "no-speech": "I didn’t catch any speech. Try again a little closer to the phone, or use the keyboard mic.",
    "network": "The yellow mic usually needs a network connection. The keyboard mic often works without one — try that, or get on Wi‑Fi and try the yellow button again.",
    "audio-capture": "I couldn’t reach the microphone. Close other apps that might be using it, or use the keyboard mic."
  };
  if (err === "no-speech") {
    setStatus(messages[err]);
    return;
  }
  wantListening = false;
  finalizedThisTurn = true;
  clearSpeechTimers();
  setListeningUI(false);
  setStatus(messages[err] || "The yellow mic had a problem. Use the keyboard mic — it uses your iPhone’s built-in dictation.");
  if (ios) show($("keyboardMicBtn"));
}

function onSpeechEnd() {
  setListeningUI(false);
  if (finalizedThisTurn) {
    wantListening = false;
    return;
  }
  var text = (lastFinal || lastInterim).trim();
  if (text) {
    finalizeListen("end");
    return;
  }
  if (wantListening && restartCount < MAX_RESTARTS) {
    restartCount += 1;
    setTimeout(function () {
      if (!wantListening || finalizedThisTurn) return;
      try {
        ensureRecognizer();
        recognition.start();
      } catch (e) {
        wantListening = false;
        setListeningUI(false);
        setStatus("The mic stopped early. If the yellow button won’t stay on, use the keyboard mic.");
        if (isIOSDevice()) enterKeyboardMicMode();
      }
    }, 250);
    return;
  }
  wantListening = false;
  if (!text) setStatus("I didn’t catch that. Try the yellow mic again, or use the keyboard mic.");
}

function finalizeListen(reason) {
  if (finalizedThisTurn) return;
  finalizedThisTurn = true;
  wantListening = false;
  clearSpeechTimers();
  try { if (recognition) recognition.stop(); } catch (e) {}
  setListeningUI(false);
  // Only use what this listen session heard — never a leftover text-box phrase.
  var text = (lastFinal || lastInterim).trim();
  if (text) api.maybeOpenFromText(text, true);
  else if (reason !== "error") setStatus("I didn’t catch that. Try again, or use the keyboard mic.");
}

/* Called only from a user tap so iOS will allow the mic to start. */
function startRecognitionFromGesture() {
  if (!SpeechAPI) {
    setStatus("The yellow mic isn’t available here. Use the keyboard mic — that uses your iPhone’s built-in dictation.");
    enterKeyboardMicMode();
    return;
  }
  wantListening = true;
  restartCount = 0;
  lastFinal = "";
  lastInterim = "";
  finalizedThisTurn = false;
  clearSpeechTimers();
  setStatus("");
  try {
    ensureRecognizer();
    recognition.start();
  } catch (e) {
    try { if (recognition) recognition.abort(); } catch (x) {}
    try {
      recognition = new SpeechAPI();
      bindRecognizer(recognition);
      recognition.start();
    } catch (e2) {
      wantListening = false;
      setListeningUI(false);
      setStatus("I couldn’t start the yellow mic. Use the keyboard mic instead — it uses your iPhone’s own dictation.");
      if (isIOSDevice()) enterKeyboardMicMode();
      return;
    }
  }
  listenTimer = setTimeout(function () { finalizeListen("timeout"); }, MAX_LISTEN_MS);
}

function stopRecognitionFromGesture() {
  wantListening = false;
  clearSpeechTimers();
  var text = (lastFinal || lastInterim).trim();
  if (text) finalizeListen("user-stop");
  else {
    finalizedThisTurn = true;
    try { if (recognition) recognition.stop(); } catch (e) {}
    setListeningUI(false);
    setStatus("Stopped. Tap the yellow mic to try again, or use the keyboard mic.");
  }
}

function enterKeyboardMicMode() {
  keyboardMicMode = true;
  var composer = document.querySelector(".composer");
  if (composer) composer.classList.add("keyboard-mode");
  show($("keyboardCoach"));
  show($("keyboardMicBtn"));
  var input = $("typeInput");
  input.setAttribute("placeholder", "Speak after tapping the keyboard’s microphone key…");
  input.focus();
  try { input.setSelectionRange(input.value.length, input.value.length); } catch (e) {}
}

function exitKeyboardMicMode() {
  keyboardMicMode = false;
  clearTimeout(keyboardParseTimer);
  var composer = document.querySelector(".composer");
  if (composer) composer.classList.remove("keyboard-mode");
  hide($("keyboardCoach"));
  $("typeInput").setAttribute("placeholder", "Or type: dentist Tuesday at 2, remind me an hour before");
}

function tryKeyboardParse() {
  if (!keyboardMicMode) return;
  var text = $("typeInput").value.trim();
  if (!text) return;
  api.maybeOpenFromText(text, true);
}

function scheduleKeyboardParse() {
  if (!keyboardMicMode) return;
  clearTimeout(keyboardParseTimer);
  keyboardParseTimer = setTimeout(tryKeyboardParse, 1600);
}

function safariUrl() {
  return window.location.href.split("#")[0];
}

function copySafariLink() {
  var url = safariUrl();
  function ok() { toast("Link copied. Open it in Safari."); }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url).then(ok).catch(function () {
      window.prompt("Copy this link and open it in Safari:", url);
    });
  } else {
    window.prompt("Copy this link and open it in Safari:", url);
  }
}

function setupSpeech() {
  var ios = isIOSDevice();
  var standalone = isStandalonePwa();
  var banner = $("speechBanner");
  var micBtn = $("micBtn");
  var hint = $("micHint");
  var kbtn = $("keyboardMicBtn");
  var copyBtn = $("copySafariBtn");

  if (ios) {
    kbtn.textContent = "Use iPhone keyboard mic";
    show(kbtn);
  } else if (!SpeechAPI) {
    kbtn.textContent = "Use keyboard dictation";
    show(kbtn);
  }

  if (ios && standalone && !SpeechAPI) {
    banner.innerHTML = "The yellow mic usually doesn’t work in the Home Screen app — that’s an iPhone limit. Tap <strong>Use iPhone keyboard mic</strong> below, or copy the link and open this page in Safari.";
    show(banner);
    show(copyBtn);
  } else if (ios && standalone && SpeechAPI) {
    banner.textContent = "You’re in the Home Screen app. The yellow mic works on some iPhones and not others. If it doesn’t listen, use the keyboard mic — that always uses Apple’s dictation.";
    show(banner);
    show(copyBtn);
  } else if (ios && !SpeechAPI) {
    banner.innerHTML = "The yellow mic isn’t available in this browser. Open this page in <strong>Safari</strong> (the compass icon) for the yellow button, or use the keyboard mic — Apple’s dictation works here.";
    show(banner);
    show(copyBtn);
  } else if (!SpeechAPI) {
    banner.textContent = "The yellow mic isn’t available in this browser (common in Firefox). Type your reminder, or use your keyboard’s microphone key if you have one.";
    show(banner);
  }

  if (!SpeechAPI) {
    hint.textContent = ios ? "Use the keyboard mic" : "Type a reminder below";
    micBtn.addEventListener("click", function () {
      setStatus(ios
        ? "The yellow mic isn’t available here. Use the keyboard mic — that uses your iPhone’s built-in dictation."
        : "Voice input isn’t available here. Type your reminder instead.");
      enterKeyboardMicMode();
    });
  } else {
    hint.textContent = "Tap to speak";
    micBtn.addEventListener("click", function () {
      if (listening || wantListening) {
        stopRecognitionFromGesture();
        return;
      }
      startRecognitionFromGesture();
    });
  }

  kbtn.addEventListener("click", function () {
    if (listening || wantListening) stopRecognitionFromGesture();
    setStatus("");
    enterKeyboardMicMode();
  });
  copyBtn.addEventListener("click", copySafariLink);

  $("typeInput").addEventListener("input", scheduleKeyboardParse);
  $("typeInput").addEventListener("blur", function () {
    if (!keyboardMicMode) return;
    clearTimeout(keyboardParseTimer);
    tryKeyboardParse();
  });

  document.addEventListener("visibilitychange", function () {
    if (document.hidden && (listening || wantListening)) {
      wantListening = false;
      finalizedThisTurn = true;
      clearSpeechTimers();
      try { if (recognition) recognition.stop(); } catch (e) {}
      setListeningUI(false);
    }
  });
}


    function resetListenState() {
      lastFinal = "";
      lastInterim = "";
      wantListening = false;
      finalizedThisTurn = true;
      restartCount = 0;
      clearSpeechTimers();
      try { if (recognition) recognition.stop(); } catch (e) {}
      setListeningUI(false);
      exitKeyboardMicMode();
    }

    return {
      setupSpeech: setupSpeech,
      startRecognitionFromGesture: startRecognitionFromGesture,
      stopRecognitionFromGesture: stopRecognitionFromGesture,
      enterKeyboardMicMode: enterKeyboardMicMode,
      exitKeyboardMicMode: exitKeyboardMicMode,
      scheduleKeyboardParse: scheduleKeyboardParse,
      copySafariLink: copySafariLink,
      resetListenState: resetListenState,
      getTestState: function () {
        return {
          lastFinal: lastFinal,
          lastInterim: lastInterim,
          keyboardMicMode: keyboardMicMode
        };
      }
    };
  }
};
