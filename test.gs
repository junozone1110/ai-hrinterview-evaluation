/**
 * テスト・確認用関数
 * 本番トリガーには使用しない
 */

// ============================================
// 設定確認
// ============================================

/**
 * 設定値の確認
 */
function checkConfig() {
  const config = getScriptConfig();

  console.log('=== スクリプトプロパティ確認 ===');
  console.log(`CLAUDE_API_KEY: ${config.claudeApiKey ? '設定済み' : '未設定'}`);
  console.log(`SLACK_BOT_TOKEN: ${config.slackBotToken ? '設定済み' : '未設定'}`);
  console.log(`SLACK_CHANNEL_ID: ${config.slackChannelId ? '設定済み' : '未設定'}`);
  console.log(`OUTPUT_FOLDER_ID: ${config.outputFolderId ? '設定済み' : '未設定'}`);
  console.log(`LOG_SPREADSHEET_ID: ${config.logSpreadsheetId ? '設定済み' : '未設定'}`);
  console.log(`CONFIG_FOLDER_ID: ${config.configFolderId ? '設定済み' : '未設定'}`);

  // フォルダアクセス確認
  console.log('\n=== フォルダアクセス確認 ===');
  try {
    const outputFolder = DriveApp.getFolderById(config.outputFolderId);
    console.log(`OUTPUT_FOLDER: ${outputFolder.getName()} ✓`);
  } catch (e) {
    console.error(`OUTPUT_FOLDER: アクセス失敗 - ${e.message}`);
  }

  try {
    const configFolder = DriveApp.getFolderById(config.configFolderId);
    console.log(`CONFIG_FOLDER: ${configFolder.getName()} ✓`);
  } catch (e) {
    console.error(`CONFIG_FOLDER: アクセス失敗 - ${e.message}`);
  }

  try {
    const spreadsheet = SpreadsheetApp.openById(config.logSpreadsheetId);
    console.log(`LOG_SPREADSHEET: ${spreadsheet.getName()} ✓`);
  } catch (e) {
    console.error(`LOG_SPREADSHEET: アクセス失敗 - ${e.message}`);
  }
}

/**
 * inputフォルダ内のファイル一覧を表示
 */
function listConfigFiles() {
  console.log('=== inputフォルダ内のファイル一覧 ===');

  try {
    const config = getScriptConfig();
    const folder = DriveApp.getFolderById(config.configFolderId);
    const files = folder.getFiles();

    const requiredFiles = [CONFIG.PROMPT_FILE, CONFIG.GUIDELINE_FILE, CONFIG.TEMPLATE_FILE];
    const foundFiles = [];

    while (files.hasNext()) {
      const file = files.next();
      const fileName = file.getName();
      foundFiles.push(fileName);

      const isRequired = requiredFiles.includes(fileName);
      console.log(`${isRequired ? '✓' : ' '} ${fileName}`);
    }

    console.log('\n=== 必須ファイル確認 ===');
    requiredFiles.forEach(required => {
      const found = foundFiles.includes(required);
      console.log(`${found ? '✓' : '✗'} ${required} ${found ? '' : '- 見つかりません'}`);
    });
  } catch (e) {
    console.error(`フォルダアクセス失敗: ${e.message}`);
  }
}

/**
 * 共有アイテム内のGoogleドキュメント一覧を表示
 * 「面接」「面談」を含むファイルには ✓ マークを付ける
 */
function listSharedDocuments() {
  console.log('=== 共有アイテム内のGoogleドキュメント一覧 ===');

  const query = "sharedWithMe=true and mimeType='application/vnd.google-apps.document' and trashed=false";
  const files = DriveApp.searchFiles(query);

  const processedFileIds = getProcessedFileIds();
  let count = 0;

  while (files.hasNext()) {
    const file = files.next();
    const fileName = file.getName();
    const fileId = file.getId();

    const matchesFilter = CONFIG.FILENAME_FILTERS.some(filter => fileName.includes(filter));
    const isProcessed = processedFileIds.includes(fileId);

    const marker = matchesFilter ? '✓' : ' ';
    const status = isProcessed ? '[処理済]' : '';

    console.log(`${marker} ${fileName} ${status}`);
    console.log(`    ID: ${fileId}`);
    count++;
  }

  console.log(`\n合計: ${count}件`);
}

/**
 * 面接分類機能のテスト
 */
function testClassifyInterview() {
  console.log('=== 面接分類テスト ===');

  const processedFileIds = getProcessedFileIds();
  const file = getNextDocument(processedFileIds);

  if (!file) {
    console.log('対象ドキュメントがありません');
    return;
  }

  console.log(`対象ファイル: ${file.getName()}`);

  const content = getDocumentContentByExport(file.getId());
  console.log(`文字数: ${content.length}`);

  const classification = classifyInterview(content);
  console.log(`採用面接判定: ${classification.isRecruitmentInterview}`);
  console.log(`理由: ${classification.reason}`);
}

