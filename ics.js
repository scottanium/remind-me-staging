/* .ics calendar export for reminders. America/Indianapolis or UTC. */
(function (root) {
  var TZ = "America/Indianapolis";

  function pad(n) {
    return String(n).padStart(2, "0");
  }

  function zonedTimeToUtc(dateStr, timeStr, tz) {
    tz = tz || TZ;
    var ds = dateStr.split("-").map(Number);
    var ts = timeStr.split(":").map(Number);
    var utcGuess = Date.UTC(ds[0], ds[1] - 1, ds[2], ts[0], ts[1], 0);
    function offset(ms) {
      var parts = new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23"
      }).formatToParts(new Date(ms));
      var v = function (t) {
        return +parts.find(function (p) { return p.type === t; }).value;
      };
      var asIfUTC = Date.UTC(v("year"), v("month") - 1, v("day"), v("hour"), v("minute"), v("second"));
      return asIfUTC - ms;
    }
    return utcGuess - offset(utcGuess);
  }

  function utcStamp(ms) {
    var d = new Date(ms);
    return (
      d.getUTCFullYear() +
      pad(d.getUTCMonth() + 1) +
      pad(d.getUTCDate()) +
      "T" +
      pad(d.getUTCHours()) +
      pad(d.getUTCMinutes()) +
      pad(d.getUTCSeconds()) +
      "Z"
    );
  }

  function fold(line) {
    var out = "";
    while (line.length > 73) {
      out += line.slice(0, 73) + "\r\n ";
      line = line.slice(73);
    }
    return out + line;
  }

  function escapeText(s) {
    return String(s).replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
  }

  function rrule(recur) {
    if (!recur) return null;
    if (recur.type === "daily") return "FREQ=DAILY";
    if (recur.type === "weekdays") return "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR";
    if (recur.type === "weekly") {
      var map = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
      if (recur.weekday != null) return "FREQ=WEEKLY;BYDAY=" + map[recur.weekday];
      return "FREQ=WEEKLY";
    }
    if (recur.type === "monthly") {
      if (recur.day) return "FREQ=MONTHLY;BYMONTHDAY=" + recur.day;
      return "FREQ=MONTHLY";
    }
    return null;
  }

  function valarm(leadMinutes, title) {
    if (!leadMinutes) leadMinutes = 0;
    var trigger = leadMinutes ? "-PT" + leadMinutes + "M" : "-PT0M";
    return [
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      "DESCRIPTION:" + escapeText(title || "Reminder"),
      "TRIGGER:" + trigger,
      "END:VALARM"
    ];
  }

  function eventLines(item) {
    var start = zonedTimeToUtc(item.date, item.time, TZ);
    var end = start + 30 * 60 * 1000;
    var uid = (item.id || "r") + "@remind-me";
    var lines = [
      "BEGIN:VEVENT",
      "UID:" + uid,
      "DTSTAMP:" + utcStamp(Date.now()),
      "DTSTART:" + utcStamp(start),
      "DTEND:" + utcStamp(end),
      "SUMMARY:" + escapeText(item.title || "Reminder")
    ];
    var rule = rrule(item.recur);
    if (rule) lines.push("RRULE:" + rule);
    lines = lines.concat(valarm(item.leadMinutes || 0, item.title));
    lines.push("END:VEVENT");
    return lines;
  }

  function calendar(items) {
    var lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Remind Me//Voice Reminders//EN",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH"
    ];
    (items || []).forEach(function (item) {
      if (item.done) return;
      lines = lines.concat(eventLines(item));
    });
    lines.push("END:VCALENDAR");
    return lines.map(fold).join("\r\n") + "\r\n";
  }

  function download(filename, icsText) {
    var blob = new Blob([icsText], { type: "text/calendar;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  var api = {
    TZ: TZ,
    zonedTimeToUtc: zonedTimeToUtc,
    calendar: calendar,
    download: download,
    rrule: rrule
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    root.ReminderICS = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
