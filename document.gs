/**
 * ドキュメント取得
 * 共有アイテムからGoogleドキュメントを検索・取得
 */

/**
 * 共有アイテムから未処理ドキュメントを1件取得
 * ファイル名に「面接」または「面談」を含むもののみ対象
 * @param {string[]} processedFileIds - 処理済みファイルIDリスト
 * @returns {GoogleAppsScript.Drive.File|null}
 */
function getNextDocument(processedFileIds) {
  const query = "sharedWithMe=true and mimeType='application/vnd.google-apps.document' and trashed=false";
  const files = DriveApp.searchFiles(query);

  while (files.hasNext()) {
    const file = files.next();

    if (processedFileIds.includes(file.getId())) {
      continue;
    }

    if (matchesFilenameFilter(file.getName())) {
      return file;
    }
  }

  return null;
}

/**
 * ファイル名がフィルタ条件に一致するか判定
 * @param {string} fileName
 * @returns {boolean}
 */
function matchesFilenameFilter(fileName) {
  return CONFIG.FILENAME_FILTERS.some(filter => fileName.includes(filter));
}

/**
 * 処理済みファイルIDリストをスプレッドシートから取得
 * @returns {string[]}
 */
function getProcessedFileIds() {
  try {
    const spreadsheet = SpreadsheetApp.openById(CONFIG.LOG_SPREADSHEET_ID);
    const sheet = spreadsheet.getActiveSheet();
    const data = sheet.getDataRange().getValues();

    // B列（インデックス1）がファイルID
    return data.slice(1).map(row => row[1]).filter(id => id);
  } catch (e) {
    console.warn(`処理済みリスト取得失敗: ${e.message}`);
    return [];
  }
}

/**
 * Googleドキュメントの内容をExport URLでテキスト取得
 * すべてのタブの内容を結合して返す
 * @param {string} fileId
 * @returns {string}
 */
function getDocumentContentByExport(fileId) {
  const tabs = getDocumentTabs(fileId);

  if (tabs.length === 0) {
    return getDocumentTabContent(fileId, null);
  }

  const contents = tabs
    .map(tab => {
      const content = getDocumentTabContent(fileId, tab.id);
      return content && content.trim()
        ? `=== タブ: ${tab.title} ===\n${content}`
        : null;
    })
    .filter(Boolean);

  return contents.join('\n\n');
}

/**
 * ドキュメントのタブ一覧を取得
 * @param {string} fileId
 * @returns {Array<{id: string, title: string}>}
 */
function getDocumentTabs(fileId) {
  try {
    const url = `https://docs.googleapis.com/v1/documents/${fileId}?fields=tabs(tabProperties)`;
    const response = fetchWithAuth(url);

    if (response.getResponseCode() !== 200) {
      console.log('タブ情報取得失敗、従来方式にフォールバック');
      return [];
    }

    const doc = JSON.parse(response.getContentText());
    if (!doc.tabs || doc.tabs.length === 0) {
      return [];
    }

    return doc.tabs.map(tab => ({
      id: tab.tabProperties.tabId,
      title: tab.tabProperties.title
    }));
  } catch (e) {
    console.log(`タブ取得エラー: ${e.message}`);
    return [];
  }
}

/**
 * 特定タブの内容を取得
 * @param {string} fileId
 * @param {string|null} tabId
 * @returns {string}
 */
function getDocumentTabContent(fileId, tabId) {
  let url = `https://docs.google.com/document/d/${fileId}/export?format=txt`;
  if (tabId) {
    url += `&tab=${tabId}`;
  }

  const response = fetchWithAuth(url);
  const responseCode = response.getResponseCode();

  if (responseCode !== 200) {
    throw new Error(`ドキュメント取得失敗: HTTP ${responseCode}`);
  }

  return response.getContentText();
}

/**
 * OAuth認証付きでURLをフェッチ
 * @param {string} url
 * @returns {GoogleAppsScript.URL_Fetch.HTTPResponse}
 */
function fetchWithAuth(url) {
  return UrlFetchApp.fetch(url, {
    headers: {
      Authorization: 'Bearer ' + ScriptApp.getOAuthToken()
    },
    muteHttpExceptions: true
  });
}
