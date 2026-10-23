import { Client, GatewayIntentBits } from 'discord.js';
import { config } from './config';
import { prisma } from './db';
import { LeaderboardUpdater } from './leaderboard';
import { handleMessage } from './commands';
import { logEvent, setLogClient } from './logger';

async function main() {
  if (!config.token) throw new Error('DISCORD_TOKEN is not set');
  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
  });
  const lb = new LeaderboardUpdater(client);
  setLogClient(client);

  client.once('ready', async (c) => {
    await prisma.event.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
    await logEvent(`Logged in as ${c.user.tag}; state restored from database.`);
    lb.request(); // sync the board with committed state after any restart
  });
  client.on('messageCreate', (msg) => void handleMessage(msg, lb));

  process.on('unhandledRejection', (e) => void logEvent(`Unhandled rejection: ${String(e)}`));
  await client.login(config.token);
}

main().catch((e: any) => {
  if (e?.code === 'DisallowedIntents' || String(e).toLowerCase().includes('disallowed intents')) {
    console.error('\n❌ ERROR: Discord "Message Content Intent" is not enabled!');
    console.error('👉 Please go to Discord Developer Portal -> Your Application -> Bot');
    console.error('👉 Scroll down to "Privileged Gateway Intents" and toggle ON "MESSAGE CONTENT INTENT".\n');
  } else {
    console.error('Fatal bot startup error:', e);
  }
  process.exit(1);
});