/**
 * Slackチャネルへの疎通確認（テストメッセージ送信）
 */
function testSlackConnection() {
  const botToken = PropertiesService.getScriptProperties().getProperty('SLACK_BOT_TOKEN');
  const channelId = PropertiesService.getScriptProperties().getProperty('SLACK_CHANNEL_ID');

  if (!botToken || !channelId) {
    console.error('SLACK_BOT_TOKEN または SLACK_CHANNEL_ID が設定されていません');
    return;
  }

  console.log('=== Slack疎通確認 ===');

  const message = `🔧 *テストメッセージ*\n\n面接フィードバックレポート自動生成システムからの疎通確認です。\n送信日時: ${new Date().toLocaleString('ja-JP')}`;

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

  if (result.ok) {
    console.log('✓ Slack送信成功');
    console.log(`  チャンネル: ${result.channel}`);
    console.log(`  タイムスタンプ: ${result.ts}`);
  } else {
    console.error(`✗ Slack送信失敗: ${result.error}`);
  }
}

/**
 * Slackメンション機能のテスト
 */
function testSlackMention() {
  const botToken = PropertiesService.getScriptProperties().getProperty('SLACK_BOT_TOKEN');
  const channelId = PropertiesService.getScriptProperties().getProperty('SLACK_CHANNEL_ID');

  if (!botToken || !channelId) {
    console.error('Slack設定が不完全です');
    return;
  }

  console.log('=== Slackメンションテスト ===');

  // チャンネルメンバー確認
  const members = getChannelMembers(channelId, botToken);
  console.log(`チャンネルメンバー数: ${members ? members.length : '取得失敗'}`);

  // テスト用の面接官データ
  const testInterviewers = [
    { name: 'テスト太郎', email: null }
  ];

  const result = formatInterviewerMentions(testInterviewers, botToken, channelId);
  console.log(`メンション結果: ${result}`);
}

// ============================================
// 過去フィードバック比較機能のテスト
// ============================================

/**
 * 特定の面接官の過去フィードバックを取得してログに出力
 * GASエディタから手動実行してテスト
 */
function testGetPastFeedbacks() {
  // テストしたい面接官名を指定（OUTPUT_FOLDERにあるファイル名から）
  const testInterviewerName = 'jun-ozone';  // 実際の面接官名に変更してください
  const excludeDate = getDateString();  // 今日の日付を除外

  console.log(`=== 過去フィードバック取得テスト ===`);
  console.log(`面接官: ${testInterviewerName}`);
  console.log(`除外日: ${excludeDate}`);

  const pastFeedbacks = getPreviousFeedbacksByInterviewer(testInterviewerName, excludeDate);

  console.log(`取得件数: ${pastFeedbacks.length}件`);

  pastFeedbacks.forEach((fb, i) => {
    console.log(`\n--- ${i + 1}件目 (${fb.date}) ---`);
    console.log(`ファイル名: ${fb.fileName}`);
    console.log(`内容の一部: ${fb.content.substring(0, 200)}...`);
  });
}

/**
 * OUTPUT_FOLDERのフィードバックレポート一覧を出力
 */
function testListFeedbackReports() {
  const config = getScriptConfig();
  const folder = DriveApp.getFolderById(config.outputFolderId);
  const files = folder.getFiles();

  console.log(`=== OUTPUT_FOLDER内のフィードバックレポート一覧 ===`);

  const reports = [];
  while (files.hasNext()) {
    const file = files.next();
    const fileName = file.getName();

    if (fileName.startsWith('面接フィードバックレポート_')) {
      const match = fileName.match(/^面接フィードバックレポート_(\d{8})_(.+)\.md$/);
      if (match) {
        reports.push({
          date: match[1],
          interviewer: match[2],
          fileName: fileName
        });
      }
    }
  }

  // 日付でソート
  reports.sort((a, b) => b.date.localeCompare(a.date));

  console.log(`総件数: ${reports.length}件\n`);

  // 面接官ごとにグループ化
  const byInterviewer = {};
  reports.forEach(r => {
    if (!byInterviewer[r.interviewer]) {
      byInterviewer[r.interviewer] = [];
    }
    byInterviewer[r.interviewer].push(r.date);
  });

  for (const [interviewer, dates] of Object.entries(byInterviewer)) {
    console.log(`${interviewer}: ${dates.length}件 (${dates.join(', ')})`);
  }
}

/**
 * 文字起こしから話者名抽出をテスト
 */
