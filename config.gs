/**
 * 設定定数
 * 面接フィードバックレポート自動生成システム
 *
 * 機密情報（APIキー、フォルダID等）はGASのスクリプトプロパティで管理
 * 設定方法: GASエディタ → プロジェクトの設定 → スクリプトプロパティ
 */

const CONFIG = {
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

  // API リトライ設定
  API_RETRY_MAX_ATTEMPTS: 3,         // 最大リトライ回数
  API_RETRY_INITIAL_DELAY_MS: 1000,  // 初回リトライ待機時間（ミリ秒）

  // 処理設定
  LOCK_TIMEOUT_MS: 300000,  // 5分
  CONTENT_PREVIEW_LENGTH: 5000,  // 分類用プレビュー文字数
  PAST_FEEDBACK_LIMIT: 3,  // 過去フィードバック取得件数
};

/**
 * スクリプトプロパティから設定を取得
 *
 * 必要なスクリプトプロパティ:
 * - CLAUDE_API_KEY: Claude APIキー
 * - SLACK_BOT_TOKEN: Slack Bot Token (xoxb-...)
 * - SLACK_CHANNEL_ID: Slack通知先チャンネルID
 * - SLACK_ERROR_CHANNEL_ID: エラー通知先チャンネルID（任意）
 * - OUTPUT_FOLDER_ID: レポート出力先フォルダID
 * - LOG_SPREADSHEET_ID: ログ記録用スプレッドシートID
 * - CONFIG_FOLDER_ID: 設定ファイル格納フォルダID
 */
function getScriptConfig() {
  const props = PropertiesService.getScriptProperties();
  return {
    // API認証
    claudeApiKey: props.getProperty('CLAUDE_API_KEY'),
    slackBotToken: props.getProperty('SLACK_BOT_TOKEN'),
    slackChannelId: props.getProperty('SLACK_CHANNEL_ID'),
    slackErrorChannelId: props.getProperty('SLACK_ERROR_CHANNEL_ID'),
    // Google Drive
    outputFolderId: props.getProperty('OUTPUT_FOLDER_ID'),
    logSpreadsheetId: props.getProperty('LOG_SPREADSHEET_ID'),
    configFolderId: props.getProperty('CONFIG_FOLDER_ID'),
  };
}
