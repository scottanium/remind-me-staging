(function () {
  "use strict";

  var parser = window.ReminderParser;
  var store = window.ReminderStorage;
  var ics = window.ReminderICS;

  var state = store.load();
  var editingId = null;
  var timers = [];
  var fired = {};
  var toastTimer = null;
  var askAction = null;
  var speech = null;
  var notes = null;

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
    if (notes) notes.armTimers();
  }

  var DRAFT_STORAGE_KEYS = ["draft", "confirm-draft", "last-used", "lastUsed", "lastTime", "lastDate"];

  function clearDraftStorage() {
    var prefix = (store && store.KEY_PREFIX) || "";
    var extras = [prefix, "", "rm-staging:"];
    try {
      DRAFT_STORAGE_KEYS.forEach(function (k) {
        extras.forEach(function (pre) {
          localStorage.removeItem(pre + k);
        });
      });
    } catch (e) {}
  }

  function replaceDateTimeInput(id) {
    var el = $(id);
    if (!el || !el.parentNode) return el;
    var fresh = el.cloneNode(true);
    fresh.setAttribute("autocomplete", "off");
    fresh.setAttribute("autocorrect", "off");
    fresh.value = "";
    fresh.defaultValue = "";
    fresh.removeAttribute("value");
    el.parentNode.replaceChild(fresh, el);
    return fresh;
  }

  function setFieldValue(id, value) {
    var el = $(id);
    if (!el) return null;
    var v = value == null ? "" : String(value);
    if (el.type === "time" && v.length > 5) v = v.slice(0, 5);
    if (el.type === "date" || el.type === "time") {
      el = replaceDateTimeInput(id);
    }
    el.defaultValue = v;
    el.value = "";
    if (v) {
      el.value = v;
      try { el.setAttribute("value", v); } catch (e) {}
    } else {
      try { el.removeAttribute("value"); } catch (e) {}
    }
    return el;
  }

  function applyDateTimeValues(date, time) {
    if (time && time.length > 5) time = time.slice(0, 5);
    setFieldValue("fieldDate", date || "");
    setFieldValue("fieldTime", time || "");
    function verify() {
      var d = $("fieldDate");
      var t = $("fieldTime");
      if (d && date && d.value !== date) {
        d.value = date;
        d.defaultValue = date;
      }
      if (t && time) {
        var cur = (t.value || "").slice(0, 5);
        if (cur !== time) {
          t.value = time;
          t.defaultValue = time;
        }
      }
    }
    verify();
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(verify);
    setTimeout(verify, 0);
    setTimeout(verify, 50);
  }

  function resetConfirmFields() {
    var form = $("confirmForm");
    if (form) {
      form.setAttribute("autocomplete", "off");
      try { if (form.reset) form.reset(); } catch (e) {}
    }
    // Replace native date/time inputs so iOS Safari cannot keep the previous widget value.
    replaceDateTimeInput("fieldDate");
    replaceDateTimeInput("fieldTime");
    setFieldValue("fieldTitle", "");
    setFieldValue("fieldDate", "");
    setFieldValue("fieldTime", "");
    if ($("fieldLead")) $("fieldLead").value = "0";
    if ($("fieldRecur")) $("fieldRecur").value = "none";
    clearDraftStorage();
  }

  function resetDraftState() {
    editingId = null;
    if (speech && speech.resetListenState) speech.resetListenState();
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
    setFieldValue("fieldTitle", draft.title || "");
    applyDateTimeValues(draft.date || "", draft.time || "");
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

  function maybeOpenFromText(text, fromVoice) {
    var parsed = parser.parseReminder(text, new Date(), parser.TZ);
    if (!parsed.ok) {
      setStatus(parsed.error || "I couldn’t read a day or time in that.");
      return false;
    }
    setStatus("");
    if (fromVoice && speech) speech.exitKeyboardMicMode();
    openConfirm(parsed, null);
    return true;
  }

  /* ---------- notifications ---------- */

  function attachModules() {
    speech = window.RemindMeSpeech.attach({
      $: $,
      show: show,
      hide: hide,
      toast: toast,
      setStatus: setStatus,
      maybeOpenFromText: maybeOpenFromText
    });
    notes = window.RemindMeNotifications.attach({
      $: $,
      toast: toast,
      ics: ics,
      formatWhen: formatWhen,
      leadLabel: leadLabel,
      getState: function () { return state; }
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
    resetConfirmFields();
    window.addEventListener("pageshow", function (e) {
      var overlay = $("confirmOverlay");
      var hidden = !overlay || overlay.classList.contains("hidden");
      if (e.persisted || hidden) {
        if (hidden) resetConfirmFields();
        else {
          // Reopening the app mid-sheet: close and clear so stale native values cannot linger.
          closeConfirm();
        }
      }
    });
    attachModules();
    renderSchedule();
    speech.setupSpeech();
    notes.updateNotifyButton();
    notes.armTimers();
    notes.catchDue();
    setInterval(function () { notes.catchDue(); notes.armTimers(); }, 30000);

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
    $("notifyBtn").addEventListener("click", function () { notes.requestNotifications(); });
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
          lastFinal: (speech && speech.getTestState().lastFinal) || "",
          lastInterim: (speech && speech.getTestState().lastInterim) || "",
          keyboardMicMode: !!(speech && speech.getTestState().keyboardMicMode),
          confirmOpen: !$("confirmOverlay").classList.contains("hidden")
        };
      }
    };
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
