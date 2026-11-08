import type { Env } from './env';
export function formatMessageId(sequence:number):string {return sequence.toString().padStart(16,'0');}
export async function allocateMessageId(env:Env):Promise<string>{
  const result=await env.DB.prepare('INSERT INTO message_sequence DEFAULT VALUES').run();
  if(!result.meta.last_row_id)throw new Error('Could not allocate a message ID');
  return formatMessageId(result.meta.last_row_id);
}
