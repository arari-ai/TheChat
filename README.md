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
