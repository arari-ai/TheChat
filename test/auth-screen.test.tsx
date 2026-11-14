import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it,vi} from 'vitest';
import {Auth} from '../src/client/app';
it('keeps guest code entry separate from optional employee SSO',()=>{
 vi.stubGlobal('location',{search:''});
 const props={organizationName:'Example',onLogin:()=>{}};
 const standalone=renderToStaticMarkup(createElement(Auth,props));
 expect(standalone).not.toContain('/api/auth/oidc/start');expect(standalone).toContain('コードを送る');
 const combined=renderToStaticMarkup(createElement(Auth,{...props,ssoEnabled:true}));
 expect(combined).toContain('/api/auth/oidc/start');expect(combined).toContain('社員の方');expect(combined).toContain('ゲスト');expect(combined).toContain('コードを送る');
 vi.unstubAllGlobals();
});
