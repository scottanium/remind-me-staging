(function () {
  "use strict";

  var parser = window.ReminderParser;
  var store = window.ReminderStorage;
  var ics = window.ReminderICS;

  var state = store.load();
  var editingId = null;
  var timers = [];
  var fired = {};
  var recognition = null;
  var listening = false;
  var toastTimer = null;
  var askAction = null;

  var WEEKDAYS = parser.WEEKDAYS;

  var $ = function (id) { return document.getElementById(id); };

  function show(el) { el.classList.remove("hidden"); }
  function hide(el) { el.classList.add("hidden"); }

  function toast(msg) {
    var el = $("toast");
    el.textContent = msg;
    show(el);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { hide(el); }, 2800);
  }

  function setStatus(msg, ok) {
    var el = $("status");
    if (!msg) { hide(el); el.textContent = ""; return; }
    el.textContent = msg;
    el.classList.toggle("ok", !!ok);
    show(el);
  }

  function fillRecurSelect() {
    var sel = $("fieldRecur");
    var opts = [
      ["none", "Does not repeat"],
      ["daily", "Every day"],
      ["weekdays", "Weekdays (Mon–Fri)"],
      ["weekly", "Every week"],
      ["monthly", "Every month on this day"]
    ];
    WEEKDAYS.forEach(function (name, i) {
      var label = "Every " + name.charAt(0).toUpperCase() + name.slice(1);
      opts.push(["weekly-" + i, label]);
    });
    sel.innerHTML = opts.map(function (o) {
      return '<option value="' + o[0] + '">' + o[1] + "</option>";
    }).join("");
  }

  function recurToValue(recur) {
    if (!recur) return "none";
    if (recur.type === "daily") return "daily";
    if (recur.type === "weekdays") return "weekdays";
    if (recur.type === "monthly") return "monthly";
    if (recur.type === "weekly" && recur.weekday != null) return "weekly-" + recur.weekday;
    if (recur.type === "weekly") return "weekly";
    return "none";
  }

  function valueToRecur(value, dateStr) {
    if (!value || value === "none") return null;
    if (value === "daily") return { type: "daily" };
    if (value === "weekdays") return { type: "weekdays" };
    if (value === "monthly") {
      var day = parseInt(dateStr.split("-")[2], 10);
      return { type: "monthly", day: day };
    }
    if (value === "weekly") {
      var bits = dateStr.split("-").map(Number);
      var dow = new Date(Date.UTC(bits[0], bits[1] - 1, bits[2], 12)).getUTCDay();
      return { type: "weekly", weekday: dow };
    }
    if (value.indexOf("weekly-") === 0) {
      return { type: "weekly", weekday: parseInt(value.slice(7), 10) };
    }
    return null;
  }

  function ensureLeadOption(mins) {
    var sel = $("fieldLead");
    var found = false;
    for (var i = 0; i < sel.options.length; i++) {
      if (sel.options[i].value === String(mins)) found = true;
    }
    if (!found && mins) {
      var opt = document.createElement("option");
      opt.value = String(mins);
      opt.textContent = mins + " minutes before";
      sel.appendChild(opt);
    }
  }

  function formatWhen(item) {
    var ms = ics.zonedTimeToUtc(item.date, item.time);
    return new Intl.DateTimeFormat("en-US", {
      timeZone: parser.TZ,
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit"
    }).format(new Date(ms));
  }

  function leadLabel(mins) {
    if (!mins) return "At the time";
    if (mins === 60) return "1 hour before";
    if (mins === 120) return "2 hours before";
    if (mins === 1440) return "1 day before";
    if (mins % 60 === 0) return (mins / 60) + " hours before";
    return mins + " minutes before";
  }

  function groupOf(item, nowParts) {
    if (item.done) return "done";
    var bits = item.date.split("-").map(Number);
    var today = Date.UTC(nowParts.year, nowParts.month - 1, nowParts.day);
    var that = Date.UTC(bits[0], bits[1] - 1, bits[2]);
    var diff = Math.round((that - today) / 86400000);
    if (diff < 0) return "overdue";
    if (diff === 0) return "today";
    if (diff === 1) return "tomorrow";
    var daysLeftInWeek = 6 - nowParts.dow;
    if (diff <= daysLeftInWeek) return "week";
    return "later";
  }

  function sortItems(a, b) {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    if (a.time !== b.time) return a.time < b.time ? -1 : 1;
    return (a.title || "").localeCompare(b.title || "");
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function renderSchedule() {
    var root = $("schedule");
    var nowParts = parser.zonedParts(new Date(), parser.TZ);
    var groups = [
      { key: "overdue", title: "Overdue" },
      { key: "today", title: "Today" },
      { key: "tomorrow", title: "Tomorrow" },
      { key: "week", title: "This week" },
      { key: "later", title: "Later" },
      { key: "done", title: "Done" }
    ];
    var buckets = {};
    groups.forEach(function (g) { buckets[g.key] = []; });
    state.reminders.forEach(function (item) {
      var k = groupOf(item, nowParts);
      (buckets[k] || buckets.later).push(item);
    });
    groups.forEach(function (g) { buckets[g.key].sort(sortItems); });

    var html = "";
    var anyOpen = groups.slice(0, 5).some(function (g) { return buckets[g.key].length; });
    if (!anyOpen && !buckets.done.length) {
      root.innerHTML = '<div class="empty"><strong>No reminders yet.</strong><br>Try the example above, or just tap the mic.</div>';
      return;
    }
    if (!anyOpen) {
      html += '<div class="empty">Nothing coming up. Nice work.</div>';
    }
    groups.forEach(function (g) {
      var items = buckets[g.key];
      if (!items.length) return;
      html += '<div class="group"><h2>' + g.title + "</h2>";
      items.forEach(function (item) {
        var meta = [];
        if (item.recur) meta.push(parser.recurLabel(item.recur));
        meta.push(leadLabel(item.leadMinutes || 0));
        var cls = "card";
        if (g.key === "overdue") cls += " overdue";
        if (g.key === "done") cls += " done-card";
        html +=
          '<article class="' + cls + '" data-id="' + escapeHtml(item.id) + '">' +
          '<p class="card-title">' + escapeHtml(item.title) + "</p>" +
          '<p class="card-when">' + escapeHtml(formatWhen(item)) + "</p>" +
          '<p class="card-meta">' + escapeHtml(meta.join(" · ")) + "</p>" +
          '<div class="card-actions">' +
          (item.done ? "" : '<button type="button" class="text-btn js-done">Done</button>') +
          '<button type="button" class="text-btn js-edit">Edit</button>' +
          '<button type="button" class="text-btn js-delete">Delete</button>' +
          "</div>" +
          '<button type="button" class="ghost-btn cal-btn js-ics">Add to calendar</button>' +
          "</article>";
      });
      html += "</div>";
    });
    root.innerHTML = html;
  }

  function persist() {
    store.save(state);
    renderSchedule();
    armTimers();
  }

  function resetConfirmFields() {
    var form = $("confirmForm");
    if (form && form.reset) form.reset();
    $("fieldTitle").value = "";
    // Blank first so iOS Safari doesn’t keep showing the previous date/time.
    $("fieldDate").value = "";
    $("fieldTime").value = "";
    $("fieldLead").value = "0";
    $("fieldRecur").value = "none";
  }

  function resetDraftState() {
    editingId = null;
    lastFinal = "";
    lastInterim = "";
    wantListening = false;
    finalizedThisTurn = true;
    restartCount = 0;
    clearSpeechTimers();
    try { if (recognition) recognition.stop(); } catch (e) {}
    if (typeof setListeningUI === "function") setListeningUI(false);
    if (typeof exitKeyboardMicMode === "function") exitKeyboardMicMode();
    $("typeInput").value = "";
    var box = $("transcript");
    box.textContent = "";
    hide(box);
    setStatus("");
    resetConfirmFields();
  }

  function openConfirm(draft, id) {
    resetConfirmFields();
    editingId = id || null;
    $("confirmHeading").textContent = id ? "Edit reminder" : "Check this reminder";
    $("fieldTitle").value = draft.title || "";
    $("fieldDate").value = "";
    $("fieldTime").value = "";
    $("fieldDate").value = draft.date || "";
    $("fieldTime").value = draft.time || "";
    ensureLeadOption(draft.leadMinutes || 0);
    $("fieldLead").value = String(draft.leadMinutes || 0);
    $("fieldRecur").value = recurToValue(draft.recur);
    show($("confirmOverlay"));
    setTimeout(function () { $("fieldTitle").focus(); }, 50);
  }

  function closeConfirm() {
    hide($("confirmOverlay"));
    resetDraftState();
  }

  function saveFromForm(e) {
    if (e) e.preventDefault();
    var title = $("fieldTitle").value.trim();
    var date = $("fieldDate").value;
    var time = $("fieldTime").value;
    if (!title || !date || !time) return;
    // time input may be HH:MM:SS
    if (time.length > 5) time = time.slice(0, 5);
    var item = {
      id: editingId || store.uid(),
      title: title,
      date: date,
      time: time,
      leadMinutes: parseInt($("fieldLead").value, 10) || 0,
      recur: valueToRecur($("fieldRecur").value, date),
      done: false,
      createdAt: new Date().toISOString()
    };
    if (editingId) {
      var idx = state.reminders.findIndex(function (r) { return r.id === editingId; });
      if (idx >= 0) {
        item.createdAt = state.reminders[idx].createdAt || item.createdAt;
        item.done = false;
        state.reminders[idx] = item;
      } else {
        state.reminders.push(item);
      }
      toast("Reminder updated");
    } else {
      state.reminders.push(item);
      toast("Reminder saved");
    }
    persist();
    closeConfirm();
    $("typeInput").value = "";
    hide($("transcript"));
    setStatus("");
  }

  function findItem(id) {
    return state.reminders.find(function (r) { return r.id === id; });
  }

  function markDone(id) {
    var item = findItem(id);
    if (!item) return;
    if (item.recur) {
      var next = parser.nextOccurrence(item.date, item.time, item.recur);
      if (next) {
        item.date = next.date;
        item.time = next.time;
        item.done = false;
        persist();
        toast("Next up: " + formatWhen(item));
        return;
      }
    }
    item.done = true;
    persist();
    toast("Marked done");
  }

  function removeItem(id) {
    state.reminders = state.reminders.filter(function (r) { return r.id !== id; });
    persist();
    toast("Reminder deleted");
  }

  function openAsk(title, message, confirmLabel, action) {
    $("askHeading").textContent = title;
    $("askMessage").textContent = message;
    $("askConfirm").textContent = confirmLabel || "OK";
    $("askConfirm").className = confirmLabel === "Delete" ? "danger-btn" : "primary-btn";
    askAction = action;
    show($("askOverlay"));
  }

  function closeAsk() {
    hide($("askOverlay"));
    askAction = null;
  }

  function downloadIcsFor(item) {
    var safe = (item.title || "reminder").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "reminder";
    ics.download(safe + ".ics", ics.calendar([item]));
  }

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
    if (text) maybeOpenFromText(text, true);
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
    maybeOpenFromText(text, true);
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

  function maybeOpenFromText(text, fromVoice) {
    var parsed = parser.parseReminder(text, new Date(), parser.TZ);
    if (!parsed.ok) {
      setStatus(parsed.error || "I couldn’t read a day or time in that.");
      return false;
    }
    setStatus("");
    if (fromVoice) exitKeyboardMicMode();
    openConfirm(parsed, null);
    return true;
  }

  /* ---------- notifications ---------- */
  function notifyKey(item) {
    return item.id + ":" + item.date + ":" + item.time + ":" + (item.leadMinutes || 0);
  }

  function fireAt(item) {
    return ics.zonedTimeToUtc(item.date, item.time) - (item.leadMinutes || 0) * 60000;
  }

  function showReminderNotification(item) {
    var key = notifyKey(item);
    if (fired[key]) return;
    fired[key] = true;
    var body = formatWhen(item);
    if (item.leadMinutes) body += " · starts in " + leadLabel(item.leadMinutes).replace(" before", "");
    var opts = { body: body, icon: "icon-192.png", badge: "icon-192.png", tag: key, data: { id: item.id } };
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    if (navigator.serviceWorker) {
      navigator.serviceWorker.ready.then(function (reg) {
        if (reg.showNotification) return reg.showNotification(item.title, opts);
        new Notification(item.title, opts);
      }).catch(function () {
        try { new Notification(item.title, opts); } catch (e) {}
      });
    } else {
      try { new Notification(item.title, opts); } catch (e) {}
    }
  }

  function armTimers() {
    timers.forEach(function (t) { clearTimeout(t); });
    timers = [];
    var now = Date.now();
    state.reminders.forEach(function (item) {
      if (item.done) return;
      var delay = fireAt(item) - now;
      if (delay <= 0 || delay > 8 * 60 * 60 * 1000) return;
      timers.push(setTimeout(function () { showReminderNotification(item); }, delay));
    });
  }

  function catchDue() {
    var now = Date.now();
    state.reminders.forEach(function (item) {
      if (item.done) return;
      var at = fireAt(item);
      if (at <= now && now - at < 60000) showReminderNotification(item);
    });
  }

  function updateNotifyButton() {
    var btn = $("notifyBtn");
    if (!("Notification" in window)) {
      btn.textContent = "Notifications not supported here";
      btn.disabled = true;
      return;
    }
    if (Notification.permission === "granted") {
      btn.textContent = "Notifications are on";
      btn.disabled = true;
    } else if (Notification.permission === "denied") {
      btn.textContent = "Notifications are blocked in the browser";
      btn.disabled = true;
    } else {
      btn.textContent = "Enable notifications";
      btn.disabled = false;
    }
  }

  function requestNotifications() {
    if (!("Notification" in window)) return;
    Notification.requestPermission().then(function () {
      updateNotifyButton();
      if (Notification.permission === "granted") {
        toast("Notifications are on while the app is open");
        armTimers();
      }
    });
  }

  /* ---------- backup ---------- */
  function downloadText(filename, text, type) {
    var blob = new Blob([text], { type: type || "text/plain" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function exportJson() {
    downloadText("remind-me-backup.json", JSON.stringify(state, null, 2), "application/json");
    toast("Backup downloaded");
  }

  function exportAllIcs() {
    var open = state.reminders.filter(function (r) { return !r.done; });
    if (!open.length) { toast("No upcoming reminders to export"); return; }
    ics.download("remind-me.ics", ics.calendar(open));
    toast("Calendar file downloaded");
  }

  function importJsonFile(file) {
    var reader = new FileReader();
    reader.onload = function () {
      var payload;
      try { payload = JSON.parse(reader.result); }
      catch (e) { toast("That file isn’t valid JSON."); return; }
      var result = store.validateImport(payload);
      if (!result.ok) { toast(result.error); return; }
      openAsk(
        "Replace reminders?",
        "This will replace all reminders currently in the app with the " + result.data.reminders.length + " item(s) in this file.",
        "Replace",
        function () {
          state = result.data;
          persist();
          toast("Backup imported");
        }
      );
    };
    reader.readAsText(file);
  }

  /* ---------- events ---------- */
  function onScheduleClick(e) {
    var btn = e.target.closest("button");
    if (!btn) return;
    var card = btn.closest("[data-id]");
    if (!card) return;
    var item = findItem(card.getAttribute("data-id"));
    if (!item) return;
    if (btn.classList.contains("js-done")) markDone(item.id);
    else if (btn.classList.contains("js-edit")) openConfirm(item, item.id);
    else if (btn.classList.contains("js-delete")) {
      openAsk("Delete this reminder?", "“" + item.title + "” will be removed.", "Delete", function () {
        removeItem(item.id);
      });
    } else if (btn.classList.contains("js-ics")) downloadIcsFor(item);
  }

  function closeHelp() { hide($("helpOverlay")); }

  function onKey(e) {
    if (e.key !== "Escape") return;
    if (!$("confirmOverlay").classList.contains("hidden")) closeConfirm();
    else if (!$("helpOverlay").classList.contains("hidden")) closeHelp();
    else if (!$("askOverlay").classList.contains("hidden")) closeAsk();
  }

  function init() {
    fillRecurSelect();
    renderSchedule();
    setupSpeech();
    updateNotifyButton();
    armTimers();
    catchDue();
    setInterval(function () { catchDue(); armTimers(); }, 30000);

    $("typeForm").addEventListener("submit", function (e) {
      e.preventDefault();
      var text = $("typeInput").value.trim();
      if (!text) {
        setStatus("Type a reminder, or tap the mic.");
        return;
      }
      maybeOpenFromText(text, false);
    });
    $("confirmForm").addEventListener("submit", saveFromForm);
    $("cancelBtn").addEventListener("click", closeConfirm);
    $("confirmOverlay").addEventListener("click", function (e) {
      if (e.target === $("confirmOverlay")) closeConfirm();
    });
    $("helpBtn").addEventListener("click", function () { show($("helpOverlay")); });
    $("helpClose").addEventListener("click", closeHelp);
    $("helpCloseX").addEventListener("click", closeHelp);
    $("helpOverlay").addEventListener("click", function (e) {
      if (e.target === $("helpOverlay")) closeHelp();
    });
    $("askCancel").addEventListener("click", closeAsk);
    $("askConfirm").addEventListener("click", function () {
      var fn = askAction;
      closeAsk();
      if (fn) fn();
    });
    $("askOverlay").addEventListener("click", function (e) {
      if (e.target === $("askOverlay")) closeAsk();
    });
    $("schedule").addEventListener("click", onScheduleClick);
    $("notifyBtn").addEventListener("click", requestNotifications);
    $("exportIcsBtn").addEventListener("click", exportAllIcs);
    $("exportJsonBtn").addEventListener("click", exportJson);
    $("importJsonBtn").addEventListener("click", function () { $("importFile").click(); });
    $("importFile").addEventListener("change", function () {
      var file = $("importFile").files && $("importFile").files[0];
      $("importFile").value = "";
      if (file) importJsonFile(file);
    });
    document.addEventListener("keydown", onKey);

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("./sw.js").catch(function () {});
    }

    window.RemindMeTest = {
      getDraft: function () {
        return {
          typeInput: $("typeInput").value,
          transcript: $("transcript").textContent,
          transcriptHidden: $("transcript").classList.contains("hidden"),
          title: $("fieldTitle").value,
          date: $("fieldDate").value,
          time: $("fieldTime").value,
          lead: $("fieldLead").value,
          recur: $("fieldRecur").value,
          editingId: editingId,
          lastFinal: lastFinal,
          lastInterim: lastInterim,
          keyboardMicMode: keyboardMicMode,
          confirmOpen: !$("confirmOverlay").classList.contains("hidden")
        };
      }
    };
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
