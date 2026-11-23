/* Remind Me notifications and timers. Loaded after ics.js and before app.js.
 * Receives shared page helpers through RemindMeNotifications.attach(api).
 */
window.RemindMeNotifications = {
  attach: function (api) {
    "use strict";
    var $ = api.$;
    var toast = api.toast;
    var ics = api.ics;
    var timers = [];
    var fired = {};

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
  var body = api.formatWhen(item);
  if (item.leadMinutes) body += " · starts in " + api.leadLabel(item.leadMinutes).replace(" before", "");
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
  api.getState().reminders.forEach(function (item) {
    if (item.done) return;
    var delay = fireAt(item) - now;
    if (delay <= 0 || delay > 8 * 60 * 60 * 1000) return;
    timers.push(setTimeout(function () { showReminderNotification(item); }, delay));
  });
}

function catchDue() {
  var now = Date.now();
  api.getState().reminders.forEach(function (item) {
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

    return {
      armTimers: armTimers,
      catchDue: catchDue,
      updateNotifyButton: updateNotifyButton,
      requestNotifications: requestNotifications
    };
  }
};
