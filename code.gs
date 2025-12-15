/**
 * 面接フィードバックレポート自動生成システム
 * Google Apps Script
 *
 * 【仕様】
 * - 入力: 「共有アイテム」から「面接」「面談」を含むGoogleドキュメントを検索
 * - 出力: 共有ドライブの /面接/output フォルダにMDファイルを保存 + Slack通知
 * - 処理済み管理: スプレッドシートにファイルIDを記録（元ファイルは移動しない）
 */

// ============================================
// 設定
// ============================================
const CONFIG = {
  // Google Drive フォルダID（共有ドライブ /面接 配下）
  OUTPUT_FOLDER_ID: '1f0yqhGYY2N1wc1XIaC6VBTMJ6MzGX8OF',
  LOG_SPREADSHEET_ID: '1aP6dEuBCqtA_09_gexf_2fDld-qYBGGT9Zqc_bfinx0',
  CONFIG_FOLDER_ID: '1ubMb7SL-2_rxxCvmSksHJHRrCY7TRH7t',  // /面接/input（設定ファイル格納）

  // 設定ファイル名
  PROMPT_FILE: 'feedbackprompt.md',
  GUIDELINE_FILE: 'evaluationguideline.md',
  TEMPLATE_FILE: 'template.md',

  // ファイル名フィルタ（これらの文字列を含むファイルのみ処理）
  FILENAME_FILTERS: ['面接', '面談'],

  // Claude API設定
  CLAUDE_MODEL: 'claude-sonnet-4-20250514',
  CLAUDE_MAX_TOKENS: 16000,

  // 処理設定
  LOCK_TIMEOUT_MS: 300000,  // 5分
};

// ============================================
// メイン処理
// ============================================

/**
 * メインエントリポイント（トリガーから呼び出される）
 */
function main() {
  const startTime = new Date();
  let file = null;

  // 排他ロック取得
  const lock = LockService.getScriptLock();
  const hasLock = lock.tryLock(CONFIG.LOCK_TIMEOUT_MS);

  if (!hasLock) {
    console.log('別のプロセスが実行中のためスキップ');
    return;
  }

  try {
    // 処理済みファイルIDリストを取得
    const processedFileIds = getProcessedFileIds();

    // 未処理ドキュメントを取得（共有アイテムから検索）
    file = getNextDocument(processedFileIds);

    if (!file) {
      console.log('処理対象のドキュメントがありません');
      return;
    }

    console.log(`処理開始: ${file.getName()}`);

    // ドキュメント内容を読み取り（Export URL使用）
    const content = getDocumentContentByExport(file.getId());

    if (!content || content.trim().length === 0) {
      throw new Error('ドキュメントの内容が空です');
    }

    console.log(`文字数: ${content.length}`);

    // 採用面接かどうかを判定
    const classification = classifyInterview(content);
    if (!classification.isRecruitmentInterview) {
      console.log(`スキップ: ${classification.reason}`);
      const processingTime = (new Date() - startTime) / 1000;
      logProcessing(file, 'SKIPPED', classification.reason, processingTime);
      return;
    }
    console.log(`採用面接と判定: ${classification.reason}`);

    // Claude APIでレポート生成
    const reports = generateFeedback(content);

    // MDファイルをGoogle Driveに保存
    const savedFiles = saveMdFilesToGoogleDrive(reports);

    // SlackにMDファイルをアップロード
    uploadFilesToSlack(savedFiles);

    // 処理ログを記録（処理済みとしてマーク）
    const processingTime = (new Date() - startTime) / 1000;
    logProcessing(file, 'SUCCESS', null, processingTime);

    console.log(`処理完了: ${file.getName()} (${processingTime}秒)`);

  } catch (error) {
    console.error(`エラー発生: ${error.message}`);

    // エラーログを記録
    const processingTime = (new Date() - startTime) / 1000;
    if (file) {
      logProcessing(file, 'FAILED', error.message, processingTime);
    }

    // エラーログはスプレッドシートに記録されるため、Slack通知は行わない

  } finally {
    lock.releaseLock();
  }
}

// ============================================
// ドキュメント取得（共有アイテムから検索）
// ============================================

/**
 * 共有アイテムから未処理ドキュメントを1件取得
 * ファイル名に「面接」または「面談」を含むもののみ対象
 */
function getNextDocument(processedFileIds) {
  const query = "sharedWithMe=true and mimeType='application/vnd.google-apps.document' and trashed=false";
  const files = DriveApp.searchFiles(query);

  while (files.hasNext()) {
    const file = files.next();
    const fileName = file.getName();
    const fileId = file.getId();

    // 処理済みファイルはスキップ
    if (processedFileIds.includes(fileId)) {
      continue;
    }

    // ファイル名フィルタリング
    const matchesFilter = CONFIG.FILENAME_FILTERS.some(filter =>
      fileName.includes(filter)
    );

    if (matchesFilter) {
      return file;
    }
  }

  return null;
}

/**
 * 処理済みファイルIDリストをスプレッドシートから取得
 */
