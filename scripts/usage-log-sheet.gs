// Google Apps Script for the central generation log.
// Paste into the Sheet via Erweiterungen → Apps Script, then deploy as a web
// app (Ausführen als: Ich, Zugriff: Jeder). The token must match
// LOG_WEBHOOK_TOKEN in .env.local.
// The script only appends rows; callers cannot read or change the sheet.

const TOKEN = "PASTE_LOG_WEBHOOK_TOKEN";
const SHEET = "Log";

function doPost(e) {
  let data;
  try {
    data = JSON.parse(e.postData.contents);
  } catch (err) {
    return reply("bad request");
  }
  if (data.token !== TOKEN || !Array.isArray(data.row)) return reply("forbidden");

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const book = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = book.getSheetByName(SHEET) || book.insertSheet(SHEET);
    if (sheet.getLastRow() === 0 && Array.isArray(data.header)) {
      sheet.appendRow(data.header);
      sheet.setFrozenRows(1);
      sheet.getRange(1, 1, 1, data.header.length).setFontWeight("bold");
    }
    // Text cells are written as-is, so a prompt can never become a formula.
    sheet.appendRow(data.row.map((v) => (typeof v === "string" && /^[=+\-@]/.test(v) ? "'" + v : v)));
  } finally {
    lock.releaseLock();
  }
  return reply("ok");
}

function reply(text) {
  return ContentService.createTextOutput(text).setMimeType(ContentService.MimeType.TEXT);
}
