import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
it('uses example addresses in distributable mail authentication fixtures',()=>{
 const fixture=readFileSync(new URL('./mail.test.ts',import.meta.url),'utf8');
 const addresses=fixture.match(/[a-z0-9._+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi)||[];
 expect(addresses.length).toBeGreaterThan(0);
 expect(addresses.every(address=>address.endsWith('@example.com'))).toBe(true);
});
