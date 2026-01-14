/**
 * Claude API連携
 * 面接分類とフィードバックレポート生成
 */

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
const CLAUDE_API_VERSION = '2023-06-01';

/**
 * 面接内容が採用面接/カジュアル面談かどうかを判定
 * @param {string} content - ドキュメント内容
 * @returns {{isRecruitmentInterview: boolean, reason: string}}
 */
function classifyInterview(content) {
  const config = getScriptConfig();
  if (!config.claudeApiKey) {
    throw new Error('CLAUDE_API_KEY が設定されていません');
  }

  const contentPreview = content.substring(0, CONFIG.CONTENT_PREVIEW_LENGTH);

  try {
    const response = callClaudeApi({
      apiKey: config.claudeApiKey,
      model: CONFIG.CLAUDE_MODEL_CLASSIFIER,
      maxTokens: CONFIG.CLAUDE_CLASSIFIER_MAX_TOKENS,
      systemPrompt: buildClassificationPrompt(),
      userMessage: `以下のテキストを分類してください：\n\n${contentPreview}`
    }, PROCESSING_PHASE.CLASSIFICATION);

    return parseClassificationResponse(response);
  } catch (e) {
    console.warn(`分類処理エラー: ${e.message}`);
    // DetailedErrorの場合はそのまま再スロー（デフォルト処理をせず上位で処理）
    if (e instanceof DetailedError) {
      throw e;
    }
    return { isRecruitmentInterview: true, reason: '分類エラー - デフォルト処理' };
  }
}

/**
 * 分類用プロンプトを構築
 * @returns {string}
 */
function buildClassificationPrompt() {
  return `あなたは面接内容を分類するアシスタントです。
与えられたテキストが以下のどちらに該当するかを判定してください。

【処理対象（採用関連）】
- 採用面接（新卒・中途）
- カジュアル面談（採用候補者との面談）
- 選考面接
- 最終面接

【処理対象外（社内ミーティング）】
- 振り返り面談（チームメンバーとの1on1）
- 評価面談（既存社員の評価）
- 目標設定面談
- キャリア面談（既存社員向け）
- 社内ミーティング全般

必ず以下のJSON形式のみで回答してください。他の文章は一切含めないでください：
{"isRecruitmentInterview": true/false, "reason": "判定理由（20文字以内）"}`;
}

/**
 * 分類レスポンスをパース
 * @param {string} responseText
 * @returns {{isRecruitmentInterview: boolean, reason: string}}
 */
function parseClassificationResponse(responseText) {
  const classification = JSON.parse(responseText);
  return {
    isRecruitmentInterview: classification.isRecruitmentInterview === true,
    reason: classification.reason || '理由不明'
  };
}

/**
 * Claude APIを呼び出してフィードバックレポートを生成
 * @param {string} transcriptContent
 * @returns {Array<{fileName: string, content: string}>}
 */
function generateFeedback(transcriptContent) {
  const config = getScriptConfig();
  if (!config.claudeApiKey) {
    throw new Error('CLAUDE_API_KEY が設定されていません');
  }

  const systemPrompt = getSystemPrompt();
  const userContent = buildFeedbackUserContent(transcriptContent);

  const response = callClaudeApi({
    apiKey: config.claudeApiKey,
    model: CONFIG.CLAUDE_MODEL,
    maxTokens: CONFIG.CLAUDE_MAX_TOKENS,
    systemPrompt: systemPrompt,
    userMessage: userContent
  }, PROCESSING_PHASE.GENERATION);

  return parseGeneratedReports(response);
}

/**
 * フィードバック生成用のユーザーコンテンツを構築
 * @param {string} transcriptContent
 * @returns {string}
 */
