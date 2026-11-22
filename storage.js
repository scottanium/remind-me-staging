/* localStorage reminders, versioned. Works in the browser. */
(function (root) {
  var KEY_PREFIX = (typeof RemindMeConfig !== "undefined" && RemindMeConfig.STAGING) ? "rm-staging:" : "";
  function storageKey(name) { return KEY_PREFIX + name; }
  var KEY = storageKey("voice-reminders");
  var VERSION = 1;

  function uid() {
    return "r_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
  }

  function empty() {
    return { version: VERSION, reminders: [] };
  }

  function migrate(data) {
    if (!data || typeof data !== "object") return empty();
    if (!Array.isArray(data.reminders)) data.reminders = [];
    data.version = VERSION;
    return data;
  }

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return empty();
      return migrate(JSON.parse(raw));
    } catch (e) {
      return empty();
    }
  }

  function save(data) {
    data.version = VERSION;
    localStorage.setItem(KEY, JSON.stringify(data));
    return data;
  }

  function isValidReminder(item) {
    if (!item || typeof item !== "object") return false;
    if (typeof item.title !== "string" || !item.title.trim()) return false;
    if (typeof item.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(item.date)) return false;
    if (typeof item.time !== "string" || !/^\d{2}:\d{2}$/.test(item.time)) return false;
    var bits = item.date.split("-").map(Number);
    var d = new Date(Date.UTC(bits[0], bits[1] - 1, bits[2]));
    if (d.getUTCFullYear() !== bits[0] || d.getUTCMonth() + 1 !== bits[1] || d.getUTCDate() !== bits[2]) return false;
    var hm = item.time.split(":").map(Number);
    if (hm[0] > 23 || hm[1] > 59) return false;
    if (item.leadMinutes != null && (typeof item.leadMinutes !== "number" || item.leadMinutes < 0 || !isFinite(item.leadMinutes))) return false;
    if (item.recur != null) {
      if (typeof item.recur !== "object") return false;
      var t = item.recur.type;
      if (["daily", "weekly", "weekdays", "monthly"].indexOf(t) === -1) return false;
    }
    return true;
  }

  function validateImport(payload) {
    if (!payload || typeof payload !== "object") return { ok: false, error: "That file isn't a reminders backup." };
    if (!Array.isArray(payload.reminders)) return { ok: false, error: "That file has no reminders list." };
    var cleaned = [];
    for (var i = 0; i < payload.reminders.length; i++) {
      var item = payload.reminders[i];
      if (!isValidReminder(item)) {
        return { ok: false, error: "Reminder #" + (i + 1) + " in that file looks invalid, so I didn't import anything." };
      }
      cleaned.push({
        id: typeof item.id === "string" && item.id ? item.id : uid(),
        title: item.title.trim(),
        date: item.date,
        time: item.time,
        leadMinutes: item.leadMinutes || 0,
        recur: item.recur || null,
        done: !!item.done,
        createdAt: item.createdAt || new Date().toISOString()
      });
    }
    return { ok: true, data: { version: VERSION, reminders: cleaned } };
  }

  var api = {
    KEY: KEY,
    KEY_PREFIX: KEY_PREFIX,
    storageKey: storageKey,
    VERSION: VERSION,
    uid: uid,
    empty: empty,
    load: load,
    save: save,
    isValidReminder: isValidReminder,
    validateImport: validateImport
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    root.ReminderStorage = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
