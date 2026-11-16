import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MessageCard } from '../src/client/app';
import type { Message, User } from '../src/client/api';

const me: User = { id: 'me', email: 'me@example.com', name: 'Me', role: 'member', affiliation: null };
const message: Message = {
  id: '1', channel_id: 'channel', dm_id: null, thread_root_id: null,
  author_id: 'me', author_name: 'Me', external_name: null, external_email: null,
  author_affiliation: null, body: '本文', intent: null, due_date: null,
  source: 'app', status: 'open', addressees: '[]', addressee_status: '{}',
  created_at: '2026-11-08 10:00:00', mail_subject: null, reactions: '[]', reply_count: 2,
};
const onReact = async () => {};
const onThread = () => {};

describe('message thread action', () => {
  it('shows the thread action on a channel message', () => {
    const html = renderToStaticMarkup(createElement(MessageCard, { message, me, onReact, onThread }));
    expect(html).toContain('スレッドを開く');
    expect(html).toContain('2件の返信');
  });

  it('does not show a thread action inside an open thread', () => {
    const html = renderToStaticMarkup(createElement(MessageCard, { message, me, onReact, onThread, compact: true }));
    expect(html).not.toContain('スレッドを開く');
  });
});

describe('author message controls',()=>{
 it('offers editing and deletion only for the current author',()=>{
  const own=renderToStaticMarkup(createElement(MessageCard,{message,me,onReact,onChanged:()=>{}}));
  expect(own).toContain('投稿を編集');expect(own).toContain('投稿を削除');
  const other=renderToStaticMarkup(createElement(MessageCard,{message:{...message,author_id:'other'},me,onReact,onChanged:()=>{}}));
  expect(other).not.toContain('投稿を編集');expect(other).not.toContain('投稿を削除');
 });
 it('renders deleted parents without body, attachments or action controls but keeps replies reachable',()=>{
  const html=renderToStaticMarkup(createElement(MessageCard,{message:{...message,deleted_at:'2026-11-16',body:'secret',attachment_list:'[{"id":"f","filename":"secret.txt"}]'},me,onReact,onThread,onChanged:()=>{}}));
  expect(html).toContain('削除された投稿');expect(html).toContain('スレッドを開く');
  expect(html).not.toContain('secret');expect(html).not.toContain('ありがとう');expect(html).not.toContain('投稿を編集');
 });
 it('shows edited status without interpreting message text as HTML',()=>{
  const html=renderToStaticMarkup(createElement(MessageCard,{message:{...message,edited_at:'2026-11-16',body:'<script>alert(1)</script>\n次の行'},me,onReact}));
  expect(html).toContain('編集済み');expect(html).not.toContain('<script>');expect(html).toContain('次の行');
 });
});