function buildFeedbackUserContent(transcriptContent) {
  const speakers = extractSpeakersFromTranscript(transcriptContent);
  const currentDate = getDateString();
  const pastFeedbacksBySpeaker = collectPastFeedbacksForSpeakers(speakers, currentDate);

  if (Object.keys(pastFeedbacksBySpeaker).length > 0) {
    console.log(`過去フィードバック対象面接官: ${Object.keys(pastFeedbacksBySpeaker).join(', ')}`);
  }

  let content = `以下は面接の文字起こしデータです。指示に従ってフィードバックレポートと面接サマリを生成してください。\n\n---\n\n${transcriptContent}`;

  const comparisonContext = buildAllComparisonContexts(pastFeedbacksBySpeaker);
  if (comparisonContext) {
    content += `\n\n${comparisonContext}`;
  }

  return content;
}

/**
 * Claude APIを呼び出す共通関数（リトライ機能付き）
 * @param {Object} params
 * @param {string} phase - 処理フェーズ
 * @returns {string} レスポンステキスト
 */
function callClaudeApi(params, phase) {
  const { apiKey, model, maxTokens, systemPrompt, userMessage } = params;

  const payload = {
    model: model,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }]
  };

  const options = {
    method: 'post',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': CLAUDE_API_VERSION
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  return executeWithRetry(() => {
    const response = UrlFetchApp.fetch(CLAUDE_API_URL, options);
    const responseCode = response.getResponseCode();
    const responseText = response.getContentText();

    // リトライ可能なエラーをチェック
    if (isRetryableError(responseCode, responseText)) {
      throw new RetryableError(`Claude API エラー: ${responseCode}`, {
        httpStatus: responseCode,
        responseBody: responseText
      });
    }

    if (responseCode !== 200) {
      throw new DetailedError(`Claude API エラー: ${responseCode}`, {
        phase: phase,
        httpStatus: responseCode,
        responseBody: responseText
      });
    }

    const responseBody = JSON.parse(responseText);
    return responseBody.content[0].text.trim();
  }, phase);
}

/**
 * リトライ可能なエラーかどうかを判定
 * @param {number} responseCode
 * @param {string} responseText
 * @returns {boolean}
 */
function isRetryableError(responseCode, responseText) {
  // ネットワーク関連エラー
  const retryableMessages = [
    'Address unavailable',
    'Connection timed out',
    'Connection refused',
    'Service unavailable',
    'overloaded'
  ];

  // レスポンステキストにリトライ可能なメッセージが含まれているか
  const hasRetryableMessage = retryableMessages.some(msg =>
    responseText.toLowerCase().includes(msg.toLowerCase())
  );

  // HTTPステータスコードでリトライ可能なもの
  // 429: Rate limit, 500: Internal Server Error, 502: Bad Gateway, 503: Service Unavailable, 504: Gateway Timeout
  const retryableStatusCodes = [429, 500, 502, 503, 504];

  return hasRetryableMessage || retryableStatusCodes.includes(responseCode);
}

/**
 * リトライ可能エラークラス
 */
class RetryableError extends Error {
  /**
   * @param {string} message
   * @param {Object} details
   * @param {number|null} details.httpStatus
   * @param {string|null} details.responseBody
   */
  constructor(message, details = {}) {
    super(message);
    this.name = 'RetryableError';
    this.httpStatus = details.httpStatus || null;
    this.responseBody = details.responseBody || null;
  }
}

/**
 * 詳細情報を保持するエラークラス
 */
class DetailedError extends Error {
  /**
   * @param {string} message
   * @param {Object} details
   * @param {string} details.phase - 処理フェーズ
   * @param {number|null} details.httpStatus - HTTPステータスコード
   * @param {string|null} details.responseBody - APIレスポンス
   * @param {Array|null} details.retryHistory - リトライ履歴
   */
  constructor(message, details = {}) {
    super(message);
    this.name = 'DetailedError';
    this.phase = details.phase || 'UNKNOWN';
    this.httpStatus = details.httpStatus || null;
    this.responseBody = details.responseBody
      ? details.responseBody.substring(0, CONFIG.ERROR_RESPONSE_MAX_LENGTH)
      : null;
    this.retryHistory = details.retryHistory || null;
  }