function getProcessedFileIds() {
  try {
    const spreadsheet = SpreadsheetApp.openById(CONFIG.LOG_SPREADSHEET_ID);
    const sheet = spreadsheet.getActiveSheet();
    const data = sheet.getDataRange().getValues();

    // B列（インデックス1）がファイルID
    const fileIds = data.slice(1).map(row => row[1]).filter(id => id);
    return fileIds;
  } catch (e) {
    console.warn(`処理済みリスト取得失敗: ${e.message}`);
    return [];
  }
}

/**
 * Googleドキュメントの内容をExport URLでテキスト取得
 * すべてのタブの内容を結合して返す
 */
function getDocumentContentByExport(fileId) {
  // まずタブ一覧を取得
  const tabs = getDocumentTabs(fileId);

  if (tabs.length === 0) {
    // タブがない場合は従来の方法で取得
    return getDocumentTabContent(fileId, null);
  }

  // 各タブの内容を結合
  const contents = [];
  tabs.forEach(tab => {
    const content = getDocumentTabContent(fileId, tab.id);
    if (content && content.trim()) {
      contents.push(`=== タブ: ${tab.title} ===\n${content}`);
    }
  });

  return contents.join('\n\n');
}

/**
 * ドキュメントのタブ一覧を取得
 */
function getDocumentTabs(fileId) {
  try {
    const url = `https://docs.googleapis.com/v1/documents/${fileId}?fields=tabs(tabProperties)`;
    const response = UrlFetchApp.fetch(url, {
      headers: {
        Authorization: 'Bearer ' + ScriptApp.getOAuthToken()
      },
      muteHttpExceptions: true
    });

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
 */
function getDocumentTabContent(fileId, tabId) {
  let url = `https://docs.google.com/document/d/${fileId}/export?format=txt`;
  if (tabId) {
    url += `&tab=${tabId}`;
  }

  const response = UrlFetchApp.fetch(url, {
    headers: {
      Authorization: 'Bearer ' + ScriptApp.getOAuthToken()
    },
    muteHttpExceptions: true
  });

  const responseCode = response.getResponseCode();
  if (responseCode !== 200) {
    throw new Error(`ドキュメント取得失敗: HTTP ${responseCode}`);
  }

  return response.getContentText();
}

// ============================================
// Claude API連携
// ============================================

/**
 * 面接内容が採用面接/カジュアル面談かどうかを判定
 * @param {string} content - ドキュメント内容
 * @returns {Object} { isRecruitmentInterview: boolean, reason: string }
 */
function classifyInterview(content) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('CLAUDE_API_KEY');

  if (!apiKey) {
    throw new Error('CLAUDE_API_KEY が設定されていません');
  }

  // 内容の最初の部分だけを使用（コスト削減）
  const contentPreview = content.substring(0, 5000);

  const systemPrompt = `あなたは面接内容を分類するアシスタントです。
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

  const payload = {
    model: 'claude-3-5-haiku-20241022',
    max_tokens: 100,
    system: systemPrompt,
    messages: [
      {
        role: 'user',
        content: `以下のテキストを分類してください：\n\n${contentPreview}`
      }
    ]
  };

  const options = {
    method: 'post',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  try {
    const response = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', options);
    const responseCode = response.getResponseCode();

    if (responseCode !== 200) {
      console.warn(`分類API呼び出し失敗: HTTP ${responseCode}`);
      // エラー時は処理を続行（採用面接として扱う）
      return { isRecruitmentInterview: true, reason: '分類エラー - デフォルト処理' };
    }

    const result = JSON.parse(response.getContentText());
    const responseText = result.content[0].text.trim();

    // JSONをパース
    const classification = JSON.parse(responseText);
    return {
      isRecruitmentInterview: classification.isRecruitmentInterview === true,
      reason: classification.reason || '理由不明'
    };
  } catch (e) {
    console.warn(`分類処理エラー: ${e.message}`);
    // エラー時は処理を続行（採用面接として扱う）
    return { isRecruitmentInterview: true, reason: '分類エラー - デフォルト処理' };
  }
}

/**
 * Claude APIを呼び出してフィードバックレポートを生成
 */
function generateFeedback(transcriptContent) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('CLAUDE_API_KEY');

  if (!apiKey) {
    throw new Error('CLAUDE_API_KEY が設定されていません');
  }

  const systemPrompt = getSystemPrompt();

  // 文字起こしから話者を抽出し、過去フィードバックを収集
  const speakers = extractSpeakersFromTranscript(transcriptContent);
  const currentDate = getDateString();
  const pastFeedbacksBySpeaker = collectPastFeedbacksForSpeakers(speakers, currentDate);

  // 過去フィードバックがあれば比較コンテキストを構築
  const comparisonContext = buildAllComparisonContexts(pastFeedbacksBySpeaker);
  const hasPastFeedbacks = Object.keys(pastFeedbacksBySpeaker).length > 0;

  if (hasPastFeedbacks) {
    console.log(`過去フィードバック対象面接官: ${Object.keys(pastFeedbacksBySpeaker).join(', ')}`);
  }

  // ユーザープロンプトを構築（過去フィードバック情報を含む）
  let userContent = `以下は面接の文字起こしデータです。指示に従ってフィードバックレポートと面接サマリを生成してください。\n\n---\n\n${transcriptContent}`;

  if (comparisonContext) {
    userContent += `\n\n${comparisonContext}`;
  }

  const payload = {
    model: CONFIG.CLAUDE_MODEL,
    max_tokens: CONFIG.CLAUDE_MAX_TOKENS,
    system: systemPrompt,
    messages: [
      {
        role: 'user',
        content: userContent
      }
    ]
  };

  const options = {
    method: 'post',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  const response = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', options);
  const responseCode = response.getResponseCode();
  const responseBody = JSON.parse(response.getContentText());

  if (responseCode !== 200) {
    throw new Error(`Claude API エラー: ${responseCode} - ${JSON.stringify(responseBody)}`);
  }

  // レスポンスからテキストを抽出
  const generatedText = responseBody.content[0].text;

  // 生成されたテキストを個別のレポートに分割
  return parseGeneratedReports(generatedText);
}

/**
 * Claude APIの出力を個別のレポートファイルに分割
 */
function parseGeneratedReports(generatedText) {
  const reports = [];

  // "出力ファイル名:" で始まるmarkdownブロックを検出
  const filePattern = /出力ファイル名:\s*(.+\.md)\s*\n```markdown\n([\s\S]*?)```/g;
  let match;

  while ((match = filePattern.exec(generatedText)) !== null) {
    reports.push({
      fileName: match[1].trim(),
      content: match[2].trim()
    });
  }

  // パターンにマッチしなかった場合、別のパターンを試す
  if (reports.length === 0) {
    const sections = generatedText.split(/(?=# 面接官フィードバックレポート|# 面接サマリ)/);

    sections.forEach((section, index) => {
      if (section.trim()) {
        let fileName;
        if (section.includes('面接官フィードバックレポート')) {
          const emailMatch = section.match(/\*\*面接官 \(Email\)\*\*\s*\|\s*(.+?)\s*\|/);
          const dateMatch = section.match(/\*\*面接実施日時\*\*\s*\|\s*(\d{4})年(\d{1,2})月(\d{1,2})日/);

          const interviewer = emailMatch ? emailMatch[1].trim().replace(/\s+/g, '-').toLowerCase() : `interviewer-${index}`;
          const date = dateMatch ? `${dateMatch[1]}${dateMatch[2].padStart(2, '0')}${dateMatch[3].padStart(2, '0')}` : getDateString();

          fileName = `面接フィードバックレポート_${date}_${interviewer}.md`;
        } else if (section.includes('面接サマリ')) {
          const candidateMatch = section.match(/\|\s*候補者\s*\|\s*(.+?)\s*\|/);
          const dateMatch = section.match(/\|\s*面接日時\s*\|\s*(\d{4})年(\d{1,2})月(\d{1,2})日/);

          const candidate = candidateMatch ? candidateMatch[1].trim().replace(/\s+/g, '-') : 'unknown';
          const date = dateMatch ? `${dateMatch[1]}${dateMatch[2].padStart(2, '0')}${dateMatch[3].padStart(2, '0')}` : getDateString();

          fileName = `面接サマリ_${date}_${candidate}.md`;
        } else {
          fileName = `レポート_${getDateString()}_${index}.md`;
        }

        reports.push({
          fileName: fileName,
          content: section.trim()
        });
      }
    });
  }

  if (reports.length === 0) {
    // フォールバック: 全体を1つのファイルとして保存
    reports.push({
      fileName: `面接レポート_${getDateString()}.md`,
      content: generatedText
    });
  }

  return reports;
}

// ============================================
// Google Drive操作
// ============================================

/**
 * MDファイルを共有ドライブの/面接/outputフォルダに保存
 */
function saveMdFilesToGoogleDrive(reports) {
  const outputFolder = DriveApp.getFolderById(CONFIG.OUTPUT_FOLDER_ID);
  const savedFiles = [];

  reports.forEach(report => {
    const blob = Utilities.newBlob(report.content, 'text/markdown', report.fileName);
    const file = outputFolder.createFile(blob);

    savedFiles.push({
      id: file.getId(),
      name: report.fileName,
      content: report.content,
      url: file.getUrl()
    });

    console.log(`ファイル保存: ${report.fileName}`);
  });

  return savedFiles;
}

// ============================================
// Slack連携
// ============================================

/**
 * レポートから面接メタデータを抽出
 */
function extractInterviewMetadata(files) {
  const metadata = {
    date: null,
    candidate: null,
    interviewers: []
  };

  files.forEach(file => {
    const content = file.content;

    // 面接サマリから候補者名と日時を抽出
    if (file.name.includes('サマリ') || content.includes('# 面接サマリ')) {
      // 候補者名を抽出
      const candidateMatch = content.match(/\|\s*候補者\s*\|\s*(.+?)\s*\|/);
      if (candidateMatch) {
        metadata.candidate = candidateMatch[1].trim();
      }

      // 面接日時を抽出
      const dateMatch = content.match(/\|\s*面接日時\s*\|\s*(.+?)\s*\|/);
      if (dateMatch) {
        metadata.date = dateMatch[1].trim();
      }
    }

    // フィードバックレポートから面接官情報を抽出
    if (file.name.includes('フィードバックレポート') || content.includes('# 面接官フィードバックレポート')) {
      // 面接官名とメールアドレスを抽出
      const interviewerMatch = content.match(/\*\*面接官 \(Email\)\*\*\s*\|\s*(.+?)\s*\|/);
      if (interviewerMatch) {
        const interviewerInfo = interviewerMatch[1].trim();
        // メールアドレス形式かどうかチェック
        const emailMatch = interviewerInfo.match(/([^\s]+@[^\s]+)/);
        metadata.interviewers.push({
          name: interviewerInfo.replace(/@[^\s]+/, '').trim() || interviewerInfo,
          email: emailMatch ? emailMatch[1] : null
        });
      }
    }
  });

  // デフォルト値を設定
  if (!metadata.date) {
    metadata.date = new Date().toLocaleDateString('ja-JP');
  }
  if (!metadata.candidate) {
    metadata.candidate = '不明';
  }

  return metadata;
}

/**
 * メールアドレスからSlackユーザーIDを取得
 */
function getSlackUserIdByEmail(email, botToken) {
  if (!email) return null;

  try {
    const response = UrlFetchApp.fetch(
      `https://slack.com/api/users.lookupByEmail?email=${encodeURIComponent(email)}`,
      {
        method: 'get',
        headers: {
          'Authorization': `Bearer ${botToken}`
        },
        muteHttpExceptions: true
      }
    );

    const result = JSON.parse(response.getContentText());
    if (result.ok && result.user) {
      return result.user.id;
    }
  } catch (e) {
    console.warn(`Slackユーザー検索エラー (${email}): ${e.message}`);
  }

  return null;
}

