/**
 * ログ記録
 * 処理履歴をスプレッドシートに記録
 */

const LOG_HEADERS = ['処理日時', 'ファイルID', 'ファイル名', 'ステータス', 'エラーメッセージ', '処理時間(秒)'];

/**
 * 処理ログをスプレッドシートに記録
 * ※このログが処理済みファイルの管理も兼ねる
 * @param {GoogleAppsScript.Drive.File} file
 * @param {string} status - 'SUCCESS' | 'FAILED' | 'SKIPPED'
 * @param {string|null} errorMessage
 * @param {number} processingTime
 */
function logProcessing(file, status, errorMessage, processingTime) {
  try {
    const sheet = getLogSheet();
    ensureLogHeaders(sheet);

    sheet.appendRow([
      new Date(),
      file.getId(),
      file.getName(),
      status,
      errorMessage || '',
      processingTime
    ]);
  } catch (e) {
    console.error(`ログ記録失敗: ${e.message}`);
  }
}

/**
 * ログ用スプレッドシートのシートを取得
 * @returns {GoogleAppsScript.Spreadsheet.Sheet}
 */
function getLogSheet() {
  const config = getScriptConfig();
  const spreadsheet = SpreadsheetApp.openById(config.logSpreadsheetId);
  return spreadsheet.getActiveSheet();
}

/**
 * ヘッダー行がなければ追加
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 */
function ensureLogHeaders(sheet) {
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(LOG_HEADERS);
  }
}
