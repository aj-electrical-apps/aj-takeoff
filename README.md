# AJ Takeoff

Commercial electrical takeoff for AJ Electrical: upload up to 120 plan pages, name sheets, zoom into corners, set the drawing scale, measure, draw linear-foot runs, and count fixtures and devices with engineer's descriptions.

It's a single static page (`index.html`), with no build step. Vercel serves it as-is.

When it's opened as the website, every job saves online in Vercel Blob a few seconds after each change (api/jobs, api/team-upload), so everyone using the app sees the same jobs. The browser keeps its own copy too. Google Drive saving works when the app is opened inside Claude.

A Google Apps Script (drive-backup/AJ-Takeoff-daily-backup.gs) copies the app, the Bid tracker, every job and every plan sheet into the shared drive each night.

Live site updates automatically from this repo through Vercel (project aj-commercial-takeoff).

Live app: https://aj-commercial-takeoff.vercel.app

## Sign-in and the Admin page (v116)
- Add `SESSION_SECRET` in Vercel (any long random text) and redeploy. After that everyone signs in on `/login.html` with their own name and password.
- People, their access (Admin / Office / Field), password resets and turning someone off are on the app's **Admin** button (admins only). The first person added is always an Admin. Passwords are saved only as PBKDF2 hashes in Blob (`team/admin/users-*.json`).
- Company details, labor hours, parts lists, standard exclusions and vendor lists are shared through `api/settings` (`team/admin/settings-*.json`).
- `APP_PASSWORD` (admin) and `FIELD_PASSWORD` (field) still work as shared logins if set. The Drive backup script uses the backup key from the Admin page as its `APP_PASSWORD` Script property.
- Without `SESSION_SECRET` the site works the old way (browser password box, or open if `APP_PASSWORD` isn't set).
- `sw.js` keeps the app on the device so it opens without internet. Changes made offline stay on the device and are saved online after a "You're back online" prompt.