/**
 * Slackワークスペースの全ユーザーを取得（キャッシュ付き）
 */
let slackUsersCache = null;

function getAllSlackUsers(botToken) {
  // キャッシュがあれば返す
  if (slackUsersCache) {
    return slackUsersCache;
  }

  const allUsers = [];
  let cursor = null;

  try {
    do {
      let url = 'https://slack.com/api/users.list?limit=200';
      if (cursor) {
        url += `&cursor=${encodeURIComponent(cursor)}`;
      }

      const response = UrlFetchApp.fetch(url, {
        method: 'get',
        headers: {
          'Authorization': `Bearer ${botToken}`
        },
        muteHttpExceptions: true
      });

      const result = JSON.parse(response.getContentText());
      if (!result.ok) {
        console.warn(`Slackユーザー一覧取得失敗: ${result.error}`);
        break;
      }

      // アクティブな人間ユーザーのみ追加
      result.members.forEach(user => {
        if (!user.deleted && !user.is_bot && user.id !== 'USLACKBOT') {
          allUsers.push({
            id: user.id,
            name: user.name,
            realName: user.real_name || '',
            displayName: user.profile?.display_name || ''
          });
        }
      });

      cursor = result.response_metadata?.next_cursor;
    } while (cursor);

    console.log(`Slackユーザー取得完了: ${allUsers.length}名`);
    slackUsersCache = allUsers;
    return allUsers;
  } catch (e) {
    console.warn(`Slackユーザー一覧取得エラー: ${e.message}`);
    return [];
  }
}

