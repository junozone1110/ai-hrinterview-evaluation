# feat: エラー時の詳細ログ記録機能を追加

## 日時
2026-01-14 16:35

## 変更内容
- config.gs: PROCESSING_PHASE定数、ERROR_RESPONSE_MAX_LENGTH設定を追加
- claude.gs: DetailedErrorクラス、RetryableError拡張、リトライ情報収集
- log.gs: ログスキーマ拡張（4列追加: 処理フェーズ、HTTPステータス、リトライ回数、詳細情報）
- main.gs: handleProcessingErrorでDetailedErrorから詳細情報を抽出
- slack.gs: エラー通知に詳細情報を追加表示
- document.gs: ドキュメント取得エラーにDetailedErrorを使用
- drive.gs: Drive保存エラーにDetailedErrorを使用

## 追加した情報
| 項目 | 説明 |
|:--|:--|
| 処理フェーズ | DOCUMENT_FETCH / CLASSIFICATION / GENERATION / DRIVE_SAVE / SLACK_SEND |
| HTTPステータス | APIレスポンスコード |
| リトライ回数 | 実行した試行回数 |
| 詳細情報 | APIレスポンス本文（最大500文字）|

## 関連Issue
#20

## 備考
既存のスプレッドシートは後方互換性があり、新規ヘッダーが自動追加される
