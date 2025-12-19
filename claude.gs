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
    });

    return parseClassificationResponse(response);
  } catch (e) {
    console.warn(`分類処理エラー: ${e.message}`);
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
  });

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
 * Claude APIを呼び出す共通関数
 * @param {Object} params
 * @returns {string} レスポンステキスト
 */
function callClaudeApi(params) {
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

  const response = UrlFetchApp.fetch(CLAUDE_API_URL, options);
  const responseCode = response.getResponseCode();
  const responseBody = JSON.parse(response.getContentText());

  if (responseCode !== 200) {
    throw new Error(`Claude API エラー: ${responseCode} - ${JSON.stringify(responseBody)}`);
  }

  return responseBody.content[0].text.trim();
}

/**
 * Claude APIの出力を個別のレポートファイルに分割
 * @param {string} generatedText
 * @returns {Array<{fileName: string, content: string}>}
 */
function parseGeneratedReports(generatedText) {
  // パターン1: "出力ファイル名:" で始まるmarkdownブロック
  let reports = parseReportsWithFileNamePattern(generatedText);

  // パターン2: セクション分割
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
 * "出力ファイル名:" パターンでレポートをパース
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
