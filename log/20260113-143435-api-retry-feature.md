# feat: Claude API呼び出しにリトライ機能を追加

## 日時
2026-01-13 14:34

## 変更内容
- config.gsにリトライ設定を追加（最大3回、初回待機1秒）
- claude.gsにリトライロジックを実装
  - isRetryableError関数: リトライ可能なエラーを判定
  - RetryableErrorクラス: リトライ可能エラーを識別
  - executeWithRetry関数: 指数バックオフでリトライ実行
- リトライ対象エラー:
  - ネットワーク関連: Address unavailable, Connection timed out, Connection refused等
  - HTTPステータス: 429, 500, 502, 503, 504

## 関連Issue
#19

## 備考
「Address unavailable: https://api.anthropic.com/v1/messages」エラー対応
