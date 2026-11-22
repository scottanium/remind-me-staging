/* Reminder natural-language parser. Works in the browser and in Node. */
(function (root) {
  var TZ = "America/Indianapolis";
  var WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  var WEEKDAY_RE = "sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat";
  var MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
  var MONTH_RE = "january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec";

  function pad(n) {
    return String(n).padStart(2, "0");
  }

  function weekdayIndex(name) {
    var s = name.toLowerCase();
    var aliases = { sun: 0, mon: 1, tue: 2, tues: 2, wed: 3, thu: 4, thur: 4, thurs: 4, fri: 5, sat: 6 };
    if (aliases[s] !== undefined) return aliases[s];
    return WEEKDAYS.indexOf(s);
  }

  function monthIndex(name) {
    var s = name.toLowerCase();
    var aliases = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };
    if (aliases[s] !== undefined) return aliases[s];
    return MONTHS.indexOf(s);
  }

  function zonedParts(date, tz) {
    tz = tz || TZ;
    var parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "short",
      hourCycle: "h23"
    }).formatToParts(date);
    var v = function (t) {
      return parts.find(function (p) { return p.type === t; }).value;
    };
    var wdMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    return {
      year: +v("year"),
      month: +v("month"),
      day: +v("day"),
      hour: +v("hour"),
      minute: +v("minute"),
      second: +v("second"),
      dow: wdMap[v("weekday")]
    };
  }

  function fmtDate(p) {
    return p.year + "-" + pad(p.month) + "-" + pad(p.day);
  }

  function fmtTime(h, m) {
    return pad(h) + ":" + pad(m);
  }

  function addDaysParts(p, days) {
    // Use noon UTC on a date near the local date, then shift — safer: construct UTC date from parts + days
    var utc = Date.UTC(p.year, p.month - 1, p.day + days, 12, 0, 0);
    var d = new Date(utc);
    return {
      year: d.getUTCFullYear(),
      month: d.getUTCMonth() + 1,
      day: d.getUTCDate()
    };
  }

  function daysInMonth(year, month) {
    return new Date(Date.UTC(year, month, 0)).getUTCDate();
  }

  function timePassed(parts, h, m) {
    if (h == null) return false;
    var a = parts.hour * 60 + parts.minute;
    var b = h * 60 + (m || 0);
    return a >= b;
  }

  function resolveHourMinute(hour, minute, mer) {
    minute = minute == null ? 0 : minute;
    hour = +hour;
    minute = +minute;
    if (mer) {
      mer = mer.replace(/\./g, "").toLowerCase();
      if (mer === "am") {
        if (hour === 12) hour = 0;
      } else if (mer === "pm") {
        if (hour !== 12) hour += 12;
      }
    } else {
      if (hour === 12) {
        // bare 12 = noon
        hour = 12;
      } else if (hour >= 1 && hour <= 7) {
        hour += 12; // 1-7 with no am/pm means pm
      }
      // 8-11 stay AM; 0 stays midnight; 13-23 already 24h
    }
    if (hour === 24) hour = 0;
    return { hour: hour, minute: minute };
  }

  function nextWeekdayDate(parts, targetDow, h, m, skipToday) {
    var ahead = (targetDow - parts.dow + 7) % 7;
    if (ahead === 0) {
      if (skipToday || timePassed(parts, h, m)) ahead = 7;
    }
    return addDaysParts(parts, ahead);
  }

  function nextMonthOnDay(parts, day, h, m) {
    var y = parts.year;
    var mo = parts.month;
    var dim = daysInMonth(y, mo);
    var useDay = Math.min(day, dim);
    var todayNum = parts.day;
    var passed = todayNum > useDay || (todayNum === useDay && timePassed(parts, h, m));
    if (passed) {
      mo += 1;
      if (mo > 12) {
        mo = 1;
        y += 1;
      }
      useDay = Math.min(day, daysInMonth(y, mo));
    }
    return { year: y, month: mo, day: useDay };
  }

  function yearMonthDay(parts, monthIndexZero, day, year) {
    var y, mo, d;
    mo = monthIndexZero + 1;
    d = day;
    if (year) {
      y = year < 100 ? 2000 + year : year;
    } else {
      y = parts.year;
      var passed =
        mo < parts.month ||
        (mo === parts.month && d < parts.day) ||
        (mo === parts.month && d === parts.day && false);
      if (passed) y += 1;
    }
    return { year: y, month: mo, day: d };
  }

  function normalize(text) {
    return String(text)
      .toLowerCase()
      .replace(/[’']/g, "'")
      .replace(/[,!?]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function cut(s, start, end) {
    return (s.slice(0, start) + " " + s.slice(end)).replace(/\s+/g, " ").trim();
  }

  function parseLead(s) {
    var lead = 0;
    var m;
    var patterns = [
      { re: /(?:remind\s+me\s+)?(?:a\s+)?half\s+(?:an\s+)?hour\s+before/g, mins: 30 },
      { re: /(?:remind\s+me\s+)?(?:an|a|one)\s+hour\s+before/g, mins: 60 },
      { re: /(?:remind\s+me\s+)?(?:an|a|one)\s+minute\s+before/g, mins: 1 },
      { re: /(?:remind\s+me\s+)?(?:an|a|one)\s+day\s+before/g, mins: 1440 },
      { re: /(?:remind\s+me\s+)?(\d+)\s*(?:hours?|hrs?)\s+before/g, unit: 60 },
      { re: /(?:remind\s+me\s+)?(\d+)\s*(?:minutes?|mins?)\s+before/g, unit: 1 },
      { re: /(?:remind\s+me\s+)?(\d+)\s*days?\s+before/g, unit: 1440 }
    ];
    for (var i = 0; i < patterns.length; i++) {
      patterns[i].re.lastIndex = 0;
      m = patterns[i].re.exec(s);
      if (m) {
        lead = patterns[i].mins != null ? patterns[i].mins : parseInt(m[1], 10) * patterns[i].unit;
        s = cut(s, m.index, m.index + m[0].length);
        break;
      }
    }
    return { s: s, lead: lead };
  }

  function parseRecur(s) {
    var recur = null;
    var m;

    m = s.match(/\bevery\s+month\s+on\s+the\s+(\d{1,2})(?:st|nd|rd|th)?\b/) ||
        s.match(/\bmonthly\s+on\s+the\s+(\d{1,2})(?:st|nd|rd|th)?\b/);
    if (m) {
      recur = { type: "monthly", day: parseInt(m[1], 10) };
      s = s.replace(m[0], " ").replace(/\s+/g, " ").trim();
      return { s: s, recur: recur };
    }

    m = s.match(/\bevery\s+month\b|\bmonthly\b/);
    if (m) {
      recur = { type: "monthly" }; // day filled later from date
      s = s.replace(m[0], " ").replace(/\s+/g, " ").trim();
      return { s: s, recur: recur };
    }

    m = s.match(/\bevery\s+weekday|\bweekdays\b|\bevery\s+weekday\b/);
    if (m) {
      recur = { type: "weekdays" };
      s = s.replace(m[0], " ").replace(/\s+/g, " ").trim();
      return { s: s, recur: recur };
    }

    var everyWd = new RegExp("\\bevery\\s+(" + WEEKDAY_RE + ")s?\\b");
    m = s.match(everyWd);
    if (m) {
      recur = { type: "weekly", weekday: weekdayIndex(m[1]) };
      s = s.replace(m[0], " ").replace(/\s+/g, " ").trim();
      return { s: s, recur: recur };
    }

    m = s.match(/\bevery\s+day\b|\beveryday\b|\bdaily\b/);
    if (m) {
      recur = { type: "daily" };
      s = s.replace(m[0], " ").replace(/\s+/g, " ").trim();
      return { s: s, recur: recur };
    }

    m = s.match(/\bevery\s+week\b|\bweekly\b/);
    if (m) {
      recur = { type: "weekly" }; // weekday filled later from date
      s = s.replace(m[0], " ").replace(/\s+/g, " ").trim();
      return { s: s, recur: recur };
    }

    return { s: s, recur: recur };
  }

  function parseRelative(s, now, tz) {
    var m;
    var minutes = null;
    m = s.match(/\bin\s+half\s+(?:an\s+)?hour\b/);
    if (m) minutes = 30;
    if (minutes == null) {
      m = s.match(/\bin\s+(?:an|a|one)\s+hour\b/);
      if (m) minutes = 60;
    }
    if (minutes == null) {
      m = s.match(/\bin\s+(\d+)\s*(?:minutes?|mins?)\b/);
      if (m) minutes = parseInt(m[1], 10);
    }
    if (minutes == null) {
      m = s.match(/\bin\s+(\d+)\s*(?:hours?|hrs?)\b/);
      if (m) minutes = parseInt(m[1], 10) * 60;
    }
    if (minutes == null) return { s: s };
    s = s.replace(m[0], " ").replace(/\s+/g, " ").trim();
    var then = new Date(now.getTime() + minutes * 60000);
    var p = zonedParts(then, tz);
    return { s: s, date: fmtDate(p), time: fmtTime(p.hour, p.minute), relative: true };
  }

  function parseTime(s) {
    var time = null;
    var tonight = false;
    var m;

    if (/\b(?:at\s+)?midnight\b/.test(s)) {
      time = { hour: 0, minute: 0 };
      s = s.replace(/\b(?:at\s+)?midnight\b/, " ").replace(/\s+/g, " ").trim();
      return { s: s, time: time };
    }
    if (/\b(?:at\s+)?noon\b/.test(s)) {
      time = { hour: 12, minute: 0 };
      s = s.replace(/\b(?:at\s+)?noon\b/, " ").replace(/\s+/g, " ").trim();
      return { s: s, time: time };
    }
    if (/\btonight\b/.test(s)) {
      tonight = true;
      s = s.replace(/\btonight\b/, " ").replace(/\s+/g, " ").trim();
    }

    // Prefer "at 2", then "2:30", then "2pm" so we never grab a stray number.
    var timePatterns = [
      /\bat\s+(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?\b/,
      /\b(\d{1,2}):(\d{2})\s*(a\.?m\.?|p\.?m\.?)?\b/,
      /\b(\d{1,2})\s*(a\.?m\.?|p\.?m\.?)\b/
    ];
    for (var ti = 0; ti < timePatterns.length; ti++) {
      m = s.match(timePatterns[ti]);
      if (!m) continue;
      var prevCh = s[m.index - 1];
      var nextCh = s[m.index + m[0].length];
      if (prevCh === "/" || nextCh === "/") continue;
      if (ti === 0) time = resolveHourMinute(m[1], m[2], m[3]);
      else if (ti === 1) time = resolveHourMinute(m[1], m[2], m[3]);
      else time = resolveHourMinute(m[1], 0, m[2]);
      s = cut(s, m.index, m.index + m[0].length);
      break;
    }

    return { s: s, time: time, tonight: tonight };
  }

  function parseDate(s, parts, timeHM, recur) {
    var date = null;
    var m;
    var h = timeHM ? timeHM.hour : null;
    var min = timeHM ? timeHM.minute : 0;

    if (/\btoday\b/.test(s)) {
      date = { year: parts.year, month: parts.month, day: parts.day };
      s = s.replace(/\btoday\b/, " ").replace(/\s+/g, " ").trim();
      return { s: s, date: date };
    }
    if (/\btomorrow\b/.test(s)) {
      date = addDaysParts(parts, 1);
      s = s.replace(/\btomorrow\b/, " ").replace(/\s+/g, " ").trim();
      return { s: s, date: date };
    }

    var monthRe = new RegExp("\\b(" + MONTH_RE + ")\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:\\s*,?\\s*(\\d{4}))?\\b");
    m = s.match(monthRe);
    if (m) {
      date = yearMonthDay(parts, monthIndex(m[1]), parseInt(m[2], 10), m[3] ? parseInt(m[3], 10) : null);
      s = s.replace(m[0], " ").replace(/\s+/g, " ").trim();
      return { s: s, date: date };
    }

    m = s.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
    if (m) {
      date = yearMonthDay(parts, parseInt(m[1], 10) - 1, parseInt(m[2], 10), m[3] ? parseInt(m[3], 10) : null);
      s = s.replace(m[0], " ").replace(/\s+/g, " ").trim();
      return { s: s, date: date };
    }

    var nextWd = new RegExp("\\bnext\\s+(" + WEEKDAY_RE + ")\\b");
    m = s.match(nextWd);
    if (m) {
      date = nextWeekdayDate(parts, weekdayIndex(m[1]), h, min, true);
      s = s.replace(m[0], " ").replace(/\s+/g, " ").trim();
      return { s: s, date: date };
    }

    var onWd = new RegExp("\\b(?:on\\s+)?(" + WEEKDAY_RE + ")\\b");
    m = s.match(onWd);
    if (m) {
      date = nextWeekdayDate(parts, weekdayIndex(m[1]), h, min, false);
      s = s.replace(m[0], " ").replace(/\s+/g, " ").trim();
      return { s: s, date: date };
    }

    // Recurrence can imply a date
    if (!date && recur) {
      if (recur.type === "weekly" && recur.weekday != null) {
        date = nextWeekdayDate(parts, recur.weekday, h, min, false);
      } else if (recur.type === "weekdays") {
        date = nextWeekdayDateFromSet(parts, [1, 2, 3, 4, 5], h, min);
      } else if (recur.type === "monthly" && recur.day != null) {
        date = nextMonthOnDay(parts, recur.day, h, min);
      }
    }

    return { s: s, date: date };
  }

  function nextWeekdayDateFromSet(parts, set, h, m) {
    for (var i = 0; i <= 7; i++) {
      var d = addDaysParts(parts, i);
      // compute dow of that date
      var utc = Date.UTC(d.year, d.month - 1, d.day, 12, 0, 0);
      var dow = new Date(utc).getUTCDay();
      if (set.indexOf(dow) === -1) continue;
      if (i === 0 && timePassed(parts, h, m)) continue;
      return d;
    }
    return addDaysParts(parts, 1);
  }

  function cleanTitle(s) {
    s = s.replace(/\s+/g, " ").trim();
    s = s.replace(/\bremind\s+me\s+to\b/g, " ");
    s = s.replace(/\bremind\s+me\b/g, " ");
    s = s.replace(/\bset\s+a\s+reminder\s+(?:for|to)?\b/g, " ");
    s = s.replace(/\ba\s+reminder\b/g, " ");
    s = s.replace(/\breminder\b/g, " ");
    s = s.replace(/\bplease\b/g, " ");
    s = s.replace(/\s+/g, " ").trim();
    var leading = /^(to|at|on|for|the|a|an)\s+/i;
    var trailing = /\s+(to|at|on|for|the|a|an)$/i;
    while (leading.test(s) || trailing.test(s)) {
      s = s.replace(leading, "").replace(trailing, "").trim();
    }
    s = s.replace(/^[\s\-–:]+|[\s\-–:]+$/g, "").trim();
    if (!s) return "Reminder";
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  function defaultTimeFor(tonight, recur) {
    if (tonight) return { hour: 19, minute: 0 };
    return { hour: 9, minute: 0 };
  }

  function parseReminder(text, now, tz) {
    tz = tz || TZ;
    now = now || new Date();
    var parts = zonedParts(now, tz);
    var original = String(text == null ? "" : text);
    var s = normalize(original);

    var leadRes = parseLead(s);
    s = leadRes.s;

    var recurRes = parseRecur(s);
    s = recurRes.s;
    var recur = recurRes.recur;

    var rel = parseRelative(s, now, tz);
    s = rel.s;

    var timeRes = { time: null, tonight: false };
    if (!rel.relative) {
      timeRes = parseTime(s);
      s = timeRes.s;
    }

    var timeHM = rel.relative
      ? { hour: +rel.time.slice(0, 2), minute: +rel.time.slice(3, 5) }
      : timeRes.time;

    var dateRes = { date: null };
    if (!rel.relative) {
      dateRes = parseDate(s, parts, timeHM, recur);
      s = dateRes.s;
    }

    if (rel.relative) {
      // already have date + time
    } else {
      if (!timeHM && timeRes.tonight) timeHM = defaultTimeFor(true);
      if (!dateRes.date) {
        if (recur && recur.type === "weekly" && recur.weekday != null) {
          dateRes.date = nextWeekdayDate(parts, recur.weekday, timeHM ? timeHM.hour : 9, timeHM ? timeHM.minute : 0, false);
        } else if (recur && recur.type === "weekdays") {
          dateRes.date = nextWeekdayDateFromSet(parts, [1, 2, 3, 4, 5], timeHM ? timeHM.hour : 9, timeHM ? timeHM.minute : 0);
        } else if (recur && recur.type === "monthly" && recur.day != null) {
          dateRes.date = nextMonthOnDay(parts, recur.day, timeHM ? timeHM.hour : 9, timeHM ? timeHM.minute : 0);
        } else if (timeRes.tonight) {
          dateRes.date = { year: parts.year, month: parts.month, day: parts.day };
        } else if (timeHM) {
          if (timePassed(parts, timeHM.hour, timeHM.minute)) {
            dateRes.date = addDaysParts(parts, 1);
          } else {
            dateRes.date = { year: parts.year, month: parts.month, day: parts.day };
          }
        } else if (recur && recur.type === "daily") {
          dateRes.date = { year: parts.year, month: parts.month, day: parts.day };
        } else if (recur && (recur.type === "weekly" || recur.type === "monthly")) {
          dateRes.date = { year: parts.year, month: parts.month, day: parts.day };
        }
      }
      if (!timeHM) timeHM = defaultTimeFor(!!timeRes.tonight);

      // If daily/weekdays and the chosen date is today but the time has passed, roll forward
      if (dateRes.date && timeHM && recur && (recur.type === "daily" || recur.type === "weekdays" || (recur.type === "weekly" && recur.weekday != null) || (recur.type === "monthly" && recur.day != null))) {
        var isToday =
          dateRes.date.year === parts.year &&
          dateRes.date.month === parts.month &&
          dateRes.date.day === parts.day;
        if (isToday && timePassed(parts, timeHM.hour, timeHM.minute)) {
          if (recur.type === "daily") dateRes.date = addDaysParts(parts, 1);
          else if (recur.type === "weekdays") dateRes.date = nextWeekdayDateFromSet(parts, [1, 2, 3, 4, 5], timeHM.hour, timeHM.minute);
          else if (recur.type === "weekly") dateRes.date = nextWeekdayDate(parts, recur.weekday, timeHM.hour, timeHM.minute, false);
          else if (recur.type === "monthly") dateRes.date = nextMonthOnDay(parts, recur.day, timeHM.hour, timeHM.minute);
        }
      }
    }

    // Fill monthly day / weekly weekday from the chosen date
    if (recur && recur.type === "monthly" && recur.day == null && dateRes.date) {
      recur.day = dateRes.date.day;
    }
    if (recur && recur.type === "weekly" && recur.weekday == null && dateRes.date) {
      var utc = Date.UTC(dateRes.date.year, dateRes.date.month - 1, dateRes.date.day, 12, 0, 0);
      recur.weekday = new Date(utc).getUTCDay();
    }

    var title = cleanTitle(rel.relative ? s : (dateRes.s != null ? dateRes.s : s));

    if (!dateRes.date && !rel.relative) {
      return {
        ok: false,
        error: "I couldn't find a day or time in that. Try something like “dentist Tuesday at 2”.",
        title: title,
        date: null,
        time: null,
        leadMinutes: leadRes.lead,
        recur: recur,
        raw: original
      };
    }

    var dateStr = rel.relative ? rel.date : fmtDate(dateRes.date);
    var timeStr = rel.relative ? rel.time : fmtTime(timeHM.hour, timeHM.minute);

    return {
      ok: true,
      title: title,
      date: dateStr,
      time: timeStr,
      leadMinutes: leadRes.lead,
      recur: recur,
      raw: original
    };
  }

  function nextOccurrence(dateStr, timeStr, recur) {
    if (!recur) return null;
    var bits = dateStr.split("-").map(Number);
    var p = { year: bits[0], month: bits[1], day: bits[2] };
    var hm = timeStr.split(":").map(Number);
    var next;
    if (recur.type === "daily") {
      next = addDaysParts(p, 1);
    } else if (recur.type === "weekdays") {
      // start from the day after the current occurrence
      var from = addDaysParts(p, 1);
      var utc0 = Date.UTC(from.year, from.month - 1, from.day, 12, 0, 0);
      var fakeParts = { year: from.year, month: from.month, day: from.day, dow: new Date(utc0).getUTCDay(), hour: 0, minute: 0 };
      next = nextWeekdayDateFromSet(fakeParts, [1, 2, 3, 4, 5], 0, 0);
    } else if (recur.type === "weekly") {
      next = addDaysParts(p, 7);
    } else if (recur.type === "monthly") {
      var day = recur.day || p.day;
      var y = p.year;
      var mo = p.month + 1;
      if (mo > 12) {
        mo = 1;
        y += 1;
      }
      next = { year: y, month: mo, day: Math.min(day, daysInMonth(y, mo)) };
    } else {
      return null;
    }
    return { date: fmtDate(next), time: timeStr };
  }

  function recurLabel(recur) {
    if (!recur) return "Does not repeat";
    if (recur.type === "daily") return "Every day";
    if (recur.type === "weekdays") return "Weekdays";
    if (recur.type === "weekly" && recur.weekday != null) {
      var name = WEEKDAYS[recur.weekday];
      return "Every " + name.charAt(0).toUpperCase() + name.slice(1);
    }
    if (recur.type === "weekly") return "Every week";
    if (recur.type === "monthly" && recur.day) {
      return "Every month on the " + ordinal(recur.day);
    }
    if (recur.type === "monthly") return "Every month";
    return "Repeats";
  }

  function ordinal(n) {
    var v = n % 100;
    if (v >= 11 && v <= 13) return n + "th";
    switch (n % 10) {
      case 1: return n + "st";
      case 2: return n + "nd";
      case 3: return n + "rd";
      default: return n + "th";
    }
  }

  var api = {
    TZ: TZ,
    parseReminder: parseReminder,
    zonedParts: zonedParts,
    nextOccurrence: nextOccurrence,
    recurLabel: recurLabel,
    addDaysParts: addDaysParts,
    fmtDate: fmtDate,
    weekdayIndex: weekdayIndex,
    WEEKDAYS: WEEKDAYS
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    root.ReminderParser = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
