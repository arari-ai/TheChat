# 設計判断の変更

## 2026-11-08: DMARC未設定の受信メール

Cloudflare Email Routingに届いた試験メールでSPFとDKIMがpass、DMARCがnoneとなり、従来の「3件ともpass」判定で保留された。Cloudflareが先頭に付与した認証結果に限って信用し、DMARCがpassなら受信する。DMARCがnoneの場合はSPFとDKIMがともにpassで、SMTPの差出人とメール本文のFromアドレスが一致する場合に限って受信する。DMARCがfailのメールは引き続き保留する。保留したメールの本文は保存していないため自動再処理はできず、管理者に保留件数を表示して再送を案内する。

## 2026-11-08: スペースの参加者管理

スペースの「参加者・招待」に参加者の表示名、ロール、参加方法を表示する。メールアドレスと保留中の招待は管理者だけに表示する。管理者は明示的に参加しているメンバー・ゲストをそのスペースから外せる。アカウントや過去の投稿は削除せず、共有スペースがなくなればDMへのアクセスも失う。管理者と「全メンバー参加」で自動参加しているメンバーは個別に外せない。ロールは組織共通のため、招待時にメンバーを選ぶと既存ゲストのロールも組織全体でメンバーに変わる。

## 2026-11-08: スペースとチャンネルのアーカイブ

第1段階のチャンネルには既に `archived` があったが、操作と復元手段がなかった。管理者がスペース・チャンネルをアーカイブし、プロフィールの一覧から復元できるようにする。メッセージは削除せず、アーカイブ中は投稿・受信メール・通知・検索から除外する。スペースをアーカイブした場合は配下のチャンネルも利用停止し、復元時は個別のチャンネルのアーカイブ状態を維持する。

## 2026-11-08: 画面内通知とリアクション

未読イベントを画面内の通知一覧へ表示し、選択すると対象の会話へ移動する。リアクションは選択状態と件数を表示し、再押下で解除できるようにする。通知とリアクションの操作結果が見えるようにするためのUI変更で、通知対象の設計は変えない。

## 2026-11-08: CIのD1バックアップ

設計書13章は更新前にD1をエクスポートする手順を提案している。GitHub Actionsでそれを実行すると、顧客データがCloudflareアカウント外のランナーへ移る。4章のデータ境界を優先し、CIはD1 Time Travelの復旧点を記録し、マイグレーション時のCloudflare側バックアップを使う。DB復旧は別途人が影響範囲を確認して行う。

## 2026-11-08: メッセージID

設計書12章のULID例の代わりに、D1で採番した連番を16桁にして使う。複数Workerが同一ミリ秒に投稿しても、カーソルが逆転して取りこぼさないため。

## 2026-11-08: 既存メールを使う組織の受信先

ルートドメインのMXを別のメールサービスが使う場合、TheChatの受信先を専用サブドメインへ分離する。サブドメインではcatch-allを使わず、1件の固定受信アドレスにプラスアドレスを付けてチャンネルを識別する。既存MXを変更せず、Email Routingとプラスアドレスの動作を確認してから受信ルールを有効にする。

## 2026-11-08: 利用者の依頼によるTheCRM連携

CRMの画面確認後の依頼に従い、従来の第1段階に案件連携を追加する。明示的に紐付けたチャンネルの新規投稿・受信メール・メール送信に成功した返信だけをCRMへ送る。DM・過去の履歴・未連携チャンネルは送らない。CRMの担当者のメールアドレスでTheChatのロールと参加権限も確認し、ゲストによる連携管理は拒否する。CRMから作る会社スペースは非公開とし、顧客の招待は利用者が操作した場合だけメールを送る。

投稿保存と同じD1バッチで不変の送信待ちデータを記録する。通信失敗時は既存UserLiveの専用インスタンスのAlarmで1分から最大1時間の間隔で再試行する。Cron枠は追加しない。CRM側で重複を無視するため、応答を受け取れず再送した場合も記録は増えない。送信失敗した返信はメール送信済みと表示せずチャットの記録として送る。連携解除とアーカイブ後の未送信分は送信を取り消すが、投稿・過去のCRM記録は削除しない。投稿の後編集・削除はCRMの記録を後から書き換えない。

## 2026-11-09: 組織ロゴの表示

利用者の依頼で、導入設定のlogoUrlとlogoOnDarkUrlをログイン画面・サイドバー・狭い画面に表示する。暗いサイドバーでは白文字の正式素材を使う。組織名や導入URLは引き続き管理外の設定に置き、未設定の導入先の表示は維持する。ARARIの正式SVGは利用者が指定したDrive素材をそのまま使用し、比率・色・字形を変えない。