function testExtractSpeakers() {
  // テスト用のサンプル文字起こしテキスト
  const sampleTranscript = `
=== タブ: メモ ===
会議タイトル: 中途面接_山田太郎
参加者: 田中一郎, 佐藤花子, 山田太郎

=== タブ: 文字起こし ===
田中一郎: 本日はお時間をいただきありがとうございます。
山田太郎: よろしくお願いします。
佐藤花子: 早速ですが、自己紹介をお願いできますか？
山田太郎: はい、私は...
`;

  console.log(`=== 話者抽出テスト ===`);
  console.log(`入力テキスト:\n${sampleTranscript}\n`);

  const speakers = extractSpeakersFromTranscript(sampleTranscript);

  console.log(`抽出された話者: ${speakers.join(', ')}`);
}

/**
 * 比較コンテキスト生成をテスト
 */
function testBuildComparisonContext() {
  // テスト用のダミー過去フィードバックデータ
  const pastFeedbacksBySpeaker = {
    '田中一郎': [
      {
        date: '20251201',
        content: `# 面接官フィードバックレポート\n\n## 総評\n質問の深掘りが十分にできていました。`,
        fileName: '面接フィードバックレポート_20251201_田中一郎.md'
      }
    ]
  };

  console.log(`=== 比較コンテキスト生成テスト ===`);

  const context = buildAllComparisonContexts(pastFeedbacksBySpeaker);

  console.log(`生成されたコンテキスト:\n${context}`);
}

// ============================================
// Slack関連のテスト
// ============================================

/**
 * Botが投稿した過去のメッセージを全て削除
 * 注意: channels:history スコープが必要
 */
function deleteAllBotMessages() {
  const botToken = PropertiesService.getScriptProperties().getProperty('SLACK_BOT_TOKEN');
  const channelId = PropertiesService.getScriptProperties().getProperty('SLACK_CHANNEL_ID');

  if (!botToken || !channelId) {
    console.error('SLACK_BOT_TOKEN または SLACK_CHANNEL_ID が設定されていません');
    return;
  }

  // BotのユーザーIDを取得
  const authResponse = UrlFetchApp.fetch('https://slack.com/api/auth.test', {
    method: 'get',
    headers: {
      'Authorization': `Bearer ${botToken}`
    },
    muteHttpExceptions: true
  });

  const authResult = JSON.parse(authResponse.getContentText());
  if (!authResult.ok) {
    console.error(`認証エラー: ${authResult.error}`);
    return;
  }

  const botUserId = authResult.user_id;
  console.log(`Bot User ID: ${botUserId}`);

  // チャンネルの履歴を取得
  let cursor = null;
  let deletedCount = 0;

  do {
    let url = `https://slack.com/api/conversations.history?channel=${channelId}&limit=100`;
    if (cursor) {
      url += `&cursor=${encodeURIComponent(cursor)}`;
    }

    const historyResponse = UrlFetchApp.fetch(url, {
      method: 'get',
      headers: {
        'Authorization': `Bearer ${botToken}`
      },
      muteHttpExceptions: true
    });

    const historyResult = JSON.parse(historyResponse.getContentText());
    if (!historyResult.ok) {
      console.error(`履歴取得エラー: ${historyResult.error}`);
      break;
    }

    // Botが投稿したメッセージを削除
    for (const message of historyResult.messages) {
      if (message.bot_id || message.user === botUserId) {
        const deleteResponse = UrlFetchApp.fetch('https://slack.com/api/chat.delete', {
          method: 'post',
          headers: {
            'Authorization': `Bearer ${botToken}`,
            'Content-Type': 'application/json'
          },
          payload: JSON.stringify({
            channel: channelId,
            ts: message.ts
          }),
          muteHttpExceptions: true
        });

        const deleteResult = JSON.parse(deleteResponse.getContentText());
        if (deleteResult.ok) {
          console.log(`削除成功: ${message.ts}`);
          deletedCount++;
        } else {
          console.warn(`削除失敗: ${message.ts} - ${deleteResult.error}`);
        }

        // レート制限対策
        Utilities.sleep(1000);
      }
    }

    cursor = historyResult.response_metadata?.next_cursor;
  } while (cursor);

  console.log(`完了: ${deletedCount}件のメッセージを削除しました`);
}

// ============================================
// その他のテスト
// ============================================

/**
 * メイン処理のテスト実行
 */
function testMain() {
  main();
}

/**
 * 設定ファイル読み込みテスト
 */
function testLoadConfigFiles() {
  console.log('=== 設定ファイル読み込みテスト ===');

  try {
    const guideline = getEvaluationGuidelines();
    console.log(`評価ガイドライン: ${guideline.substring(0, 100)}...`);
  } catch (e) {
    console.error(`評価ガイドライン読み込みエラー: ${e.message}`);
  }

  try {
    const template = getReportTemplate();
    console.log(`レポート雛形: ${template.substring(0, 100)}...`);
  } catch (e) {
    console.error(`レポート雛形読み込みエラー: ${e.message}`);
  }

  try {
    const prompt = getPromptInstructions();
    console.log(`プロンプト指示: ${prompt.substring(0, 100)}...`);
  } catch (e) {
    console.error(`プロンプト指示読み込みエラー: ${e.message}`);
  }
}