  /**
   * ログ記録用のJSON文字列を生成
   * @returns {string}
   */
  toDetailJson() {
    const detail = {
      phase: this.phase,
      httpStatus: this.httpStatus,
      retryHistory: this.retryHistory
    };
    if (this.responseBody) {
      detail.response = this.responseBody.substring(0, 200);
    }
    return JSON.stringify(detail);
  }
}

/**
 * リトライ付きで関数を実行（詳細情報収集対応）
 * @param {Function} fn - 実行する関数
 * @param {string} phase - 処理フェーズ
 * @returns {*} 関数の戻り値
 */
function executeWithRetry(fn, phase) {
  const maxAttempts = CONFIG.API_RETRY_MAX_ATTEMPTS;
  const initialDelay = CONFIG.API_RETRY_INITIAL_DELAY_MS;

  let lastError;
  let lastHttpStatus = null;
  let lastResponseBody = null;
  const retryHistory = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = fn();
      // 成功時もリトライがあれば記録
      if (retryHistory.length > 0) {
        retryHistory.push({ attempt, success: true });
      }
      return result;
    } catch (error) {
      lastError = error;

      // RetryableErrorから詳細情報を抽出
      if (error instanceof RetryableError) {
        lastHttpStatus = error.httpStatus;
        lastResponseBody = error.responseBody;
      }

      // リトライ履歴を記録
      const delay = attempt < maxAttempts ? initialDelay * Math.pow(2, attempt - 1) : 0;
      retryHistory.push({
        attempt,
        success: false,
        httpStatus: lastHttpStatus,
        error: error.message.substring(0, 100),
        delayMs: delay
      });

      // リトライ可能なエラーでない場合は即座にスロー
      if (!(error instanceof RetryableError)) {
        throw new DetailedError(error.message, {
          phase: phase,
          httpStatus: lastHttpStatus,
          responseBody: lastResponseBody,
          retryHistory: retryHistory
        });
      }

      // 最後の試行の場合はリトライしない
      if (attempt === maxAttempts) {
        console.error(`リトライ上限に達しました (${maxAttempts}回)`);
        throw new DetailedError(error.message, {
          phase: phase,
          httpStatus: lastHttpStatus,
          responseBody: lastResponseBody,
          retryHistory: retryHistory
        });
      }

      // 指数バックオフで待機
      console.warn(`リトライ ${attempt}/${maxAttempts}: ${delay}ms後に再試行 - ${error.message}`);
      Utilities.sleep(delay);
    }
  }

  throw lastError;
}

/**
 * Claude APIの出力を個別のレポートファイルに分割
 * @param {string} generatedText
 * @returns {Array<{fileName: string, content: string}>}
 */
function parseGeneratedReports(generatedText) {
  // パターン1: "# 出力ファイル名:" で始まるセクション（markdownブロックなし）
  let reports = parseReportsWithHeaderFileNamePattern(generatedText);

  // パターン2: "出力ファイル名:" で始まるmarkdownブロック
  if (reports.length === 0) {
    reports = parseReportsWithFileNamePattern(generatedText);
  }

  // パターン3: セクション分割
  if (reports.length === 0) {
    reports = parseReportsBySectionSplit(generatedText);
  }

  // フォールバック: 全体を1ファイルとして保存
  if (reports.length === 0) {
    reports = [{
      fileName: `面接レポート_${getDateString()}.md`,
      content: generatedText
    }];
  }

  return reports;
}

/**
 * "# 出力ファイル名:" パターンでレポートをパース（markdownブロックなし）
 * @param {string} text
 * @returns {Array<{fileName: string, content: string}>}
 */
