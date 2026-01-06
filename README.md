# 面接フィードバックレポート自動生成システム

## 概要

「共有アイテム」に表示されるGoogleドキュメント（面接文字起こし）を自動検知し、Claude APIでフィードバックレポートを生成してSlackに通知するシステムです。

---

## アーキテクチャ

```
【入力】
  共有アイテムから検索
  │  ・「面接」「面談」を含むGoogleドキュメントを検索
  │  ・処理済みファイルはスプレッドシートでID管理
  │
  ▼
【分類】
  Claude API (Haiku) で内容判定
  │  ・採用面接/カジュアル面談 → 処理続行
  │  ・振り返り面談/社内MTG等 → スキップ（ログのみ記録）
  │
  ▼
【処理】
  Claude API (Sonnet) でレポート生成
  │  ・評価ガイドライン、レポート雛形、プロンプト指示は外部MDファイルから読み込み
  │
  ▼
【出力】
  Google Drive + Slack
  │  ・MDファイルを共有ドライブに保存
  │  ・Slackにスレッド形式で通知（親メッセージ + ファイル返信）
  │  ・面接官へのメンション（チャンネルメンバーのみ）


共有ドライブ/面接/
├── input/            # 設定ファイル（評価基準・雛形・プロンプト）
│   ├── feedbackprompt.md       # プロンプト指示
│   ├── evaluationguideline.md  # 評価ガイドライン
│   └── template.md             # レポート雛形
├── output/           # 生成されたMDファイル
└── logs/
    └── 処理ログ.gsheet  # 処理履歴 + 処理済みファイルID管理
```

---

## 出力イメージ

### 生成されるファイル

| ファイル種別 | ファイル数 | 命名規則 |
|:--|:--|:--|
| フィードバックレポート | 面接官の人数分 | `面接フィードバックレポート_{YYYYMMDD}_{面接官名}.md` |
| 面接サマリ | 1ファイル | `面接サマリ_{YYYYMMDD}_{候補者名}.md` |

### Slack通知形式

親メッセージとして以下の情報を投稿し、スレッドにレポートファイルをアップロードします。

```
📋 面接フィードバックレポート生成完了

📅 面接日時: 2025年12月02日
👤 候補者: 山田太郎
🎤 面接官: @田中, *佐藤*
    └── 面接フィードバックレポート_20251202_tanaka.md
    └── 面接フィードバックレポート_20251202_sato.md
    └── 面接サマリ_20251202_山田太郎.md
```

#### メンションのルール

| 条件 | 表示形式 |
|:--|:--|
| Slackユーザー発見 & チャンネルメンバー | `@田中`（メンション） |
| Slackユーザー発見 & チャンネル外 | `*佐藤*`（太字、メンションなし） |
| Slackユーザー未発見 | `*山田*`（太字） |

---

## 処理ログのステータス

| ステータス | 意味 |
|:--|:--|
| `SUCCESS` | 正常処理完了 |
| `SKIPPED` | 採用面接でないためスキップ（振り返り面談等） |
| `FAILED` | エラー発生 |

---

## 前提条件

- Google アカウント
- Anthropic APIキー
- Slack ワークスペースの管理者権限（App作成用）
- 共有ドライブへのアクセス権限

---

## セットアップ手順

### Step 1: 共有ドライブにフォルダ準備

1. 共有ドライブ内に「面接」フォルダを作成

2. 「面接」フォルダ配下に以下を作成：
   - `input` フォルダ - 設定ファイル格納用
   - `output` フォルダ - 生成されたMDファイルの保存先
   - `logs` フォルダ - ログ用

3. `input` フォルダに以下のMDファイルをアップロード：
   - `feedbackprompt.md` - プロンプト指示
   - `evaluationguideline.md` - 評価ガイドライン
   - `template.md` - レポート雛形

4. `logs` フォルダ内に「処理ログ」という名前のスプレッドシートを作成

5. 各フォルダ・スプレッドシートのIDをメモ
   - URLの `https://drive.google.com/drive/folders/[ここがID]` の部分

---

