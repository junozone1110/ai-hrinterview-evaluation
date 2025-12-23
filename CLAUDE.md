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
├── config.gs         # 設定定数、スクリプトプロパティ取得
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

# 4. .clasp.json のスクリプトIDを設定
# GASプロジェクトのURLから取得: https://script.google.com/d/{SCRIPT_ID}/edit
```

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

1. `main` ブランチから feature ブランチを作成
2. ローカルで開発
3. `clasp push` でGASに反映・動作確認
4. コミット・プッシュ
5. Pull Request作成（`Closes #issue番号` で自動クローズ）
6. マージ

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
- Script Propertiesに機密情報（APIキー等）を設定
- GASの実行時間制限は6分
