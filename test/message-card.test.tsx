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