### Step 2: Slack App 作成

1. [api.slack.com/apps](https://api.slack.com/apps) にアクセス

2. 「Create New App」→「From scratch」を選択

3. App名とワークスペースを設定

4. 「OAuth & Permissions」に移動

5. 「Bot Token Scopes」に以下を追加：
   - `files:write` - ファイルアップロード用
   - `chat:write` - メッセージ投稿用
   - `users:read` - ユーザー一覧取得（名前でメンション用）
   - `users:read.email` - メールアドレスでユーザー検索（メンション用）
   - `channels:read` - チャンネルメンバー確認用（publicチャンネル）
   - `groups:read` - チャンネルメンバー確認用（privateチャンネル）

6. 「Install to Workspace」をクリック

7. 「Bot User OAuth Token」（`xoxb-` で始まる）をコピー

8. 投稿先チャンネルで `/invite @[アプリ名]` を実行してBotを招待

9. チャンネルIDを取得（チャンネル名を右クリック →「チャンネル詳細を表示」→ 最下部にID）

---

### Step 3: GAS プロジェクト作成（clasp利用）

1. clasp をインストール
   ```bash
   npm install -g @google/clasp
   ```

2. Google アカウントでログイン
   ```bash
   clasp login --no-localhost
   ```

3. [script.google.com](https://script.google.com) で新しいプロジェクトを作成し、スクリプトIDを取得
   - URLの `https://script.google.com/d/[スクリプトID]/edit` の部分

4. リポジトリをクローンして `.clasp.json` を作成
   ```bash
   git clone https://github.com/junozone1110/ai-hrinterview-evaluation.git
   cd ai-hrinterview-evaluation
   cp .clasp.json.example .clasp.json
   # .clasp.json のスクリプトIDを設定
   ```

5. GASにプッシュ
   ```bash
   clasp push
   ```

---

### Step 4: Script Properties 設定

1. GASエディタで「プロジェクトの設定」（歯車アイコン）をクリック

2. 「スクリプト プロパティ」セクションで以下を追加：

   | プロパティ | 値 |
   |:--|:--|
   | `CLAUDE_API_KEY` | Anthropic APIキー |
   | `SLACK_BOT_TOKEN` | Slack Bot Token (`xoxb-...`) |
   | `SLACK_CHANNEL_ID` | 投稿先チャンネルID |
   | `SLACK_ERROR_CHANNEL_ID` | エラー通知先チャンネルID（任意） |
   | `OUTPUT_FOLDER_ID` | outputフォルダID |
   | `LOG_SPREADSHEET_ID` | ログ用スプレッドシートID |
   | `CONFIG_FOLDER_ID` | inputフォルダID |

---

### Step 5: Google Docs API 有効化

Geminiによるメモなど、複数タブを持つドキュメントを正しく読み込むために必要です。

1. GASエディタで「プロジェクトの設定」（歯車アイコン）をクリック

2. 「Google Cloud Platform (GCP) プロジェクト」セクションのプロジェクト番号をクリック
   - GCPコンソールが開きます

3. GCPコンソールで左メニュー →「APIとサービス」→「有効なAPIとサービス」

4. 「+ APIとサービスを有効にする」をクリック

5. 「Google Docs API」を検索して選択

6. 「有効にする」をクリック

※ 直接アクセス: https://console.cloud.google.com/apis/library/docs.googleapis.com

---

### Step 6: トリガー設定

1. GASエディタで「トリガー」（時計アイコン）をクリック

2. 「トリガーを追加」をクリック

3. 以下を設定：
   - 実行する関数: `main`
   - デプロイ時に実行: `Head`
   - イベントのソース: `時間主導型`
   - 時間ベースのトリガーのタイプ: `分ベースのタイマー`
   - 間隔: `5分おき`

4. 保存

---

### Step 6: 権限承認

1. GASエディタで `testMain` 関数を選択して実行

2. 権限承認のダイアログが表示されたら承認

3. 「詳細」→「[プロジェクト名]（安全ではないページ）に移動」をクリック

4. 必要な権限を確認して「許可」

---

## 動作確認

### 設定確認

GASエディタで `checkConfig` 関数を実行し、ログを確認：

```
=== スクリプトプロパティ確認 ===
CLAUDE_API_KEY: 設定済み
SLACK_BOT_TOKEN: 設定済み
SLACK_CHANNEL_ID: 設定済み
SLACK_ERROR_CHANNEL_ID: 設定済み（任意）
OUTPUT_FOLDER_ID: 設定済み
LOG_SPREADSHEET_ID: 設定済み
CONFIG_FOLDER_ID: 設定済み

=== フォルダアクセス確認 ===
OUTPUT_FOLDER: output ✓
CONFIG_FOLDER: input ✓
LOG_SPREADSHEET: 処理ログ ✓
```

### 設定ファイル確認

`listConfigFiles` 関数を実行すると、inputフォルダ内のファイル一覧が表示されます。

### 共有アイテムの確認

`listSharedDocuments` 関数を実行すると、共有アイテム内のGoogleドキュメント一覧が表示されます。
「面接」「面談」を含むファイルには `✓` マークが付きます。

### 面接分類テスト

`testClassifyInterview` 関数を実行すると、対象ドキュメントが採用面接かどうか判定されます。

### Slackメンションテスト

`testSlackMention` 関数を実行すると、チャンネルメンバー確認とメンション形式を確認できます。

### テスト実行

1. 共有アイテムに「面接」または「面談」を含む名前のGoogleドキュメントがあることを確認

2. `testMain` 関数を手動実行

3. 以下を確認：
   - 共有ドライブの `/面接/output` にMDファイルが生成される
   - Slackチャンネルに親メッセージ + スレッド返信でファイルがアップロードされる
   - スプレッドシートにログが記録されている

---

## 処理フロー

```
1. トリガー起動（5分間隔）
   │
2. 排他ロック取得
   │ ※別プロセス実行中なら終了
   │
3. 共有アイテムからファイル検索
   │ ├─ 「面接」または「面談」を含むドキュメントのみ対象
   │ └─ 処理済みファイルIDはスキップ
   │
4. ドキュメント内容を読み取り
   │
5. 【分類】採用面接かどうか判定（Claude Haiku）
   │ ├─ 採用面接/カジュアル面談 → 続行
   │ └─ 振り返り面談/社内MTG → SKIPPED としてログ記録、終了
   │
6. 設定ファイル読み込み（input フォルダから）
   │ ├─ feedbackprompt.md（プロンプト指示）
   │ ├─ evaluationguideline.md（評価ガイドライン）
   │ └─ template.md（レポート雛形）
   │
7. Claude API呼び出し（Sonnet）
   │ └─ 面接官別レポート + 面接サマリを生成
   │
8. MDファイルをGoogle Drive /output に保存
   │
9. Slack通知（スレッド形式）
   │ ├─ 親メッセージ投稿（日時・候補者・面接官）
   │ ├─ チャンネルメンバー確認
   │ ├─ メンバーのみメンション、非メンバーは太字表示
   │ └─ スレッド返信でファイルアップロード
   │
10. 処理ログをスプレッドシートに記録（SUCCESS）
   │
11. ロック解放・終了
```

---

## 主要関数一覧

### config.gs（設定）

| 関数名 | 役割 |
|:--|:--|
| `getScriptConfig()` | スクリプトプロパティからAPI設定を取得 |

### main.gs（メイン処理）

| 関数名 | 役割 |
|:--|:--|
| `main()` | エントリポイント。トリガーから呼び出される |
| `processDocument()` | ドキュメントを処理（分類→生成→保存→通知） |

### document.gs（ドキュメント取得）

| 関数名 | 役割 |
|:--|:--|
| `getNextDocument()` | 共有アイテムから未処理ドキュメントを1件取得 |
| `getProcessedFileIds()` | 処理済みファイルIDリストを取得 |
| `getDocumentContentByExport()` | ドキュメント内容をテキストで取得 |
| `getDocumentTabs()` | ドキュメントのタブ一覧を取得 |

### claude.gs（Claude API連携）

| 関数名 | 役割 |
|:--|:--|
| `classifyInterview()` | Claude APIで採用面接かどうかを判定 |
| `generateFeedback()` | Claude APIを呼び出してレポート生成 |
| `callClaudeApi()` | Claude API呼び出しの共通関数 |
| `parseGeneratedReports()` | 生成テキストを個別レポートに分割 |

### drive.gs（Google Drive操作）

| 関数名 | 役割 |
|:--|:--|
| `saveMdFilesToGoogleDrive()` | MDファイルをoutputフォルダに保存 |
| `getMdFileContent()` | 設定ファイルの内容を取得 |
| `getEvaluationGuidelines()` | 評価ガイドラインを取得 |
| `getReportTemplate()` | レポート雛形を取得 |

### slack.gs（Slack連携）

| 関数名 | 役割 |
|:--|:--|
| `uploadFilesToSlack()` | Slackにスレッド形式で通知 |
| `extractInterviewMetadata()` | レポートから面接情報を抽出 |
| `getSlackUserIdByEmail()` | メールアドレスでSlackユーザーを検索 |
| `getSlackUserIdByName()` | 名前でSlackユーザーを検索 |
| `getChannelMembers()` | Slackチャンネルのメンバー一覧を取得 |
| `formatInterviewerMentions()` | 面接官のメンション表示をフォーマット |

### log.gs（ログ記録）

| 関数名 | 役割 |
|:--|:--|
| `logProcessing()` | スプレッドシートに処理ログを記録 |

### prompt.gs（プロンプト構築）

| 関数名 | 役割 |
|:--|:--|
| `getSystemPrompt()` | 外部ファイルからシステムプロンプトを構築 |

### feedback.gs（過去フィードバック比較）

| 関数名 | 役割 |
|:--|:--|
| `getPreviousFeedbacksByInterviewer()` | 同一面接官の過去レポートを取得 |
| `extractSpeakersFromTranscript()` | 文字起こしから話者名を抽出 |
| `collectPastFeedbacksForSpeakers()` | 全話者の過去フィードバックを収集 |
| `buildAllComparisonContexts()` | 比較コンテキストを生成 |

### utils.gs（ユーティリティ）

| 関数名 | 役割 |
|:--|:--|
| `getDateString()` | 現在日付をYYYYMMDD形式で取得 |
| `isValidEmail()` | メールアドレス形式を検証 |
| `isValidName()` | 名前の形式を検証 |
| `sanitizeErrorMessage()` | エラーメッセージから機密情報を除去 |

### test.gs（テスト・確認用）

| 関数名 | 役割 |
|:--|:--|
| `testMain()` | 手動テスト実行（main関数を呼び出し） |
| `checkConfig()` | 設定値の確認 |
| `listConfigFiles()` | inputフォルダ内のファイル一覧を表示 |
| `listSharedDocuments()` | 共有アイテムの一覧を表示 |
| `testClassifyInterview()` | 面接分類機能のテスト |
| `testSlackMention()` | Slackメンション機能のテスト |
| `testSlackNameLookup()` | 名前からSlackユーザー検索のテスト |
| `testEmailExtraction()` | メールアドレス抽出のテスト |
| `testDocumentTabs()` | ドキュメントタブ構造の確認 |

---

## トラブルシューティング

### よくあるエラー

| エラー | 原因 | 対処 |
|:--|:--|:--|
| `CLAUDE_API_KEY が設定されていません` | Script Propertiesが未設定 | Step 4を確認 |
| `Claude API エラー: 401` | APIキーが無効 | APIキーを再確認 |
| `設定ファイルが見つかりません` | inputフォルダにMDファイルがない | ファイル名を確認 |
| `Slack upload URL取得失敗` | Bot Tokenが無効またはスコープ不足 | Slack App設定を確認 |
| `Slack親メッセージ投稿失敗` | chat:writeスコープがない | Slack App設定を確認 |
| `チャンネルメンバー取得失敗` | channels:read/groups:readスコープがない | Slack App設定を確認 |
| `処理対象のドキュメントがありません` | 共有アイテムに対象ファイルがない | `listSharedDocuments`で確認 |

### 再処理したい場合

処理済みファイルを再処理したい場合は、スプレッドシートから該当のファイルIDの行を削除してください。

### 評価基準の更新

評価ガイドラインやレポート雛形を更新する場合は、`input` フォルダ内の該当MDファイルを編集するだけでOKです。コードの変更は不要です。

### ログ確認方法

1. GASエディタで「実行」→「実行ログ」
2. Google Cloud Consoleでより詳細なログを確認

---

## ファイル構成

```
リポジトリ/
├── config.gs             # 設定定数（機密情報はScript Propertiesで管理）
├── main.gs               # メインエントリポイント、処理フロー制御
├── document.gs           # ドキュメント検索、タブ取得、内容読み込み
├── claude.gs             # Claude API呼び出し、分類、レポート生成
├── drive.gs              # ファイル保存、設定ファイル読み込み
├── slack.gs              # Slack通知、ファイルアップロード、ユーザー検索
├── log.gs                # スプレッドシートへのログ記録
├── prompt.gs             # システムプロンプト構築
├── feedback.gs           # 過去フィードバック比較、話者抽出
├── utils.gs              # 日付変換、バリデーション等のユーティリティ
├── test.gs               # テスト・確認用関数
├── appsscript.json       # GASマニフェスト（権限設定）
├── .clasp.json.example   # clasp設定テンプレート
├── CLAUDE.md             # Claude Code用コンテキストガイド
├── log/                  # 開発ログ
└── README.md             # このファイル

Google Drive/面接/
├── input/            # 設定ファイル
│   ├── feedbackprompt.md
│   ├── evaluationguideline.md
│   └── template.md
├── output/           # 生成されたレポート
└── logs/
    └── 処理ログ.gsheet
```

---

## 技術仕様

| 項目 | 内容 |
|:--|:--|
| 実行環境 | Google Apps Script |
| AIモデル（分類） | Claude 3.5 Haiku |
| AIモデル（レポート生成） | Claude Sonnet 4 |
| 最大トークン | 16,000 |
| 実行間隔 | 5分（トリガー設定） |
| 処理単位 | 1回の実行で1ドキュメント |

### API・スコープ

| サービス | 必要な権限/スコープ |
|:--|:--|
| Google Drive | `https://www.googleapis.com/auth/drive` |
| Google Docs | `https://www.googleapis.com/auth/documents` |
| Google Sheets | `https://www.googleapis.com/auth/spreadsheets` |
| External Request | `https://www.googleapis.com/auth/script.external_request` |
| Slack | `files:write`, `chat:write`, `users:read`, `users:read.email`, `channels:read`, `groups:read` |

---

## 注意事項

- 処理対象は「面接」または「面談」をファイル名に含むGoogleドキュメントのみ
- 採用面接/カジュアル面談以外（振り返り面談等）は自動スキップされる
- 1回の実行で1ドキュメントのみ処理（GAS実行時間制限対策）
- 元の文字起こしファイルは移動しない（共有されているファイルのため）
- 処理済み管理はスプレッドシートのファイルIDで行う
- 評価基準の更新はinputフォルダ内のMDファイルを編集するだけでOK
- Slackメンションはチャンネルメンバーのみ（非メンバーは太字表示）
- 機密情報（APIキー、フォルダID等）は全てスクリプトプロパティで管理
- `.clasp.json` は `.gitignore` 対象（スクリプトIDを含むため）

---

## 開発

### ローカル開発環境

```bash
# clasp インストール
npm install -g @google/clasp

# ログイン
clasp login --no-localhost

# .clasp.json 作成
cp .clasp.json.example .clasp.json
# スクリプトIDを設定

# GASにプッシュ
clasp push

# GASからプル
clasp pull

# GASエディタを開く
clasp open
```

### GitHub

- リポジトリ: https://github.com/junozone1110/ai-hrinterview-evaluation
- Projects: https://github.com/users/junozone1110/projects/1
