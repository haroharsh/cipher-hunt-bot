import type { Client } from 'discord.js';
import { config } from './config';

let client: Client | null = null;
export const setLogClient = (c: Client) => { client = c; };

export async function logEvent(msg: string): Promise<void> {
  console.log(`[${new Date().toISOString()}] ${msg}`);
  if (!client || !config.logChannelId) return;
  try {
    const ch = await client.channels.fetch(config.logChannelId);
    if (ch && ch.isSendable()) await ch.send(msg.slice(0, 1900));
  } catch (e) {
    console.error('Failed to write to log channel', e);
  }
}
