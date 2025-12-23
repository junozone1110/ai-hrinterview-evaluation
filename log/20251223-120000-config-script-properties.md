# config.gsのID類をスクリプトプロパティに移行

## 日時
2024-12-23

## 変更内容
- OUTPUT_FOLDER_ID, LOG_SPREADSHEET_ID, CONFIG_FOLDER_ID をスクリプトプロパティに移動
- config.gs から機密情報を除去し、リポジトリにコミット可能に
- config.gs.example を削除
- .gitignore から config.gs を削除
- CLAUDE.md にスクリプトプロパティ設定手順を追加

## 関連Issue
#10 config.gsのID類をスクリプトプロパティに移行

## 備考
これにより clasp push 後に毎回 config.gs を手動作成する必要がなくなった
