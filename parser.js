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
      .replace(/\b([ap])\.?m\.?/g, "$1m")
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

  var WORD_HOUR_RE = "one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve";
  var WORD_HOUR_MAP = {
    one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
    ten: 10, eleven: 11, twelve: 12
  };

  function wordHourValue(name) {
    return WORD_HOUR_MAP[String(name || "").toLowerCase()] || null;
  }

  function wordMinuteValue(phrase) {
    var w = String(phrase || "").toLowerCase().replace(/['’]/g, "'").replace(/\s+/g, " ").trim();
    w = w.replace(/-/g, " ");
    if (/^o\s*'?\s*clock$/.test(w) || w === "oclock") return 0;
    var units = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
    var teens = {
      ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
      sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19
    };
    var tens = { twenty: 20, thirty: 30, forty: 40, fifty: 50 };
    if (teens[w] != null) return teens[w];
    var oh = w.match(/^o(?:h)?\s+(one|two|three|four|five|six|seven|eight|nine)$/);
    if (oh) return units.indexOf(oh[1]);
    var parts = w.split(" ");
    if (parts.length === 1) {
      if (tens[parts[0]] != null) return tens[parts[0]];
      if (units.indexOf(parts[0]) > 0) return units.indexOf(parts[0]);
      return null;
    }
    if (parts.length === 2 && tens[parts[0]] != null && units.indexOf(parts[1]) > 0) {
      return tens[parts[0]] + units.indexOf(parts[1]);
    }
    return null;
  }

  var WORD_MINUTE_RE = (
    "o\\s*'?\\s*clock|oclock|oh\\s+(?:one|two|three|four|five|six|seven|eight|nine)|" +
    "twenty(?:[\\-\\s](?:one|two|three|four|five|six|seven|eight|nine))?|" +
    "thirty(?:[\\-\\s](?:one|two|three|four|five|six|seven|eight|nine))?|" +
    "forty(?:[\\-\\s](?:one|two|three|four|five|six|seven|eight|nine))?|" +
    "fifty(?:[\\-\\s](?:one|two|three|four|five|six|seven|eight|nine))?|" +
    "thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|" +
    "ten|eleven|twelve|one|two|three|four|five|six|seven|eight|nine"
  );

  /* Colonless 3-4 digit times from iOS dictation, e.g. "1225" → 12:25.
   * 4-digit numbers from 1900-2099 are years, not times (see extractAdjacentYear).
   * Hour 13-23 is military time. Hour 1-12 uses the same am/pm rules as "h:mm":
   * bare 12 is noon, 1-7 default to PM, 8-11 stay AM. If that clock time has
   * already passed today, the date rolls to tomorrow — not to the AM tonight.
   * Example: "1225 doctors appointment" said at 2:44 PM on Nov 22 →
   * title "Doctors appointment", date Nov 23, time 12:25 (afternoon, tomorrow).
   */
  function parseColonlessDigits(raw) {
    var n = String(raw || "");
    if (!/^\d{3,4}$/.test(n)) return null;
    var hour, minute;
    if (n.length === 4) {
      var asNum = parseInt(n, 10);
      if (asNum >= 1900 && asNum <= 2099) return null;
      hour = parseInt(n.slice(0, 2), 10);
      minute = parseInt(n.slice(2, 4), 10);
      if (hour > 23 || minute > 59) return null;
      return { hour: hour, minute: minute, military: hour >= 13 || hour === 0 };
    }
    hour = parseInt(n.slice(0, 1), 10);
    minute = parseInt(n.slice(1, 3), 10);
    if (hour < 1 || hour > 9 || minute > 59) return null;
    return { hour: hour, minute: minute, military: false };
  }

  function extractAdjacentYear(s, start, end) {
    var after = s.slice(end).match(/^\s*,?\s*(19\d{2}|20\d{2})\b/);
    if (after) return { year: parseInt(after[1], 10), start: start, end: end + after[0].length };
    var before = s.slice(0, start).match(/\b(19\d{2}|20\d{2})\s*,?\s*$/);
    if (before) return { year: parseInt(before[1], 10), start: start - before[0].length, end: end };
    return null;
  }

  function applyExplicitYear(baseDate, year, parts) {
    if (!year || !baseDate) return baseDate;
    if (year === parts.year) return baseDate;
    return { year: year, month: baseDate.month, day: Math.min(baseDate.day, daysInMonth(year, baseDate.month)) };
  }

  function parseTime(s) {
    var time = null;
    var tonight = false;
    var merHint = null;
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

    // tonight / this evening → 7:00 PM if no other time is given
    if (/\btonight\b/.test(s) || /\bin the evening\b/.test(s) || /\b(?:this\s+)?evening\b/.test(s)) {
      tonight = true;
      merHint = "pm";
      s = s.replace(/\btonight\b|\bin the evening\b|\b(?:this\s+)?evening\b/g, " ").replace(/\s+/g, " ").trim();
    }
    // this morning / morning → 9:00 AM if no other time is given; also marks bare hours as AM
    var morning = false;
    if (/\bin the morning\b/.test(s) || /\b(?:this\s+)?morning\b/.test(s)) {
      morning = true;
      merHint = "am";
      s = s.replace(/\bin the morning\b|\b(?:this\s+)?morning\b/g, " ").replace(/\s+/g, " ").trim();
    }

    function takeMer(explicit) {
      return explicit || merHint || null;
    }

    function merToken(tok) {
      return /^am$|^pm$/.test(tok || "") ? takeMer(tok) : takeMer(null);
    }

    function hourFromToken(tok) {
      if (/^\d{1,2}$/.test(tok)) return parseInt(tok, 10);
      return wordHourValue(tok);
    }

    var merOrClock = "(am|pm|o\\s*'?\\s*clock|oclock)";
    var hourToken = "(\\d{1,2}|" + WORD_HOUR_RE + ")";

    // quarter past 4 / twelve, quarter to 4, half past 12
    m = s.match(new RegExp("\\b(?:a\\s+)?quarter\\s+past\\s+" + hourToken + "(?:\\s*(am|pm))?\\b"));
    if (m) {
      time = resolveHourMinute(hourFromToken(m[1]), 15, takeMer(m[2]));
      s = cut(s, m.index, m.index + m[0].length);
      return { s: s, time: time, tonight: tonight };
    }
    m = s.match(new RegExp("\\b(?:a\\s+)?quarter\\s+(?:to|of)\\s+" + hourToken + "(?:\\s*(am|pm))?\\b"));
    if (m) {
      var hmTo = resolveHourMinute(hourFromToken(m[1]), 0, takeMer(m[2]));
      var minsTo = hmTo.hour * 60 + hmTo.minute - 15;
      if (minsTo < 0) minsTo += 24 * 60;
      time = { hour: Math.floor(minsTo / 60) % 24, minute: minsTo % 60 };
      s = cut(s, m.index, m.index + m[0].length);
      return { s: s, time: time, tonight: tonight };
    }
    m = s.match(new RegExp("\\bhalf\\s+past\\s+" + hourToken + "(?:\\s*(am|pm))?\\b"));
    if (m) {
      time = resolveHourMinute(hourFromToken(m[1]), 30, takeMer(m[2]));
      s = cut(s, m.index, m.index + m[0].length);
      return { s: s, time: time, tonight: tonight };
    }

    // Spoken "twelve twenty five", "twelve o'clock"
    m = s.match(new RegExp("\\b(?:at\\s+)?(" + WORD_HOUR_RE + ")\\s+(" + WORD_MINUTE_RE + ")(?:\\s*(am|pm))?\\b"));
    if (m) {
      var spokenMin = wordMinuteValue(m[2]);
      var spokenHour = wordHourValue(m[1]);
      if (spokenHour != null && spokenMin != null) {
        time = resolveHourMinute(spokenHour, spokenMin, takeMer(m[3]));
        s = cut(s, m.index, m.index + m[0].length);
        return { s: s, time: time, tonight: tonight };
      }
    }

    // Colonless 3-4 digit times: 1225, 325, 0930, 1430, 2100. Optional at / am/pm / o'clock.
    // Years 1900-2099 are not treated as times.
    m = s.match(new RegExp("\\b(?:at\\s+)?(\\d{3,4})(?:\\s*" + merOrClock + ")?\\b"));
    if (m) {
      var digits = parseColonlessDigits(m[1]);
      if (digits) {
        if (digits.military) time = { hour: digits.hour, minute: digits.minute };
        else time = resolveHourMinute(digits.hour, digits.minute, merToken(m[2]));
        s = cut(s, m.index, m.index + m[0].length);
        return { s: s, time: time, tonight: tonight };
      }
    }

    // iOS dictation "12 25" or "12.25"
    m = s.match(new RegExp("\\b(?:at\\s+)?(\\d{1,2})[\\s.](\\d{2})(?:\\s*" + merOrClock + ")?\\b"));
    if (m) {
      var afterSpaced = s.slice(m.index + m[0].length);
      if (!/^\s*(?:minutes?|mins?|hours?|hrs?|days?)\b/.test(afterSpaced)) {
        var sh = parseInt(m[1], 10);
        var smn = parseInt(m[2], 10);
        if (smn <= 59 && ((sh >= 1 && sh <= 12) || (sh >= 13 && sh <= 23) || sh === 0)) {
          if (sh >= 13 || sh === 0) time = { hour: sh, minute: smn };
          else time = resolveHourMinute(sh, smn, merToken(m[3]));
          s = cut(s, m.index, m.index + m[0].length);
          return { s: s, time: time, tonight: tonight };
        }
      }
    }

    // Spoken hour only: "at twelve", "three pm", "three o'clock"
    m = s.match(new RegExp("\\b(?:(at)\\s+)?(" + WORD_HOUR_RE + ")(?:\\s*" + merOrClock + ")?\\b"));
    if (m && (m[1] || m[3])) {
      time = resolveHourMinute(wordHourValue(m[2]), 0, merToken(m[3]));
      s = cut(s, m.index, m.index + m[0].length);
      return { s: s, time: time, tonight: tonight };
    }

    // Prefer "at 2", then "2:30", then "2pm" so we never grab a stray number.
    var timePatterns = [
      /\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm|o\s*'?\s*clock|oclock)?\b/,
      /\b(\d{1,2}):(\d{2})\s*(am|pm|o\s*'?\s*clock|oclock)?\b/,
      /\b(\d{1,2})\s*(am|pm|o\s*'?\s*clock|oclock)\b/
    ];
    for (var ti = 0; ti < timePatterns.length; ti++) {
      m = s.match(timePatterns[ti]);
      if (!m) continue;
      var prevCh = s[m.index - 1];
      var nextCh = s[m.index + m[0].length];
      if (prevCh === "/" || nextCh === "/") continue;
      if (ti === 0) time = resolveHourMinute(m[1], m[2], merToken(m[3]));
      else if (ti === 1) time = resolveHourMinute(m[1], m[2], merToken(m[3]));
      else time = resolveHourMinute(m[1], 0, merToken(m[2]));
      s = cut(s, m.index, m.index + m[0].length);
      break;
    }

    if (!time && morning) time = { hour: 9, minute: 0 };

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

    var yearFirstMonthRe = new RegExp("\\b(19\\d{2}|20\\d{2})\\s+(" + MONTH_RE + ")\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b");
    m = s.match(yearFirstMonthRe);
    if (m) {
      date = yearMonthDay(parts, monthIndex(m[2]), parseInt(m[3], 10), parseInt(m[1], 10));
      s = cut(s, m.index, m.index + m[0].length);
      return { s: s, date: date };
    }

    var monthRe = new RegExp("\\b(" + MONTH_RE + ")\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:\\s*,?\\s*(\\d{4}))?\\b");
    m = s.match(monthRe);
    if (m) {
      var monthYear = m[3] ? parseInt(m[3], 10) : null;
      var monthStart = m.index;
      var monthEnd = m.index + m[0].length;
      if (!monthYear) {
        var monthAdj = extractAdjacentYear(s, monthStart, monthEnd);
        if (monthAdj) {
          monthYear = monthAdj.year;
          monthStart = monthAdj.start;
          monthEnd = monthAdj.end;
        }
      }
      date = yearMonthDay(parts, monthIndex(m[1]), parseInt(m[2], 10), monthYear);
      s = cut(s, monthStart, monthEnd);
      return { s: s, date: date };
    }

    m = s.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
    if (m) {
      date = yearMonthDay(parts, parseInt(m[1], 10) - 1, parseInt(m[2], 10), m[3] ? parseInt(m[3], 10) : null);
      s = s.replace(m[0], " ").replace(/\s+/g, " ").trim();
      return { s: s, date: date };
    }

    // Bare ordinal day: "on the 27th", "the 27th", "27th".
    // If that day has already passed this month (or is today and the time has passed), use next month.
    var ordinalGuessH = h != null ? h : 9;
    m = s.match(/\b(?:on\s+)?(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)\b/);
    if (m) {
      var ordDay = parseInt(m[1], 10);
      if (ordDay >= 1 && ordDay <= 31) {
        date = nextMonthOnDay(parts, ordDay, ordinalGuessH, min);
        var ordAdj = extractAdjacentYear(s, m.index, m.index + m[0].length);
        if (ordAdj) {
          date = applyExplicitYear(date, ordAdj.year, parts);
          s = cut(s, ordAdj.start, ordAdj.end);
        } else {
          s = s.replace(m[0], " ").replace(/\s+/g, " ").trim();
        }
        return { s: s, date: date };
      }
    }

    // Word ordinals: "on the twenty-seventh", "the fifth"
    var wordOrdRe = new RegExp(
      "\\b(?:on\\s+)?the\\s+(" +
      "twenty[\\-\\s](?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth)|" +
      "thirty[\\-\\s]first|thirtieth|twentieth|" +
      "nineteenth|eighteenth|seventeenth|sixteenth|fifteenth|fourteenth|thirteenth|" +
      "twelfth|eleventh|tenth|ninth|eighth|seventh|sixth|fifth|fourth|third|second|first" +
      ")\\b"
    );
    m = s.match(wordOrdRe);
    if (m) {
      var wordDay = wordOrdinalToDay(m[1]);
      if (wordDay) {
        date = nextMonthOnDay(parts, wordDay, ordinalGuessH, min);
        var wordAdj = extractAdjacentYear(s, m.index, m.index + m[0].length);
        if (wordAdj) {
          date = applyExplicitYear(date, wordAdj.year, parts);
          s = cut(s, wordAdj.start, wordAdj.end);
        } else {
          s = s.replace(m[0], " ").replace(/\s+/g, " ").trim();
        }
        return { s: s, date: date };
      }
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

  function wordOrdinalToDay(word) {
    var w = String(word || "").toLowerCase().replace(/\s+/g, "-");
    var map = {
      first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10,
      eleventh: 11, twelfth: 12, thirteenth: 13, fourteenth: 14, fifteenth: 15, sixteenth: 16, seventeenth: 17,
      eighteenth: 18, nineteenth: 19, twentieth: 20, "twenty-first": 21, "twenty-second": 22, "twenty-third": 23,
      "twenty-fourth": 24, "twenty-fifth": 25, "twenty-sixth": 26, "twenty-seventh": 27, "twenty-eighth": 28,
      "twenty-ninth": 29, thirtieth: 30, "thirty-first": 31
    };
    return map[w] || null;
  }

  /* Fresh default when no time is spoken: 9:00 AM. Tonight/this evening: 7:00 PM.
     Never reuse a previous reminder's time. */
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
