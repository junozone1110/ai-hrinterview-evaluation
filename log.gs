/**
 * ログ記録
 * 処理履歴をスプレッドシートに記録
 */

const LOG_HEADERS = [
  '処理日時', 'ファイルID', 'ファイル名', 'ステータス', 'エラーメッセージ', '処理時間(秒)',
  '処理フェーズ', 'HTTPステータス', 'リトライ回数', '詳細情報'
];

/**
 * 処理ログをスプレッドシートに記録
 * ※このログが処理済みファイルの管理も兼ねる
 * @param {GoogleAppsScript.Drive.File} file
 * @param {string} status - 'SUCCESS' | 'FAILED' | 'SKIPPED'
 * @param {string|null} errorMessage
 * @param {number} processingTime
 * @param {Object} errorDetails - エラー詳細情報（オプション）
 * @param {string} errorDetails.phase - 処理フェーズ
 * @param {number|null} errorDetails.httpStatus - HTTPステータス
 * @param {number|null} errorDetails.retryCount - リトライ回数
 * @param {string|null} errorDetails.detailJson - 詳細JSON
 */
function logProcessing(file, status, errorMessage, processingTime, errorDetails = {}) {
  try {
    const sheet = getLogSheet();
    ensureLogHeaders(sheet);

    sheet.appendRow([
      new Date(),
      file.getId(),
      file.getName(),
      status,
      errorMessage || '',
      processingTime,
      // 新規列（後方互換性のため、値がない場合は空文字）
      errorDetails.phase || '',
      errorDetails.httpStatus || '',
      errorDetails.retryCount !== undefined ? errorDetails.retryCount : '',
      errorDetails.detailJson || ''
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
 * ヘッダー行の検証と更新
 * 新規列が追加されている場合は既存シートのヘッダーを更新
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 */
function ensureLogHeaders(sheet) {
  const lastRow = sheet.getLastRow();

  if (lastRow === 0) {
    // 新規シート: 全ヘッダーを追加
    sheet.appendRow(LOG_HEADERS);
    return;
  }

  // 既存シート: ヘッダー列数を確認し、不足分を追加
  const lastCol = sheet.getLastColumn();
  if (lastCol < LOG_HEADERS.length) {
    // 不足している新規ヘッダーを追加
    const newHeaders = LOG_HEADERS.slice(lastCol);
    const startCol = lastCol + 1;
    sheet.getRange(1, startCol, 1, newHeaders.length).setValues([newHeaders]);
  }
}
