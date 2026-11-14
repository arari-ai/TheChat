# TheChat

Cloudflare上に組織ごとに設置する、意図が伝わるチャットです。チャンネル、スレッド、DM、自分宛て一覧、メール取り込みと返信を、単一組織用に実装しています。

未読通知はサイドバーまたは画面下部の「通知」から確認できます。管理者はチャンネル設定またはホームからチャンネル・スペースをアーカイブし、「自分」のアーカイブ一覧から復元できます。アーカイブした会話内容は保存されます。

スペースの「参加者・招待」で参加者とロールを確認し、招待メールを送れます。管理者は保留中の招待を取り消し、明示的に参加している人をそのスペースから外せます。DMの「新しいDM」では共有スペースのある人を名前・所属で探せます。

メールで投稿するときは、スペースの「メール受信」に表示されるチャンネル別アドレスを宛先に指定します。受信した件名・本文・添付ファイルはチャンネルに入り、メールを開いてスレッドから返信すると元の差出人へメールで送られます。管理者はチャンネル右上の設定から受信元を制限できます。

## 構成

- React + Vite: 同一ドメインのPWA画面
- Hono Worker: 認証、スペース権限、API、Email Routing受信、通知ジョブ
- D1: 会話、ユーザー、既読、通知、添付ファイルのメタデータ
- ユーザー別Durable Object: WebSocket配信。再接続時はD1のイベントログから取り直し。通知メールの遅延送信はDurable Object Alarmで実行
- R2: メール添付ファイルのみ。ダウンロードは参加者を確認してから配信

顧客固有の `hub.config.json`、生成した `wrangler.jsonc`、`.dev.vars`、認証情報、D1データはGit管理外です。公開リポジトリには顧客のアカウントIDを入れません。

## 開発

Node.js 24以上を使います。

```sh
npm ci
cp hub.config.example.json hub.config.json
# hub.config.json に自分の値を設定
npm run config
npx wrangler d1 migrations apply DB --local --config wrangler.jsonc
npm run build
npm run worker:dev
```

`DB` は設定のD1バインディング名です。検証には `npm test`、`npm run check`、`npm run build` を実行します。ローカルWorkerがポート8878で起動していれば `node scripts/local-smoke.mjs` が51件のページングと権限境界を試します。

## 導入と更新

手順は [CLAUDE.md](CLAUDE.md) に記載しています。別のAIも [AGENTS.md](AGENTS.md) から同じ手順を参照できます。`node scripts/provision.mjs` はD1とR2の既存リソースを確認してから不足分だけ作成します。リリースはタグで指定し、導入側で固定したコミットを更新します。

## 注意

Cloudflare Email RoutingのDNS、送信用ドメイン、通知鍵は導入先で有効化が必要です。Email RoutingはCloudflareが先頭に追加した `Authentication-Results` だけを信用します。認証に失敗したメールは管理者用の保留一覧に記録します。メール送信はCloudflare Email ServiceまたはResendを選べます。

ライセンスは [MIT](LICENSE) です。

## CRM連携（任意）

導入設定に `appOrigin`（このTheChatのHTTPS公開URL）と `crmUrl`（CRMのHTTPS公開URL）を指定し、`npm run config` で反映します。Cloudflare Secret `CRM_TOKEN` とCRM側の `THECHAT_TOKEN` に同じ十分長い乱数を登録し、CRMの `integration_tokens` にSHA-256を保存してください。トークンを `hub.config.json` やGitに書かないでください。今回追加した `0006_crm.sql` のマイグレーションを適用します。

CRMの案件画面でチャンネルを作成・選択すると、その後の新しい投稿とメールが同期されます。スペース・チャンネルの列挙や作成、紐付け、招待は `POST/GET /api/crm/*` で処理し、共通トークンに加えて担当者本人のTheChat内ロールと参加権限を確認します。顧客招待メールは利用者がCRMで送信を操作した場合だけ送ります。

通常投稿と受信メールはメッセージと送信待ちを同じD1バッチで保存し、Durable ObjectのAlarmで配送します。返信メールは送信成功後に `mail_out`、送信失敗時は通常チャットとして記録します。CRM停止時は送信待ちを保持して再送し、復旧後も重複を作りません。CRMへ送るのは紐付けたチャンネルだけで、DMと過去の履歴は含みません。添付ファイルの本体はCRMへ転送しません。

チャンネルの「リンク」でURLをコピーできます。`?channel=<id>` 付きURLを開くと、ログイン後に権限を確認して該当チャンネルへ移動します。

導入設定の `logoUrl` にHTTPSのロゴURLまたは同じサイト内のパスを設定すると、ログイン画面とサイドバーに組織のロゴを表示できます。省略時は従来の表示を維持します。

外部の人事・ID管理システムから `/api/hrm/*` を利用できます。専用 Secret `HRM_TOKEN` の Bearer 認証が必要です。未設定時は404です。利用停止は会話を残してログイン・通知・招待を停止します。管理者は参加者画面で停止・再開できます。

## Optional TheID employee SSO
Without identity settings TheChat retains its native email-code login and needs no provider. Optional `theid` configuration in the ignored deployment config contains `{mode:"hybrid",issuer:"https://id.example.com/api/auth",clientId:"...",appId:"chat",authPolicy:"standard"}`. Set `THEID_CLIENT_SECRET` separately as a Worker secret; never put it in configuration or source. Apply the additive migration before enabling. `hybrid` retains unmanaged native users; `oidc` requires SSO for staff but preserves unmanaged external guests. Any account once mapped to TheID, including a guest, cannot bypass identity stop via old native login. Standalone `local` deliberately disables SSO.

Register callback `/api/auth/oidc/callback`, backchannel `/api/auth/oidc/backchannel`, launch `/`. Only authenticated admins on TheID may inspect minimal existing-account metadata and explicitly map an immutable local ID. Roles and conversation access remain native. Public health/bootstrap and the guest entry do not require provider availability. Staff configuration errors fail closed.
