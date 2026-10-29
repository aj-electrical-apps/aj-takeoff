# AJ Takeoff

Commercial electrical takeoff for AJ Electrical: upload up to 120 plan pages, name sheets, zoom into corners, set the drawing scale, measure, draw linear-foot runs, and count fixtures and devices with engineer's descriptions.

It's a single static page (`index.html`), with no build step. Vercel serves it as-is.

When it's opened as the website, every job saves online in Vercel Blob a few seconds after each change (api/jobs, api/team-upload), so everyone using the app sees the same jobs. The browser keeps its own copy too. Google Drive saving works when the app is opened inside Claude.

A Google Apps Script (drive-backup/AJ-Takeoff-daily-backup.gs) copies the app, the Bid tracker, every job and every plan sheet into the shared drive each night.

Live site updates automatically from this repo through Vercel (project aj-commercial-takeoff).

Live app: https://aj-commercial-takeoff.vercel.app
