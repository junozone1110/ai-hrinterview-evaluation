# CLAUDE.md

このファイルはClaude Codeがプロジェクトのコンテキストを理解するためのガイドです。

## プロジェクト概要

面接フィードバックレポート自動生成システム（Google Apps Script）

- 「共有アイテム」から面接文字起こしドキュメントを自動検知
- Claude APIでフィードバックレポートを生成
- Google Driveに保存、Slackに通知

## 技術スタック

- Google Apps Script (GAS)
- Claude API (Haiku: 分類, Sonnet: レポート生成)
- Slack API
- clasp (ローカル開発)

## ファイル構成

```
├── config.gs         # 設定定数（機密情報はScript Propertiesで管理）
├── main.gs           # メインエントリポイント、処理フロー制御
├── document.gs       # ドキュメント検索、タブ取得、内容読み込み
├── claude.gs         # Claude API呼び出し、分類、レポート生成
├── drive.gs          # ファイル保存、設定ファイル読み込み
├── slack.gs          # Slack通知、ファイルアップロード、ユーザー検索
├── log.gs            # スプレッドシートへのログ記録
├── prompt.gs         # システムプロンプト構築
├── feedback.gs       # 過去フィードバック比較、話者抽出
├── utils.gs          # 日付変換等のユーティリティ
├── test.gs           # テスト・確認用関数
├── appsscript.json       # GASマニフェスト
├── .clasp.json.example   # clasp設定テンプレート
├── .clasp.json           # clasp設定（.gitignore対象、ローカルで作成）
└── log/                  # 開発ログ格納フォルダ
```

## 初期セットアップ

```bash
# 1. clasp をインストール
npm install -g @google/clasp

# 2. Google アカウントでログイン
clasp login

# 3. .clasp.json を作成（テンプレートをコピー）
cp .clasp.json.example .clasp.json
# .clasp.json のスクリプトIDを設定
# GASプロジェクトのURLから取得: https://script.google.com/d/{SCRIPT_ID}/edit

# 4. GASにプッシュ
clasp push

# 5. GASエディタでスクリプトプロパティを設定（下記参照）
clasp open
```

## スクリプトプロパティ設定

GASエディタ → プロジェクトの設定 → スクリプトプロパティ で以下を設定:

| プロパティ名 | 説明 | 取得元 |
|:--|:--|:--|
| `CLAUDE_API_KEY` | Claude APIキー | Anthropic Console |
| `SLACK_BOT_TOKEN` | Slack Bot Token | Slack App設定 |
| `SLACK_CHANNEL_ID` | 通知先チャンネルID | Slackチャンネル詳細 |
| `OUTPUT_FOLDER_ID` | レポート出力先フォルダID | Google DriveのURL |
| `LOG_SPREADSHEET_ID` | ログ用スプレッドシートID | スプレッドシートのURL |
| `CONFIG_FOLDER_ID` | 設定ファイル格納フォルダID | Google DriveのURL |

※ Google DriveのURL形式: `https://drive.google.com/drive/folders/{FOLDER_ID}`

## 開発コマンド

```bash
# GASにプッシュ（ローカル → GAS）
clasp push

# GASからプル（GAS → ローカル）
clasp pull

# GASエディタを開く
clasp open

# GitHubにプッシュ
git push
```

## 開発フロー

1. **Issue作成**（必須）
2. `main` ブランチから feature ブランチを作成
3. ローカルで開発
4. `clasp push` でGASに反映・動作確認
5. コミット・プッシュ
6. Pull Request作成（`Closes #issue番号` で自動クローズ）
7. マージ

## 必須ルール

### Issue紐付けの徹底

**すべての変更は必ずIssueと紐付けること。Issueなしでのマージは禁止。**

1. 作業開始前に必ずIssueを作成する
2. PRには `Closes #issue番号` を含める
3. コミットメッセージにも `#issue番号` を含める
4. 直接mainにプッシュする場合も、事前にIssueを作成し、コミット後にIssueをクローズする

```bash
# PRでの紐付け例
gh pr create --title "feat: 新機能追加" --body "Closes #123"

# 直接プッシュ後のIssueクローズ例
gh issue close 123 --comment "コミット abc1234 で対応完了"
```

**理由**: 変更履歴の追跡、レビュー、ロールバック時の影響範囲特定のため

## コミットログのルール

コミットごとに `/log` フォルダにログファイルを作成する。

### ファイル命名規則

```
/log/YYYYMMDD-HHMMSS-{短い説明}.md
```

例: `log/20231223-143000-clasp-setup.md`

### ログファイルの内容

```markdown
# {コミットタイトル}

## 日時
YYYY-MM-DD HH:MM

## 変更内容
- 変更点1
- 変更点2

## 関連Issue
#issue番号

## 備考
（あれば）
```

## Issue管理

- GitHub Projects: https://github.com/users/junozone1110/projects/1
- ブランチ命名: `feature/{機能名}` または `fix/{修正内容}`
- コミットメッセージに `#issue番号` を含める

## 注意事項

- `.clasp.json` は `.gitignore` 対象（スクリプトIDを含むため）
- 機密情報（APIキー、フォルダID等）は全てスクリプトプロパティで管理
- GASの実行時間制限は6分
