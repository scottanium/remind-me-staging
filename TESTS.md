# Remind Me test checklist

Automated tests live in the `voice-reminder` workspace (`tests/parser.test.js`, `tests/cancel-reset.test.js`, `tests/staging-load.test.js`), not in this GitHub repo. Scott feel-tests on the staging site; he does not need to read code.

## Automated (run after every change)

Serve the staging files and run:

```
# from the voice-reminder workspace
node tests/parser.test.js
# original 33 plus ordinal/time cases, expect: all passed

# serve staging-upload (or a /remind-me-staging/ path), then:
REMIND_ME_URL=http://127.0.0.1:8770/remind-me-staging/ node tests/cancel-reset.test.js
# 4 tests, expect: 4 passed, 0 failed

REMIND_ME_URL=http://127.0.0.1:8770/remind-me-staging/ node tests/field-reset.test.js
# must-pass: date and time DOM fields reset after Save, Cancel, and reload
# (5 back-to-back reminders, iPhone-sized headless)

REMIND_ME_URL=http://127.0.0.1:8770/remind-me-staging/ node tests/staging-load.test.js
# headless load: STAGING banner visible, storage key prefixed, cache name
# is remind-me-staging-v5, no console errors, screenshot saved

# serve both live-candidate and staging-upload under one origin, then:
node tests/cache-isolation.test.js
# 1 test, expect: staging deletes only remind-me-staging-* old caches;
# live deletes only remind-me-v* old caches; other apps' caches are left alone
```

If you don’t say a time, the review card must show **9:00 AM**, never the previous reminder’s time.

Parser checks that phrases become the right title, date, time, lead time, and repeat setting, and that one phrase does not leak into the next. Cancel-reset checks that tapping Cancel clears the draft so the next reminder is fresh (typed and keyboard-mic paths).

## Staging load checks (automated or by hand)

- A yellow **STAGING** bar is clearly visible at the top.
- The browser console has no errors.
- Saved reminders use the `rm-staging:` key prefix (live uses `voice-reminders` with no prefix).
- The service worker cache name is `remind-me-staging-v5`.
- The app loads under a `/remind-me-staging/` path (manifest `start_url` and `scope` are `./index.html` and `./`; script and service-worker paths are relative).

## Feel-testing on staging (Scott, on the phone)

Open https://scottanium.github.io/remind-me-staging/

- [ ] The yellow STAGING bar is at the top.
- [ ] Type “dentist Tuesday at 2, remind me an hour before,” tap Add reminder, check the card, then Save. It shows up on the list.
- [ ] Open that reminder, tap Cancel, then type “lunch tomorrow at noon” and Add. The new card is lunch at noon, not the dentist time.
- [ ] Mark one done, delete one, and use Add to calendar or Export all to calendar.
- [ ] Export a backup, then Import it back, and confirm it asks before replacing.
- [ ] (Optional) Try the mic or the iPhone keyboard mic.
- [ ] Confirm the live app at https://scottanium.github.io/remind-me/ still has its own reminders (staging must not mix with live).

If any of those fail, do not go live.