/**
 * 名前からSlackユーザーIDを検索
 */
function getSlackUserIdByName(name, botToken) {
  if (!name) return null;

  const users = getAllSlackUsers(botToken);
  const normalizedName = name.toLowerCase().replace(/\s+/g, '');

  // 完全一致を優先、部分一致をフォールバック
  for (const user of users) {
    const realNameNorm = user.realName.toLowerCase().replace(/\s+/g, '');
    const displayNameNorm = user.displayName.toLowerCase().replace(/\s+/g, '');
    const userNameNorm = user.name.toLowerCase();

    // 完全一致チェック
    if (realNameNorm === normalizedName ||
        displayNameNorm === normalizedName ||
        userNameNorm === normalizedName) {
      console.log(`名前一致: ${name} -> ${user.realName} (${user.id})`);
      return user.id;
    }
  }

  // 部分一致チェック（名前が含まれているか）
  // 最低3文字以上の一致が必要
  const MIN_MATCH_LENGTH = 3;
  for (const user of users) {
    const realNameNorm = user.realName.toLowerCase().replace(/\s+/g, '');
    const displayNameNorm = user.displayName.toLowerCase().replace(/\s+/g, '');

    // 空文字列や短すぎる文字列はスキップ
    if (realNameNorm.length >= MIN_MATCH_LENGTH) {
      if (realNameNorm.includes(normalizedName) || normalizedName.includes(realNameNorm)) {
        console.log(`名前部分一致: ${name} -> ${user.realName} (${user.id})`);
        return user.id;
      }
    }
    if (displayNameNorm.length >= MIN_MATCH_LENGTH) {
      if (displayNameNorm.includes(normalizedName) || normalizedName.includes(displayNameNorm)) {
        console.log(`名前部分一致: ${name} -> ${user.realName} (${user.id})`);
        return user.id;
      }
    }
  }

  console.log(`名前検索失敗: ${name}`);
  return null;
}

/**
 * Slackチャンネルのメンバー一覧を取得（キャッシュ付き）
 */
let channelMembersCache = null;

