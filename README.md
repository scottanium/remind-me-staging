# Remind Me

A phone-friendly web app (PWA) for speaking or typing reminders like “dentist Tuesday at 2, remind me an hour before.” Reminders stay on the device. You can export them to a calendar file or a backup file. Times use Indianapolis time (Eastern).

## URLs

- Live: https://scottanium.github.io/remind-me/
- Staging (test copy): https://scottanium.github.io/remind-me-staging/

Staging shows a yellow **STAGING** bar at the top. It uses its own saved reminders and its own offline cache, so trying the test site will not change or mix with the live app.

## How to change common things

- **Switch staging vs live:** in `config.js`, set `STAGING` to `true` (test site) or `false` (live site). That one flag controls the banner, the save-key prefix (`rm-staging:`), and the service-worker cache name (`remind-me-staging-v3` vs `remind-me-v3`). Keep the rest of the files the same.
- **Look and layout:** `styles.css`.
- **On-screen wording, help text, and buttons:** `index.html` (and some messages in `app.js`).
- **How spoken or typed phrases are understood:** `parser.js`. Change this only when the meaning of a phrase should change, then rerun the parser tests.
- **Icons:** `icon-192.png` and `icon-512.png`.
- **App name on the Home Screen:** `manifest.json`. Keep `start_url` and `scope` as relative paths (`./index.html` and `./`) so the app works under both `/remind-me/` and `/remind-me-staging/`.

## What not to touch

- Do not put passwords, keys, or tokens in these files, in commits, or on GitHub. This app has none, and it should stay that way.
- Do not point staging at the live save key (`voice-reminders`) or the live cache name (`remind-me-v3`).
- Do not change live https://scottanium.github.io/remind-me/ until Scott has tried staging and approved going live on Keel’s list.
- Do not rewrite whole files for a small fix. Name the file or section, change only that part, and keep a restore point first.
- Do not add outside libraries, fonts, or keys without a plan. The app is self-contained.

## Legal and license

The live app has no LICENSE file and no separate legal or “I Agree” pages. A short “Your data” note lives in the in-app Help sheet: reminders stay on the phone or computer, and nothing is sent to an account.

## Staging vs live workflow

1. Change files here, with `STAGING: true` in `config.js`.
2. Open the staging URL on a phone and feel-test (see `TESTS.md`).
3. After approval to go live, set `STAGING` to `false` and publish the same files to the live site.
