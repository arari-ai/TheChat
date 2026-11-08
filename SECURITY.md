# Security

脆弱性は公開Issueに秘密情報を書かず、リポジトリ管理者へ非公開で報告してください。顧客環境のデータは顧客のD1・R2・Durable Object内に保存します。R2のバケットは公開せず、添付ファイルはWorkerの権限確認を経て取得します。

## 導入時の確認

- `hub.config.json`、`wrangler.jsonc`、`.dev.vars`、Cloudflare APIトークン、メール送信キー、VAPID秘密鍵をGitに入れない。
- GitHub Actions用Cloudflare APIトークンを対象アカウント・Workerに必要な権限へ限定する。
- Email Routingのcatch-allやMXを変更する場合、既存メールの配送先を確認する。
- ログインコードの発行にはメール送信手段が必要。未設定ならログインできない。
- D1 Time Travelの復旧点と、更新前のWorkerバージョンを確認する。D1の復旧は新しい書き込みを失う可能性がある。
- ブラウザのWeb Push先はブラウザ提供のPushサービス。通知内容は詳細を含まない一般的な文言にする。