function getChannelMembers(channelId, botToken) {
  // キャッシュがあれば返す
  if (channelMembersCache) {
    return channelMembersCache;
  }

  const members = [];
  let cursor = null;

  try {
    do {
      let url = `https://slack.com/api/conversations.members?channel=${channelId}&limit=200`;
      if (cursor) {
        url += `&cursor=${encodeURIComponent(cursor)}`;
      }

      const response = UrlFetchApp.fetch(url, {
        method: 'get',
        headers: {
          'Authorization': `Bearer ${botToken}`
        },
        muteHttpExceptions: true
      });

      const result = JSON.parse(response.getContentText());
      if (!result.ok) {
        console.warn(`チャンネルメンバー取得失敗: ${result.error}`);
        return null;
      }

      members.push(...result.members);
      cursor = result.response_metadata?.next_cursor;
    } while (cursor);

    console.log(`チャンネルメンバー取得完了: ${members.length}名`);
    channelMembersCache = members;
    return members;
  } catch (e) {
    console.warn(`チャンネルメンバー取得エラー: ${e.message}`);
    return null;
  }
}

/**
 * 面接官のメンション/名前表示をフォーマット
 * チャンネルメンバーでない場合はメンションせず名前表示
 */
function formatInterviewerMentions(interviewers, botToken, channelId) {
  if (!interviewers || interviewers.length === 0) {
    return '不明';
  }

  // チャンネルメンバーを取得
  const channelMembers = channelId ? getChannelMembers(channelId, botToken) : null;

  return interviewers.map(interviewer => {
    let userId = null;

    // 1. メールアドレスがあればSlackユーザーを検索
    if (interviewer.email) {
      userId = getSlackUserIdByEmail(interviewer.email, botToken);
    }

    // 2. 名前でSlackユーザーを検索
    if (!userId && interviewer.name) {
      userId = getSlackUserIdByName(interviewer.name, botToken);
    }

    // 3. ユーザーが見つかった場合、チャンネルメンバーかどうか確認
    if (userId) {
      if (channelMembers && !channelMembers.includes(userId)) {
        // チャンネルメンバーでない場合は名前表示（メンションしない）
        console.log(`チャンネル外ユーザー: ${interviewer.name} (${userId}) - メンションスキップ`);
        return `*${interviewer.name || interviewer.email}*`;
      }
      return `<@${userId}>`;
    }

    // 4. 見つからなければ名前を太字で表示
    return `*${interviewer.name || interviewer.email || '不明'}*`;
  }).join(', ');
}

/**
 * Slack親メッセージを投稿してthread_tsを取得
 */
function postSlackSummaryMessage(metadata, botToken, channelId) {
  const interviewerText = formatInterviewerMentions(metadata.interviewers, botToken, channelId);

  const message = `📋 *面接フィードバックレポート生成完了*\n\n` +
                  `📅 *面接日時:* ${metadata.date}\n` +
                  `👤 *候補者:* ${metadata.candidate}\n` +
                  `🎤 *面接官:* ${interviewerText}`;

  const response = UrlFetchApp.fetch('https://slack.com/api/chat.postMessage', {
    method: 'post',
    headers: {
      'Authorization': `Bearer ${botToken}`,
      'Content-Type': 'application/json'
    },
    payload: JSON.stringify({
      channel: channelId,
      text: message
    }),
    muteHttpExceptions: true
  });

  const result = JSON.parse(response.getContentText());
  if (!result.ok) {
    console.error(`Slack親メッセージ投稿失敗: ${JSON.stringify(result)}`);
    return null;
  }

  console.log(`Slack親メッセージ投稿完了 (ts: ${result.ts})`);
  return result.ts;
}

/**
 * MDファイルをSlackにアップロード（スレッド形式）
 */
function uploadFilesToSlack(files) {
  const botToken = PropertiesService.getScriptProperties().getProperty('SLACK_BOT_TOKEN');
  const channelId = PropertiesService.getScriptProperties().getProperty('SLACK_CHANNEL_ID');

  if (!botToken || !channelId) {
    console.warn('Slack設定が不完全です（SLACK_BOT_TOKEN または SLACK_CHANNEL_ID が未設定）');
    return;
  }

  // メタデータを抽出
  const metadata = extractInterviewMetadata(files);

  // 親メッセージを投稿してthread_tsを取得
  const threadTs = postSlackSummaryMessage(metadata, botToken, channelId);

  // 各ファイルをスレッドに返信としてアップロード
  files.forEach(file => {
    uploadFileToSlack(file, botToken, channelId, threadTs);
  });
}

/**
 * 単一ファイルをSlackにアップロード
 * @param {Object} file - ファイル情報 {name, content}
 * @param {string} botToken - Slack Bot Token
 * @param {string} channelId - チャンネルID
 * @param {string|null} threadTs - スレッドのタイムスタンプ（スレッド返信の場合）
 */
