import assert from 'node:assert/strict';
const origin=process.argv[2];if(!origin||new URL(origin).protocol!=='https:')throw new Error('Pass an HTTPS deployment origin');
const health=await fetch(new URL('/api/health',origin));assert.equal(health.status,200);assert.equal((await health.json()).ok,true);
const page=await fetch(origin);assert.equal(page.status,200);assert.match(await page.text(),/id="root"/);
const blocked=await fetch(new URL('/api/spaces',origin));assert.equal(blocked.status,401);
const live=await fetch(new URL('/api/live',origin));assert.equal(live.status,401);
console.log('Deployment smoke passed: health, page, private API and WebSocket guard');
