import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export function buildWrangler(hub) {
  for (const key of ['organizationName','domain','adminEmail','mailFrom','workerName','d1DatabaseId','r2BucketName']) {
    if (typeof hub[key] !== 'string' || !hub[key].trim()) throw new Error(`Missing ${key} in hub.config.json`);
  }
  if (!/^[a-z0-9-]+$/.test(hub.workerName)) throw new Error('workerName must use lowercase letters, digits and hyphens');
  if (hub.emailRoutingEnabled && !hub.emailRouteAddress) throw new Error('emailRouteAddress is required when emailRoutingEnabled');
  if (hub.emailRouteAddress) {
    const parts=hub.emailRouteAddress.split('@');
    if (parts.length!==2 || !parts[0] || parts[0].includes('+') || parts[1]!==hub.domain) throw new Error('emailRouteAddress must be one literal address on domain');
  }
  if(hub.logoOnDarkUrl && !(hub.logoOnDarkUrl.startsWith('/')&&!hub.logoOnDarkUrl.startsWith('//')) && !/^https:\/\//.test(hub.logoOnDarkUrl))throw new Error('logoOnDarkUrl must use HTTPS or a local path');
  if(hub.logoUrl && !(hub.logoUrl.startsWith('/')&&!hub.logoUrl.startsWith('//')) && !/^https:\/\//.test(hub.logoUrl))throw new Error('logoUrl must use HTTPS or a local path');
  const publicHub = Object.fromEntries(['logoOnDarkUrl','logoUrl','appOrigin','organizationName','domain','adminEmail','mailFrom','fileTransferUrl','calendarUrl','emailProvider','emailRouteAddress'].filter(key=>hub[key]!==undefined).map(key=>[key,hub[key]]));
  const result = {
    $schema:'./node_modules/wrangler/config-schema.json',
    name:hub.workerName,
    main:'src/server/worker.ts',
    compatibility_date:'2026-11-08',
    assets:{directory:'./dist',binding:'ASSETS',not_found_handling:'single-page-application',run_worker_first:['/api/*','/_theid/*']},
    d1_databases:[{binding:'DB',database_name:hub.d1DatabaseName||`${hub.workerName}-db`,database_id:hub.d1DatabaseId,migrations_dir:'migrations'}],
    r2_buckets:[{binding:'FILES',bucket_name:hub.r2BucketName}],
    durable_objects:{bindings:[{name:'LIVE',class_name:'UserLive'}]},
    migrations:[{tag:'v1',new_sqlite_classes:['UserLive']}],
    vars:{HUB_CONFIG:JSON.stringify(publicHub)},
    observability:{enabled:true},
  };
  if(hub.theid){
    const id=hub.theid;
    if(Object.keys(id).some(k=>!['mode','issuer','clientId','appId','authPolicy'].includes(k)))throw new Error('Unknown identity option; secrets belong in Worker secrets');
    if(!['local','hybrid','oidc'].includes(id.mode))throw new Error('Invalid identity mode');
    result.vars.THEID_MODE=id.mode;
    if(id.mode!=='local'){
      if(!hub.appOrigin||new URL(hub.appOrigin).protocol!=='https:')throw new Error('SSO requires HTTPS appOrigin');
      const issuer=new URL(id.issuer);
      if(issuer.protocol!=='https:'||issuer.pathname!=='/api/auth'||issuer.username||issuer.password||issuer.search||issuer.hash||!id.clientId||!id.appId)throw new Error('Invalid identity configuration');
      if(id.authPolicy&&!['standard','mfa'].includes(id.authPolicy))throw new Error('Invalid identity policy');
      Object.assign(result.vars,{THEID_ISSUER:id.issuer,THEID_CLIENT_ID:id.clientId,THEID_APP_ID:id.appId,THEID_AUTH_POLICY:id.authPolicy||'standard'});
    }
  }
  if(hub.crmUrl){if(!hub.appOrigin||new URL(hub.appOrigin).protocol!=='https:')throw new Error('appOrigin must use HTTPS when CRM is enabled');if(new URL(hub.crmUrl).protocol!=='https:')throw new Error('crmUrl must use HTTPS');result.vars.CRM_URL=hub.crmUrl;}
  if (hub.accountId) result.account_id=hub.accountId;
  if (hub.vapidPublicKey) result.vars.VAPID_PUBLIC_KEY=hub.vapidPublicKey;
  if (hub.vapidSubject) result.vars.VAPID_SUBJECT=hub.vapidSubject;
  if (hub.customDomain) result.routes=[{pattern:hub.customDomain,custom_domain:true}];
  if (hub.emailRoutingEnabled && hub.emailRouteAddress) result.addresses=[hub.emailRouteAddress];
  else if (hub.emailCatchAll) result.addresses=[`*@${hub.domain}`];
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