function parseReportsWithHeaderFileNamePattern(text) {
  const reports = [];
  // "# 出力ファイル名:" で分割
  const sections = text.split(/(?=^#\s*出力ファイル名:)/m);

  sections.forEach(section => {
    const headerMatch = section.match(/^#\s*出力ファイル名:\s*(.+\.md)\s*\n([\s\S]*)/m);
    if (headerMatch) {
      const fileName = headerMatch[1].trim();
      let content = headerMatch[2].trim();

      // markdownコードブロックで囲まれている場合は除去
      const codeBlockMatch = content.match(/^```(?:markdown)?\n([\s\S]*?)\n```$/);
      if (codeBlockMatch) {
        content = codeBlockMatch[1].trim();
      }

      reports.push({
        fileName: fileName,
        content: content
      });
    }
  });

  return reports;
}

/**
 * "出力ファイル名:" パターンでレポートをパース（markdownブロック形式）
 * @param {string} text
 * @returns {Array<{fileName: string, content: string}>}
 */
function parseReportsWithFileNamePattern(text) {
  const reports = [];
  const filePattern = /出力ファイル名:\s*(.+\.md)\s*\n```markdown\n([\s\S]*?)```/g;
  let match;

  while ((match = filePattern.exec(text)) !== null) {
    reports.push({
      fileName: match[1].trim(),
      content: match[2].trim()
    });
  }

  return reports;
}

/**
 * セクション分割でレポートをパース
 * @param {string} text
 * @returns {Array<{fileName: string, content: string}>}
 */
function parseReportsBySectionSplit(text) {
  const reports = [];
  const sections = text.split(/(?=# 面接官フィードバックレポート|# 面接サマリ)/);

  sections.forEach((section, index) => {
    if (!section.trim()) return;

    const fileName = generateFileNameFromSection(section, index);
    reports.push({
      fileName: fileName,
      content: section.trim()
    });
  });

  return reports;
}

/**
 * セクション内容からファイル名を生成
 * @param {string} section
 * @param {number} index
 * @returns {string}
 */
function generateFileNameFromSection(section, index) {
  if (section.includes('面接官フィードバックレポート')) {
    return generateFeedbackReportFileName(section, index);
  }

  if (section.includes('面接サマリ')) {
    return generateSummaryFileName(section);
  }

  return `レポート_${getDateString()}_${index}.md`;
}

/**
 * フィードバックレポートのファイル名を生成
 * @param {string} section
 * @param {number} index
 * @returns {string}
 */
function generateFeedbackReportFileName(section, index) {
  const emailMatch = section.match(/\*\*面接官 \(Email\)\*\*\s*\|\s*(.+?)\s*\|/);
  const dateMatch = section.match(/\*\*面接実施日時\*\*\s*\|\s*(\d{4})年(\d{1,2})月(\d{1,2})日/);

  const interviewer = emailMatch
    ? emailMatch[1].trim().replace(/\s+/g, '-').toLowerCase()
    : `interviewer-${index}`;
  const date = dateMatch
    ? `${dateMatch[1]}${dateMatch[2].padStart(2, '0')}${dateMatch[3].padStart(2, '0')}`
    : getDateString();

  return `面接フィードバックレポート_${date}_${interviewer}.md`;
}

/**
 * サマリのファイル名を生成
 * @param {string} section
 * @returns {string}
 */
function generateSummaryFileName(section) {
  const candidateMatch = section.match(/\|\s*候補者\s*\|\s*(.+?)\s*\|/);
  const dateMatch = section.match(/\|\s*面接日時\s*\|\s*(\d{4})年(\d{1,2})月(\d{1,2})日/);

  const candidate = candidateMatch
    ? candidateMatch[1].trim().replace(/\s+/g, '-')
    : 'unknown';
  const date = dateMatch
    ? `${dateMatch[1]}${dateMatch[2].padStart(2, '0')}${dateMatch[3].padStart(2, '0')}`
    : getDateString();

  return `面接サマリ_${date}_${candidate}.md`;
}
