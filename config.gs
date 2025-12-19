/**
 * 設定定数
 * 面接フィードバックレポート自動生成システム
 */

const CONFIG = {
  // Google Drive フォルダID（共有ドライブ /面接 配下）
  OUTPUT_FOLDER_ID: '1f0yqhGYY2N1wc1XIaC6VBTMJ6MzGX8OF',
  LOG_SPREADSHEET_ID: '1aP6dEuBCqtA_09_gexf_2fDld-qYBGGT9Zqc_bfinx0',
  CONFIG_FOLDER_ID: '1ubMb7SL-2_rxxCvmSksHJHRrCY7TRH7t',

  // 設定ファイル名
  PROMPT_FILE: 'feedbackprompt.md',
  GUIDELINE_FILE: 'evaluationguideline.md',
  TEMPLATE_FILE: 'template.md',

  // ファイル名フィルタ（これらの文字列を含むファイルのみ処理）
  FILENAME_FILTERS: ['面接', '面談'],

  // Claude API設定
  CLAUDE_MODEL: 'claude-sonnet-4-20250514',
  CLAUDE_MODEL_CLASSIFIER: 'claude-3-5-haiku-20241022',
  CLAUDE_MAX_TOKENS: 16000,
  CLAUDE_CLASSIFIER_MAX_TOKENS: 100,

  // 処理設定
  LOCK_TIMEOUT_MS: 300000,  // 5分
  CONTENT_PREVIEW_LENGTH: 5000,  // 分類用プレビュー文字数
  PAST_FEEDBACK_LIMIT: 3,  // 過去フィードバック取得件数
};

/**
 * スクリプトプロパティからAPI設定を取得
 */
function getScriptConfig() {
  const props = PropertiesService.getScriptProperties();
  return {
    claudeApiKey: props.getProperty('CLAUDE_API_KEY'),
    slackBotToken: props.getProperty('SLACK_BOT_TOKEN'),
    slackChannelId: props.getProperty('SLACK_CHANNEL_ID'),
  };
}
