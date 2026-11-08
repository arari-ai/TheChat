# TheChat

Cloudflare上に組織ごとに設置する、意図が伝わるチャットです。チャンネル、スレッド、DM、自分宛て一覧、メール取り込みと返信を、単一組織用に実装しています。

## 構成

- React + Vite: 同一ドメインのPWA画面
- Hono Worker: 認証、スペース権限、API、Email Routing受信、通知ジョブ
- D1: 会話、ユーザー、既読、通知、添付ファイルのメタデータ
- ユーザー別Durable Object: WebSocket配信。再接続時はD1のイベントログから取り直し
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

ライセンスはオーナーの決定待ちです。公開されているコードを閲覧できますが、再配布条件はまだ定めていません。
