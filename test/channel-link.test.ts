import{it,expect,vi}from'vitest';
import{copyChannelLink}from'../src/client/channel-link';
it('reports success after clipboard write finishes',async()=>{const writeText=vi.fn().mockResolvedValue(undefined);expect(await copyChannelLink('https://chat.example.com/?channel=abc',{writeText})).toBe(true);expect(writeText).toHaveBeenCalledWith('https://chat.example.com/?channel=abc')});
it('reports fallback when clipboard permission is rejected',async()=>{expect(await copyChannelLink('https://chat.example.com/?channel=abc',{writeText:vi.fn().mockRejectedValue(new Error('NotAllowedError'))})).toBe(false)});
it('reports fallback when clipboard API is unavailable',async()=>{expect(await copyChannelLink('https://chat.example.com/?channel=abc',undefined)).toBe(false)});
