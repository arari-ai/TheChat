# TheChatの構築・更新手順

最初に `README.md` と `docs/decisions.md` を読んでください。第1段階のみ実装します。顧客データをCloudflareアカウント外に出さず、実設定と秘密情報をGitへ入れないでください。

## 初回構築

1. Cloudflareアカウント、対象ドメイン、Cloudflare APIトークンを準備する。メール送信がCloudflare Email Serviceで利用できなければ、ResendなどのAPIキーを準備する。APIトークンはGitHub Actions Secretまたはローカル環境変数に入れる。
2. `npm ci`、`npm test`、`npm run check`、`npm run build` を実行する。
3. `hub.config.example.json` から、組織名、ドメイン、初期管理者メール、通知送信元、他アプリURL、送信方法を指定した `hub.config.json` を作る。このファイルはGit管理外。
4. `node scripts/provision.mjs` を実行する。既存D1とR2を再利用し、必要な場合だけ作る。同じコマンドを再実行してもよい。
5. `npx wrangler d1 migrations apply DB --remote --config wrangler.jsonc` を実行する。`DB` はバインディング名。
6. Web Pushを利用する場合、VAPID鍵を生成し、公開鍵と連絡先を設定ファイルに、秘密鍵を `wrangler secret put VAPID_PRIVATE_KEY` に保存する。
7. Resendを利用する場合、APIキーを `wrangler secret put RESEND_API_KEY` に保存する。Cloudflare Email Serviceを利用する場合は送信ドメインを有効化し、`emailProvider` を `cloudflare` にする。
8. メール受信が必要ならCloudflare Email Routingを有効化し、受信ルールをWorkerへ向ける。既存のMXやcatch-allを変更する前に影響を確認する。既存のメールサービスがルートドメインのMXを使っている場合は受信専用サブドメインを用意する。`emailRouteAddress` にそのサブドメインの単一アドレスを指定すると、チャンネルアドレスはプラスアドレスになり、ルールを1件だけ作ればよい。サブアドレス対応とDNSを確認してから `emailRoutingEnabled` を有効にする。
9. `npm run deploy` でWorkerを公開する。`node scripts/verify.mjs https://公開URL` でAPI、画面、認証境界を確認する。
10. 初期管理者へログインコードが届き、ログインしてスペース・チャンネルを作成できること、WebSocket再接続、メール受信と返信を実機で確認する。

## 更新

1. 公開ソースのリリースタグを確認し、導入側の固定コミットを更新する。
2. テスト・型チェック・ビルドを通す。
3. D1 Time Travelの復旧点をCloudflare内に記録する。GitHub Actionsへ顧客データをエクスポートしない。
4. マイグレーション、デプロイ、`scripts/verify.mjs`、ログインとメールの確認を順に行う。
5. Workerに問題があれば `npx wrangler rollback --config wrangler.jsonc --message 'Reason'` で前の版へ戻す。DBの復旧はその後の書き込みを失うため、人が影響を確認して行う。

## 秘密情報

`hub.config.json` と `wrangler.jsonc` はGit無視設定に入っている。APIキーやVAPID秘密鍵を `vars` やソースへ直接書かない。コミット前に `git diff --cached` と秘密情報の検査をする。
