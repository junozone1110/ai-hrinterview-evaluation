/**
 * Google Drive操作
 * ファイルの保存と設定ファイルの読み込み
 */

/**
 * MDファイルを共有ドライブの/面接/outputフォルダに保存
 * @param {Array<{fileName: string, content: string}>} reports
 * @returns {Array<{id: string, name: string, content: string, url: string}>}
 */
function saveMdFilesToGoogleDrive(reports) {
  const config = getScriptConfig();
  const outputFolder = DriveApp.getFolderById(config.outputFolderId);

  return reports.map(report => {
    const blob = Utilities.newBlob(report.content, 'text/markdown', report.fileName);
    const file = outputFolder.createFile(blob);

    console.log(`ファイル保存: ${report.fileName}`);

    return {
      id: file.getId(),
      name: report.fileName,
      content: report.content,
      url: file.getUrl()
    };
  });
}

/**
 * 指定フォルダ内のMDファイルを名前で検索して内容を取得
 * @param {string} folderId
 * @param {string} fileName
 * @returns {string}
 */
function getMdFileContent(folderId, fileName) {
  const folder = DriveApp.getFolderById(folderId);
  const files = folder.getFilesByName(fileName);

  if (!files.hasNext()) {
    throw new Error(`設定ファイルが見つかりません: ${fileName}`);
  }

  const file = files.next();
  console.log(`設定ファイル読み込み: ${file.getName()}`);
  return file.getBlob().getDataAsString('UTF-8');
}

/**
 * 評価ガイドラインを外部ファイルから取得
 * @returns {string}
 */
function getEvaluationGuidelines() {
  const config = getScriptConfig();
  return getMdFileContent(config.configFolderId, CONFIG.GUIDELINE_FILE);
}

/**
 * レポート雛形を外部ファイルから取得
 * @returns {string}
 */
function getReportTemplate() {
  const config = getScriptConfig();
  return getMdFileContent(config.configFolderId, CONFIG.TEMPLATE_FILE);
}

/**
 * 生成指示プロンプトを外部ファイルから取得
 * @returns {string}
 */
function getPromptInstructions() {
  const config = getScriptConfig();
  return getMdFileContent(config.configFolderId, CONFIG.PROMPT_FILE);
}
