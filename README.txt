EL MEXICAN SCHEDULE APP — V0.1 TEST BUILD

PURPOSE
This is the first scheduling-engine test build. The goal is to test whether the generated weekly schedule behaves like the restaurant's real scheduling process before adding voice/photo availability import.

FILES
- index.html              App interface
- app.js                  Scheduling logic
- styles.css              Appearance / print layout
- schedule-data.json      Restaurant database / bundled defaults
- manifest.webmanifest    Installable web-app metadata
- sw.js                   Offline shell caching
- icon-192.png / 512.png  Temporary test icons

CURRENT TEST LOGIC
- Mon–Thu FOH: 11:00–3:30 and 3:00–close
- Friday FOH: 11:00–3:30, 3:00–close, 4:30–close
- Sat/Sun FOH: 8:00–3:30, 9:30–3:30, 3:00–close, 4:30–close
- Optional dishwasher/runner support can be included when generating a week
- Beto: Tuesday all day recurring, flexible, 40-hour minimum
- Danielle: weekly-variable availability
- Weekend AM server priority: David/Yazmin/Lily first; Beto/Danielle second
- Weekend AM dish/runner priority: Victoria, then Osvaldo, then Kelly
- Weekly availability exceptions
- Special-date / holiday extra coverage
- Manual shift reassignment
- Employee editing and archiving
- JSON import/export
- Print and share
- Weekly hour calculation; overlapping coverage is counted once

GITHUB PAGES
Upload every file in this folder to the same GitHub repository folder, with index.html at the published root. The app loads schedule-data.json separately. Changes made in the app are saved to that device's browser storage; use Export JSON Backup to move or preserve them.

IMPORTANT TEST NOTE
The bundled JSON is only the starting database. Once the app has been opened, the working copy is stored locally on the device. Use “Reload Bundled Defaults” on the Data tab if you intentionally want to replace that working copy with schedule-data.json again.

NEXT FEATURES AFTER SCHEDULING LOGIC IS VERIFIED
- Natural-language / voice availability entry
- Photo-to-availability import
- Faster shift/coverage-template editing
- Better schedule-history views
- Optional cloud sync if desired later
