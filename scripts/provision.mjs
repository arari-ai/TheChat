import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { buildWrangler } from './config.mjs';

const file=process.argv[2]||'hub.config.json';
const hub=JSON.parse(await readFile(file,'utf8'));
for(const key of ['organizationName','domain','adminEmail','mailFrom','workerName'])if(!hub[key])throw new Error(`Missing ${key}`);
hub.d1DatabaseName ||= `${hub.workerName}-db`;
hub.r2BucketName ||= `${hub.workerName}-files`;
function wrangler(args){return execFileSync('node_modules/.bin/wrangler',args,{encoding:'utf8'});}
let databases=JSON.parse(wrangler(['d1','list','--json']));
let database=databases.find(item=>item.name===hub.d1DatabaseName);
if(!database){wrangler(['d1','create',hub.d1DatabaseName]);databases=JSON.parse(wrangler(['d1','list','--json']));database=databases.find(item=>item.name===hub.d1DatabaseName);}
if(!database)throw new Error('D1 database creation could not be verified');
hub.d1DatabaseId=database.uuid;
const buckets=wrangler(['r2','bucket','list']);
if(!buckets.includes(`name:           ${hub.r2BucketName}`))wrangler(['r2','bucket','create',hub.r2BucketName]);
await writeFile(file,JSON.stringify(hub,null,2)+'\n',{mode:0o600});
await writeFile('wrangler.jsonc',JSON.stringify(buildWrangler(hub),null,2)+'\n',{mode:0o600});
console.log('Provisioned D1 and R2 and generated ignored wrangler.jsonc');