## 外部の人事・ID管理連携
利用停止日時を追加し、既存セッション・通知・候補の境界で無効化する。最後の有効な管理者はD1トランザクション内で保護する。会話と未対応依頼は保持する。配備固有のキーは導入リポジトリで管理する。

## Optional TheID SSO and external guests
Explicit suite rollout request extends the original scope. TheID owns identity and employee grants; native users, admin/member/guest roles, space memberships and disabled state remain authoritative. Map only existing IDs through authenticated signed protocol, never email auto-merge or role inheritance. Optional local/hybrid/oidc modes retain standalone behavior; unmanaged native guests retain a separate entry even in oidc or incomplete provider setup. Mapping tombstones block old email/cookie login even after unlink. Authentication is checked before invitation mutations.

Portable adapter0.1.2 uses only prefixed identity tables in the application's D1. A server-owned hashed session context is attached to each WebSocket and revalidated before every private broadcast and incoming ping. Old/missing attachments fail closed. Native logout/disabled state and provider revocation affect existing connections; client heartbeat checks idle sessions every30 seconds. No new Durable Object alarms or notification/CRM schedules. The full browser close handshake can remain CLOSING until peer reply; zero open server connections and no private output are enforced independently. New protocol endpoints run before assets; browser WebSocket handshakes require same origin. Native app logout clears both local app sessions, without signing out other apps.

## Explicit identity selection and dual app logout
SSO selects its native account when both cookies are present; a revoked SSO session never silently falls back to another native identity. The successful callback clears the alternate native cookie, and explicit native verification deletes and clears the previous SSO session. Both app logout URLs route to the host's dual-session handler, so neither cookie can restore a different identity after logout. Native guest permissions and machine integrations remain independent. Regression tests cover competing member/admin identities and old socket/session invalidation.

## 2026-11-15: SSOと単体ログインの境界

ネイティブ利用者の停止・削除時にアプリのSSOセッションも破棄し、再有効化で古いログインを復活させない。過去の停止履歴から判定できないセッションは追加マイグレーションでアプリSSOのみ一度破棄する。中央TheIDと社外ゲストの単体ログインは維持する。空・非正規表記のSSO Cookieがあっても別の単体管理者へ切り替えない。固定OIDCパスの符号化表記は処理前に拒否し、正規コールバックでは切り替え前の単体セッション行を失効させる。WebSocketの再認証も同じ失効状態を参照する。

## 2026-11-15: 入社時の任意アプリ登録

利用者の明示依頼により、第1段階の範囲をHRMからの入社登録へ拡張する。公開APIと既存Bearer権限は拡大せず、無効が既定の専用Worker entrypointで受け付ける。一般社員はmember、管理者は明示選択の場合だけ作成する。メール一致で既存ゲストや会話参加権限を引き継がず、対応が必要なら管理者確認とする。TheID管理の新規利用者は対応付け途中・停止時にネイティブログインへ迂回できない。単体導入と既存ゲストの入口を維持する。

## 2026-11-16: 同一ゾーンのTheIDへの取得経路

生成するWorker設定に `global_fetch_strictly_public` を明示する。同一ゾーンで公開されたTheIDのJWKSなどへのfetchを公開Workerへ送り、従来のプライベートオリジン経路による到達失敗を避ける。署名検証、issuer、認可、既存の接続先は変更しない。TheDecisionで確認した同一ゾーンJWKS取得の522と同じ配置条件を持つため、TheChatでも経路を明示する。実際の本番復旧は公開後に確認する。

## 2026-11-16: 任意の中央表示名同期

明示的に対応付けた既存利用者のみ、署名付きの氏名更新を受け付ける。SDK 0.1.4の対応付け・版・重複検査とネイティブ利用停止検査を同じD1トランザクションで適用する。更新対象はusers.nameのみで、メール、ロール、会話参加、ゲストの単体ログインには変更を加えない。

## 2026-11-16: 最新投稿の表示と投稿者による編集・削除

利用者の依頼により、チャンネル・DM・返信は時系列のまま最新位置で開く。過去閲覧中の更新と過去ページの追加では、表示中の投稿を基準に位置を維持する。更新時も読み込み済みの範囲を再取得し、古い投稿の編集・削除を反映する。

投稿者本人だけに本文の編集・削除を許可する。APIでも現在の参加権限・停止状態・投稿者を検証し、書込み時にも参加権限を条件にする。本文編集は元の本文との比較で競合を拒否し、タグ・宛先・応答状態は変更しない。削除はdeleted_atで記録し、本文・添付・検索・未読通知・要対応から除外する。返信付き親投稿は内容を除いた「削除された投稿」として返し、他人の返信は維持する。利用者の追加確認に従い、残った返信もそれを書いた本人が編集・削除できる。受信メールは編集対象にしない。送信済みメールとCRMの不変の送信記録・履歴は従来どおり取り消さない。更新イベントは再通知しない。
