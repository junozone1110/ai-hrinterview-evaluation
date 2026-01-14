/**
 * メイン処理
 * 面接フィードバックレポート自動生成システム
 *
 * 【仕様】
 * - 入力: 「共有アイテム」から「面接」「面談」を含むGoogleドキュメントを検索
 * - 出力: 共有ドライブの /面接/output フォルダにMDファイルを保存 + Slack通知
 * - 処理済み管理: スプレッドシートにファイルIDを記録（元ファイルは移動しない）
 */

/**
 * メインエントリポイント（トリガーから呼び出される）
 */
function main() {
  const startTime = new Date();
  let file = null;

  const lock = LockService.getScriptLock();
  const hasLock = lock.tryLock(CONFIG.LOCK_TIMEOUT_MS);

  if (!hasLock) {
    console.log('別のプロセスが実行中のためスキップ');
    return;
  }

  try {
    file = findUnprocessedDocument();
    if (!file) {
      console.log('処理対象のドキュメントがありません');
      return;
    }

    console.log(`処理開始: ${file.getName()}`);
    processDocument(file, startTime);

  } catch (error) {
    handleProcessingError(error, file, startTime);
  } finally {
    lock.releaseLock();
  }
}

/**
 * 未処理ドキュメントを検索
 * @returns {GoogleAppsScript.Drive.File|null}
 */
function findUnprocessedDocument() {
  const processedFileIds = getProcessedFileIds();
  return getNextDocument(processedFileIds);
}

/**
 * ドキュメントを処理
 * @param {GoogleAppsScript.Drive.File} file
 * @param {Date} startTime
 */
function processDocument(file, startTime) {
  const content = getDocumentContentByExport(file.getId());
  validateDocumentContent(content);

  console.log(`文字数: ${content.length}`);

  // 採用面接かどうかを判定
  const classification = classifyInterview(content);
  if (!classification.isRecruitmentInterview) {
    handleSkippedDocument(file, classification, startTime);
    return;
  }

  console.log(`採用面接と判定: ${classification.reason}`);

  // レポート生成と保存
  const reports = generateFeedback(content);
  const savedFiles = saveMdFilesToGoogleDrive(reports);

  // Slack通知
  uploadFilesToSlack(savedFiles);

  // 処理完了ログ
  const processingTime = calculateProcessingTime(startTime);
  logProcessing(file, 'SUCCESS', null, processingTime);
  console.log(`処理完了: ${file.getName()} (${processingTime}秒)`);
}

/**
 * ドキュメント内容のバリデーション
 * @param {string} content
 */
function validateDocumentContent(content) {
  if (!content || content.trim().length === 0) {
    throw new Error('ドキュメントの内容が空です');
  }
}

/**
 * スキップされたドキュメントの処理
 * @param {GoogleAppsScript.Drive.File} file
 * @param {Object} classification
 * @param {Date} startTime
 */
function handleSkippedDocument(file, classification, startTime) {
  console.log(`スキップ: ${classification.reason}`);
  const processingTime = calculateProcessingTime(startTime);
  logProcessing(file, 'SKIPPED', classification.reason, processingTime);
}

/**
 * 処理エラーのハンドリング（詳細情報対応）
 * @param {Error|DetailedError} error
 * @param {GoogleAppsScript.Drive.File|null} file
 * @param {Date} startTime
 */
function handleProcessingError(error, file, startTime) {
  console.error(`エラー発生: ${error.message}`);
  const processingTime = calculateProcessingTime(startTime);

  // DetailedErrorから詳細情報を抽出
  const errorDetails = {
    phase: '',
    httpStatus: '',
    retryCount: '',
    detailJson: ''
  };

  if (error instanceof DetailedError) {
    errorDetails.phase = error.phase;
    errorDetails.httpStatus = error.httpStatus || '';
    errorDetails.retryCount = error.retryHistory ? error.retryHistory.length : '';
    errorDetails.detailJson = error.toDetailJson();
  }

  if (file) {
    logProcessing(file, 'FAILED', error.message, processingTime, errorDetails);
  }
  // Slackにエラー通知
  sendErrorNotification(file, error);
}

/**
 * 処理時間を計算（秒）
 * @param {Date} startTime
 * @returns {number}
 */
function calculateProcessingTime(startTime) {
  return (new Date() - startTime) / 1000;
}
