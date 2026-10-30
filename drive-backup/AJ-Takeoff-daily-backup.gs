/**
 * AJ Takeoff daily backup (runs in your own Google account, free).
 *
 * Every night it copies into your shared drive, under  AJ take off app > Daily backups:
 *   <date>/AJ Takeoff app.html     the whole app, so it can be put back up anywhere
 *   <date>/Bid tracker.json        every row of the Bid tracker
 *   <date>/Job list.json           every job, including deleted ones
 *   <date>/Jobs/<job>.json         each job: counts, runs, bid, proposal, sheet names and markups
 *   Plan sheets/<job>/             every plan sheet image and its text, copied once (new sheets each night)
 * Dated folders older than 90 days go to the trash. Plan sheets are kept.
 *
 * Setup: paste this in and run  setUpDailyBackup  once. If the app has sign-in or a password, also add the Script property
 * APP_PASSWORD: the backup key shown on the app's Admin page (or the app password itself).
 */
const SITE = "https://aj-commercial-takeoff.vercel.app";
const BID_BACKUPS_FOLDER = "1Q1AgXUgvyylm-Npq2txLHOmlZhZdmWkA"; // "Bid tracker backups"; Daily backups goes next to it
const KEEP_DAYS = 90;
const TIME_LIMIT_MS = 5 * 60 * 1000; // Google stops a run at 6 minutes; sheets not copied yet are picked up next night

function setUpDailyBackup() {
  ScriptApp.getProjectTriggers().forEach(t => { if (t.getHandlerFunction() === "backupNow") ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger("backupNow").timeBased().everyDays(1).atHour(2).create();
  backupNow();
}

function backupNow() {
  const started = Date.now();
  const pass = PropertiesService.getScriptProperties().getProperty("APP_PASSWORD");
  const auth = pass ? { Authorization: "Basic " + Utilities.base64Encode("aj:" + pass.trim()) } : {}; // only needed when the app has a password
  const fetchSite = path => {
    const r = UrlFetchApp.fetch(SITE + path, { headers: auth, muteHttpExceptions: true });
    if (r.getResponseCode() === 401) throw new Error("The APP_PASSWORD Script property doesn't match. Use the backup key from the app's Admin page.");
    if (r.getResponseCode() !== 200) throw new Error(path + " answered " + r.getResponseCode());
    return r;
  };
  const home = DriveApp.getFolderById(BID_BACKUPS_FOLDER).getParents().next();
  const root = folder(home, "Daily backups");
  const day = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");
  const today = folder(root, day);
  const put = (dir, name, text, type) => { const old = dir.getFilesByName(name); while (old.hasNext()) old.next().setTrashed(true); dir.createFile(name, text, type || "application/json"); };

  put(today, "AJ Takeoff app.html", fetchSite("/").getContentText(), "text/html");
  put(today, "Bid tracker.json", fetchSite("/api/bids").getContentText());
  const jobs = JSON.parse(fetchSite("/api/jobs?all=1").getContentText()).jobs || [];
  put(today, "Job list.json", JSON.stringify(jobs, null, 1));

  const jobsDir = folder(today, "Jobs"), sheetsRoot = folder(root, "Plan sheets"), todo = [];
  // each job's sheet folder is found by the job number at the end of its name, so renaming a job doesn't copy it all again
  const byId = {}; const sf = sheetsRoot.getFolders();
  while (sf.hasNext()) { const f = sf.next(), m = /\(([\w-]{8})\)$/.exec(f.getName()); if (m) byId[m[1]] = f; }
  jobs.forEach(j => {
    const label = clean((j.deleted ? "DELETED " : "") + j.name + " (" + j.id.slice(0, 8) + ")");
    if (j.deleted) return put(jobsDir, label + ".txt", "Deleted " + j.deleted + (j.by ? " by " + j.by : "") + ". Older backups have its data.", "text/plain");
    const r = UrlFetchApp.fetch(j.url, { muteHttpExceptions: true });
    if (r.getResponseCode() !== 200) return;
    const text = r.getContentText();
    put(jobsDir, label + ".json", text);
    let data; try { data = JSON.parse(text); } catch (e) { return; }
    const dir = byId[j.id.slice(0, 8)] || (byId[j.id.slice(0, 8)] = sheetsRoot.createFolder(clean(j.name + " (" + j.id.slice(0, 8) + ")")));
    const have = {}; const it = dir.getFiles(); while (it.hasNext()) have[it.next().getName()] = true;
    (data.pages || []).forEach(p => ["img", "prev", "words"].forEach(k => {
      const c = p.cloud && p.cloud[k]; if (!c) return;
      const name = c[0].split("/").pop(); // the job's .json says which sheet each file is
      if (!have[name]) todo.push({ dir, name, url: c[0] });
    }));
  });
  let copied = 0;
  for (const t of todo) {
    if (Date.now() - started > TIME_LIMIT_MS) break;
    const r = UrlFetchApp.fetch(t.url, { muteHttpExceptions: true });
    if (r.getResponseCode() === 200) { t.dir.createFile(r.getBlob().setName(t.name)); copied++; }
  }
  // tidy: dated folders older than KEEP_DAYS go to the trash
  const cutoff = Utilities.formatDate(new Date(Date.now() - KEEP_DAYS * 864e5), Session.getScriptTimeZone(), "yyyy-MM-dd");
  const days = root.getFolders();
  while (days.hasNext()) { const f = days.next(); if (/^\d{4}-\d\d-\d\d$/.test(f.getName()) && f.getName() < cutoff) f.setTrashed(true); }
  console.log("Backed up " + jobs.length + " jobs. Copied " + copied + " of " + todo.length + " new sheet files" + (copied < todo.length ? "; the rest go tomorrow night." : "."));
}

function folder(parent, name) { const it = parent.getFoldersByName(name); return it.hasNext() ? it.next() : parent.createFolder(name); }
function clean(s) { return String(s || "").replace(/[\\/:*?"<>|]/g, "-").slice(0, 90).trim(); }
