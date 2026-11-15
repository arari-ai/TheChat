const apps=['nippou','radio','chat','file','academy','work','calendar','crm','approval','evaluation','hrm'];
const keys=['PROVISIONING_ENABLED','PROVISION_SOURCE_ID','PROVISION_ALLOWED_ORIGIN','PROVISION_IDENTITY_MODE','PROVISION_IDENTITY_ORIGIN','PROVISION_APP_IDS'];
export function isProvisionBinding(binding){return typeof binding==='string'&&(binding.startsWith('PROVISION_')||binding==='SUITE_HRM_IDENTITY')}
function origin(value){if(typeof value!=='string')throw Error('Explicit provisioning origin required');const u=new URL(value);if(u.protocol!=='https:'||u.origin!==value||u.username||u.password||/^(localhost|127\.)/.test(u.hostname)||/(^|\.)example\.(com|org|net)$/.test(u.hostname))throw Error('Exact production provisioning origin required');return value}
export function applyProvisioningConfiguration(config,profile,kind){
 config.vars??={};
 for(const key of Object.keys(config.vars))if(/^PROVISION(?:_|ING_)/.test(key))delete config.vars[key];
 for(const [key,value] of Object.entries(profile.vars??{}))if(/^PROVISION(?:_|ING_)/.test(key)){if(!keys.includes(key)||typeof value!=='string')throw Error('Unknown provisioning setting');config.vars[key]=value}
 const values=config.vars;
 if(values.PROVISIONING_ENABLED!==undefined&&!['true','false'].includes(values.PROVISIONING_ENABLED))throw Error('Explicit provisioning enable flag required');
 const services=(profile.services??[]).filter(s=>isProvisionBinding(s.binding));
 const seen=new Set((config.services??[]).map(s=>s.binding));
 for(const s of services){
  if(!/^[a-z0-9][a-z0-9-]{1,62}$/.test(s.service??'')||seen.has(s.binding))throw Error('Invalid provisioning service');
  const app=s.binding.startsWith('PROVISION_APP_')?s.binding.slice('PROVISION_APP_'.length).toLowerCase():null;
  const valid=kind==='hrm'?(s.binding==='PROVISION_IDENTITY'||app&&apps.includes(app))&&s.entrypoint==='HrmProvisioning':kind==='theid'&&s.binding==='SUITE_HRM_IDENTITY'&&s.entrypoint==='HrmIdentityDirectory';
  if(!valid)throw Error('Provisioning requires the exact named private capability');seen.add(s.binding);
 }
 config.services=[...(config.services??[]),...services];
 if(values.PROVISIONING_ENABLED!=='true')return;
 if(typeof values.PROVISION_SOURCE_ID!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(values.PROVISION_SOURCE_ID))throw Error('Immutable HRM source required');
 if(kind==='theid'){
  origin(values.HRM_ORIGIN);
  const ids=(values.PROVISION_APP_IDS??'').split(',');if(!ids.length||ids.some(id=>!apps.includes(id))||new Set(ids).size!==ids.length)throw Error('Explicit provisioning app allowlist required');
  if(!services.some(s=>s.binding==='SUITE_HRM_IDENTITY'))throw Error('HRM identity directory capability required');
 }else origin(values.PROVISION_ALLOWED_ORIGIN);
 if(kind==='hrm'){
  if(!['local','theid'].includes(values.PROVISION_IDENTITY_MODE))throw Error('Explicit onboarding identity mode required');
  if(values.PROVISION_IDENTITY_MODE==='theid'){
   origin(values.PROVISION_IDENTITY_ORIGIN);
   if(!services.some(s=>s.binding==='PROVISION_IDENTITY'))throw Error('TheID provisioning capability required');
  }
  const crons=profile.crons??['* * * * *'];if(!Array.isArray(crons)||crons.length!==1||crons[0]!=='* * * * *')throw Error('Provisioning requires a one-minute resume schedule');
  config.triggers={crons};
 }
}