function uploadFileToSlack(file, botToken, channelId, threadTs = null) {
  // files.getUploadURLExternal を使用（新しいSlack API）
  const uploadUrlResponse = getSlackUploadUrl(file.name, file.content, botToken);

  if (!uploadUrlResponse.ok) {
    console.error(`Slack upload URL取得失敗: ${JSON.stringify(uploadUrlResponse)}`);
    return;
  }

  // ファイルをアップロード
  const uploadResponse = UrlFetchApp.fetch(uploadUrlResponse.upload_url, {
    method: 'post',
    payload: file.content,
    headers: {
      'Content-Type': 'text/markdown'
    },
    muteHttpExceptions: true
  });

  if (uploadResponse.getResponseCode() !== 200) {
    console.error(`Slack ファイルアップロード失敗: ${uploadResponse.getContentText()}`);
    return;
  }

  // アップロード完了をSlackに通知（スレッド返信の場合はthreadTsを渡す）
  completeSlackUpload(uploadUrlResponse.file_id, channelId, file.name, botToken, threadTs);

  console.log(`Slackアップロード完了: ${file.name}${threadTs ? ' (スレッド返信)' : ''}`);
}

/**
 * Slack upload URLを取得
 */
function getSlackUploadUrl(filename, content, botToken) {
  // UTF-8バイト数を正確に計算
  const blob = Utilities.newBlob(content, 'text/plain', filename);
  const byteLength = blob.getBytes().length;

  const response = UrlFetchApp.fetch('https://slack.com/api/files.getUploadURLExternal', {
    method: 'post',
    headers: {
      'Authorization': `Bearer ${botToken}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    payload: `filename=${encodeURIComponent(filename)}&length=${byteLength}`,
    muteHttpExceptions: true
  });

  return JSON.parse(response.getContentText());
}

/**
 * Slackアップロード完了通知
 * @param {string} fileId - アップロードされたファイルID
 * @param {string} channelId - チャンネルID
 * @param {string} title - ファイルタイトル
 * @param {string} botToken - Slack Bot Token
 * @param {string|null} threadTs - スレッドのタイムスタンプ（スレッド返信の場合）
 */
function completeSlackUpload(fileId, channelId, title, botToken, threadTs = null) {
  const payload = {
    files: [{ id: fileId, title: title }],
    channel_id: channelId
  };

  // スレッド返信の場合はthread_tsを追加
  if (threadTs) {
    payload.thread_ts = threadTs;
  }

  const response = UrlFetchApp.fetch('https://slack.com/api/files.completeUploadExternal', {
    method: 'post',
    headers: {
      'Authorization': `Bearer ${botToken}`,
      'Content-Type': 'application/json'
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const result = JSON.parse(response.getContentText());
  if (!result.ok) {
    console.error(`Slack complete upload 失敗: ${JSON.stringify(result)}`);
  }
}

/**
 * エラー通知をSlackに送信
 */
function sendErrorNotification(file, error) {
  const botToken = PropertiesService.getScriptProperties().getProperty('SLACK_BOT_TOKEN');
  const channelId = PropertiesService.getScriptProperties().getProperty('SLACK_CHANNEL_ID');

  if (!botToken || !channelId) {
    return;
  }

  const fileName = file ? file.getName() : '不明';
  const message = `⚠️ *面接フィードバックレポート生成エラー*\n\n` +
                  `*ドキュメント:* ${fileName}\n` +
                  `*エラー内容:* ${error.message}\n` +
                  `*発生日時:* ${new Date().toLocaleString('ja-JP')}`;

  const response = UrlFetchApp.fetch('https://slack.com/api/chat.postMessage', {
    method: 'post',
    headers: {
      'Authorization': `Bearer ${botToken}`,
      'Content-Type': 'application/json'
    },
    payload: JSON.stringify({
      channel: channelId,
      text: message
    }),
    muteHttpExceptions: true
  });

  const result = JSON.parse(response.getContentText());
  if (!result.ok) {
    console.error(`Slack通知失敗: ${JSON.stringify(result)}`);
  }
}

// ============================================
// ログ記録
// ============================================

/**
 * 処理ログをスプレッドシートに記録
 * ※このログが処理済みファイルの管理も兼ねる
 */
function logProcessing(file, status, errorMessage, processingTime) {
  try {
    const spreadsheet = SpreadsheetApp.openById(CONFIG.LOG_SPREADSHEET_ID);
    const sheet = spreadsheet.getActiveSheet();

    // ヘッダーがなければ追加
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(['処理日時', 'ファイルID', 'ファイル名', 'ステータス', 'エラーメッセージ', '処理時間(秒)']);
    }

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

// ============================================
// 設定ファイル読み込み
// ============================================

/**
 * 指定フォルダ内のMDファイルを名前で検索して内容を取得
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
 */
function getEvaluationGuidelines() {
  return getMdFileContent(CONFIG.CONFIG_FOLDER_ID, CONFIG.GUIDELINE_FILE);
}

/**
 * レポート雛形を外部ファイルから取得
 */
function getReportTemplate() {
  return getMdFileContent(CONFIG.CONFIG_FOLDER_ID, CONFIG.TEMPLATE_FILE);
}

/**
 * 生成指示プロンプトを外部ファイルから取得
 */
function getPromptInstructions() {
  return getMdFileContent(CONFIG.CONFIG_FOLDER_ID, CONFIG.PROMPT_FILE);
}

// ============================================
// 過去フィードバック比較機能
// ============================================

/**
 * 同一面接官の過去フィードバックレポートを取得
 * @param {string} interviewerName - 面接官名
 * @param {string} excludeDate - 除外する日付（YYYYMMDD形式、今回の面接日）
 * @param {number} limit - 取得件数上限（デフォルト3件）
 * @returns {Array} 過去のフィードバックレポート [{date, content}, ...]
 */
function getPreviousFeedbacksByInterviewer(interviewerName, excludeDate, limit = 3) {
  if (!interviewerName) {
    return [];
  }

  const folder = DriveApp.getFolderById(CONFIG.OUTPUT_FOLDER_ID);
  const files = folder.getFiles();
  const pastReports = [];

  // 面接官名を正規化（スペース除去、小文字化）
  const normalizedTargetName = interviewerName.toLowerCase().replace(/\s+/g, '').replace(/-/g, '');

  while (files.hasNext()) {
    const file = files.next();
    const fileName = file.getName();

    // 面接フィードバックレポートのみ対象
    if (!fileName.startsWith('面接フィードバックレポート_')) {
      continue;
    }

    // ファイル名パターン: 面接フィードバックレポート_{YYYYMMDD}_{interviewer}.md
    const match = fileName.match(/^面接フィードバックレポート_(\d{8})_(.+)\.md$/);
    if (!match) {
      continue;
    }

    const fileDate = match[1];
    const fileInterviewer = match[2];

    // 今回の面接日は除外
    if (fileDate === excludeDate) {
      continue;
    }

    // 面接官名を正規化して比較
    const normalizedFileInterviewer = fileInterviewer.toLowerCase().replace(/\s+/g, '').replace(/-/g, '');

    if (normalizedFileInterviewer === normalizedTargetName) {
      pastReports.push({
        date: fileDate,
        content: file.getBlob().getDataAsString('UTF-8'),
        fileName: fileName
      });
    }
  }

  // 日付降順でソート（新しい順）
  pastReports.sort((a, b) => b.date.localeCompare(a.date));

  // 上限件数まで返す
  const result = pastReports.slice(0, limit);
  console.log(`過去フィードバック取得: ${interviewerName} -> ${result.length}件`);

  return result;
}

/**
 * 過去フィードバック情報をプロンプト用コンテキストに変換
 * @param {Array} pastFeedbacks - 過去のフィードバックレポート配列
 * @returns {string} プロンプト用コンテキスト文字列
 */
function buildComparisonContext(pastFeedbacks) {
  if (!pastFeedbacks || pastFeedbacks.length === 0) {
    return '';
  }

  const feedbackSections = pastFeedbacks.map((fb, i) => {
    // 日付をYYYYMMDD -> YYYY年MM月DD日形式に変換
    const formattedDate = `${fb.date.substring(0, 4)}年${fb.date.substring(4, 6)}月${fb.date.substring(6, 8)}日`;

    return `### ${i + 1}件前のフィードバック（${formattedDate}）
${fb.content}`;
  }).join('\n\n');

  return `
---

## 同一面接官の過去フィードバック履歴（直近${pastFeedbacks.length}件）

以下は同じ面接官が過去に受けたフィードバックレポートです。今回のフィードバックと比較して、改善点や継続課題を分析してください。

${feedbackSections}

---

【重要】上記の過去フィードバックがある場合は、今回の面接フィードバックレポートの末尾に以下の形式で比較セクションを追加してください：

## 過去フィードバックとの比較（直近${pastFeedbacks.length}件）

### 評価項目の推移

| 評価項目 | 前回 | 今回 | 変化 |
|:--|:--|:--|:--|
| 質問力（深掘り） | △/○/◎ | △/○/◎ | ↑改善/→維持/↓後退 |
| 傾聴・共感力 | △/○/◎ | △/○/◎ | ↑改善/→維持/↓後退 |
| アトラクト力 | △/○/◎ | △/○/◎ | ↑改善/→維持/↓後退 |
| 時間配分 | △/○/◎ | △/○/◎ | ↑改善/→維持/↓後退 |

### 改善が見られた点
- （過去と比較して改善した具体的な点を記載）

### 継続して取り組むべき課題
- （過去から継続している課題を記載）

### 総評
（面接官としての成長や今後の期待について1〜2文で記載）
`;
}

/**
 * レポートから面接官名と日付を抽出
 * @param {string} content - レポート内容
 * @returns {Object} {interviewerName, date}
 */
function extractInterviewerInfoFromReport(content) {
  const result = {
    interviewerName: null,
    date: null
  };

  // 面接官名を抽出（Email形式の場合も対応）
  const interviewerMatch = content.match(/\*\*面接官 \(Email\)\*\*\s*\|\s*(.+?)\s*\|/);
  if (interviewerMatch) {
    result.interviewerName = interviewerMatch[1].trim().replace(/\s+/g, '-').toLowerCase();
  }

  // 面接日時を抽出
  const dateMatch = content.match(/\*\*面接実施日時\*\*\s*\|\s*(\d{4})年(\d{1,2})月(\d{1,2})日/);
  if (dateMatch) {
    result.date = `${dateMatch[1]}${dateMatch[2].padStart(2, '0')}${dateMatch[3].padStart(2, '0')}`;
  }

  return result;
}

/**
 * 文字起こしから話者名を抽出
 * Google Meetの文字起こし形式: "話者名: 発言内容" または "話者名\n発言内容"
 * @param {string} transcript - 文字起こしテキスト
 * @returns {Array} ユニークな話者名の配列
 */
function extractSpeakersFromTranscript(transcript) {
  const speakers = new Set();

  // パターン1: "名前:" で始まる行
  const pattern1 = /^([^\n:：]+)[：:]\s*/gm;
  let match;

  while ((match = pattern1.exec(transcript)) !== null) {
    const name = match[1].trim();
    // 短すぎる名前や数字のみの名前は除外
    if (name.length >= 2 && !/^\d+$/.test(name) && !/^(タブ|===)/.test(name)) {
      speakers.add(name);
    }
  }

  // パターン2: 参加者セクションから抽出（「メモ」タブに記載されている場合）
  const participantPattern = /参加者[：:]\s*([^\n]+)/g;
  while ((match = participantPattern.exec(transcript)) !== null) {
    const participantList = match[1].split(/[,、]/);
    participantList.forEach(p => {
      const name = p.trim();
      if (name.length >= 2) {
        speakers.add(name);
      }
    });
  }

  console.log(`話者抽出: ${Array.from(speakers).join(', ')}`);
  return Array.from(speakers);
}

/**
 * 全話者の過去フィードバックを収集
 * @param {Array} speakers - 話者名の配列
 * @param {string} currentDate - 今回の面接日（YYYYMMDD形式）
 * @returns {Object} 話者名をキー、過去フィードバック配列を値とするオブジェクト
 */
function collectPastFeedbacksForSpeakers(speakers, currentDate) {
  const result = {};

  speakers.forEach(speaker => {
    const pastFeedbacks = getPreviousFeedbacksByInterviewer(speaker, currentDate);
    if (pastFeedbacks.length > 0) {
      result[speaker] = pastFeedbacks;
    }
  });

  return result;
}

/**
 * 全話者の過去フィードバックを統合したコンテキストを生成
 * @param {Object} pastFeedbacksBySpearker - 話者ごとの過去フィードバック
 * @returns {string} 統合されたコンテキスト文字列
 */
function buildAllComparisonContexts(pastFeedbacksBySpeaker) {
  const contexts = [];

  for (const [speaker, feedbacks] of Object.entries(pastFeedbacksBySpeaker)) {
    if (feedbacks.length > 0) {
      contexts.push(`
### 面接官「${speaker}」の過去フィードバック履歴（直近${feedbacks.length}件）

${feedbacks.map((fb, i) => {
        const formattedDate = `${fb.date.substring(0, 4)}年${fb.date.substring(4, 6)}月${fb.date.substring(6, 8)}日`;
        return `#### ${i + 1}件前（${formattedDate}）
${fb.content}`;
      }).join('\n\n')}
`);
    }
  }

  if (contexts.length === 0) {
    // 過去フィードバックがない場合の指示
    return `
---

【過去フィードバック比較セクションについて】
この面接の面接官には過去のフィードバック履歴がありません。
レポート雛形の「過去フィードバックとの比較」セクションには「過去のフィードバック履歴がないため、比較対象なし」と記載してください。
`;
  }

  return `
---

## 面接官の過去フィードバック履歴

以下は各面接官が過去に受けたフィードバックレポートです。今回のフィードバックと比較して、改善点や継続課題を分析してください。

${contexts.join('\n')}

---

【重要】上記に過去フィードバック履歴がある面接官については、その面接官のフィードバックレポートの末尾に以下の形式で比較セクションを追加してください：

## 過去フィードバックとの比較

### 評価項目の推移

| 評価項目 | 前回 | 今回 | 変化 |
|:--|:--|:--|:--|
| 質問力（深掘り） | △/○/◎ | △/○/◎ | ↑改善/→維持/↓後退 |
| 傾聴・共感力 | △/○/◎ | △/○/◎ | ↑改善/→維持/↓後退 |
| アトラクト力 | △/○/◎ | △/○/◎ | ↑改善/→維持/↓後退 |
| 時間配分 | △/○/◎ | △/○/◎ | ↑改善/→維持/↓後退 |

### 改善が見られた点
- （過去と比較して改善した具体的な点を記載）

### 継続して取り組むべき課題
- （過去から継続している課題を記載）

### 総評
（面接官としての成長や今後の期待について1〜2文で記載）

※過去フィードバック履歴がない面接官については、比較セクションは追加しないでください。
`
}

// ============================================
// システムプロンプト
// ============================================

/**
 * Claude用のシステムプロンプトを構築
 * 外部ファイルから読み込んだ内容を組み合わせる
 */
function getSystemPrompt() {
  const promptInstructions = getPromptInstructions();
  const guidelines = getEvaluationGuidelines();
  const template = getReportTemplate();

  // プロンプト指示の中で評価ガイドラインとレポート雛形を参照する形式
  // 面接フィードバックレポート生成指示プロンプト_3.md の内容をベースに、
  // 実際のガイドラインとテンプレートを埋め込む
  return `${promptInstructions}

---

# 評価ガイドライン（A）

${guidelines}

---

# レポート雛形（B）

${template}`;
}

// ============================================
// ユーティリティ関数
// ============================================

/**
 * 現在日付をYYYYMMDD形式で取得
 */
function getDateString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}
