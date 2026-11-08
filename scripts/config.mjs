import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export function buildWrangler(hub) {
  for (const key of ['organizationName','domain','adminEmail','mailFrom','workerName','d1DatabaseId','r2BucketName']) {
    if (typeof hub[key] !== 'string' || !hub[key].trim()) throw new Error(`Missing ${key} in hub.config.json`);
  }
  if (!/^[a-z0-9-]+$/.test(hub.workerName)) throw new Error('workerName must use lowercase letters, digits and hyphens');
  const publicHub = Object.fromEntries(['organizationName','domain','adminEmail','mailFrom','fileTransferUrl','calendarUrl','emailProvider'].filter(key=>hub[key]!==undefined).map(key=>[key,hub[key]]));
  const result = {
    $schema:'./node_modules/wrangler/config-schema.json',
    name:hub.workerName,
    main:'src/server/worker.ts',
    compatibility_date:'2026-11-08',
    assets:{directory:'./dist',binding:'ASSETS',not_found_handling:'single-page-application'},
    d1_databases:[{binding:'DB',database_name:hub.d1DatabaseName||`${hub.workerName}-db`,database_id:hub.d1DatabaseId,migrations_dir:'migrations'}],
    r2_buckets:[{binding:'FILES',bucket_name:hub.r2BucketName}],
    durable_objects:{bindings:[{name:'LIVE',class_name:'UserLive'}]},
    migrations:[{tag:'v1',new_sqlite_classes:['UserLive']}],
    vars:{HUB_CONFIG:JSON.stringify(publicHub)},
    observability:{enabled:true},
    triggers:{crons:['*/5 * * * *']},
  };
  if (hub.accountId) result.account_id=hub.accountId;
  if (hub.vapidPublicKey) result.vars.VAPID_PUBLIC_KEY=hub.vapidPublicKey;
  if (hub.vapidSubject) result.vars.VAPID_SUBJECT=hub.vapidSubject;
  if (hub.customDomain) result.routes=[{pattern:hub.customDomain,custom_domain:true}];
  if (hub.emailCatchAll) result.addresses=[`*@${hub.domain}`];
  if (hub.emailProvider==='cloudflare') result.send_email=[{name:'EMAIL'}];
  if (hub.eventsQueueName) result.queues={producers:[{binding:'EVENTS_QUEUE',queue:hub.eventsQueueName}]};
  return result;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const path=process.argv[2]||'hub.config.json';
  const hub=JSON.parse(await readFile(path,'utf8'));
  await writeFile('wrangler.jsonc',JSON.stringify(buildWrangler(hub),null,2)+'\n',{mode:0o600});
  console.log('Generated ignored wrangler.jsonc');
}
