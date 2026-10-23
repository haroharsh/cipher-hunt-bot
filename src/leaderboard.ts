import { Client, EmbedBuilder } from 'discord.js';
import { prisma } from './db';
import { config } from './config';
import { logEvent } from './logger';
import { rankTeams } from './rank';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Coalescing updater: any number of request() calls while an update is in flight
 * collapse into one more pass, which always re-reads committed DB state. So the
 * final board always matches the latest committed scores, and a failed edit is
 * retried with backoff (the DB stays authoritative).
 */
export class LeaderboardUpdater {
  private running = false;
  private dirty = false;
  private failures = 0;

  constructor(private client: Client) {}

  request(): void {
    this.dirty = true;
    if (!this.running) void this.loop();
  }

  private async loop(): Promise<void> {
    this.running = true;
    try {
      while (this.dirty) {
        this.dirty = false;
        try {
          await this.push();
          this.failures = 0;
        } catch (e) {
          this.failures++;
          this.dirty = true;
          const delay = Math.min(30_000, 1000 * 2 ** Math.min(this.failures, 5));
          await logEvent(`Leaderboard update failed (attempt ${this.failures}), retrying in ${delay}ms: ${String(e)}`);
          await sleep(delay);
        }
      }
    } finally {
      this.running = false;
    }
  }

  private async render(): Promise<EmbedBuilder> {
    const [teams, ev] = await Promise.all([
      prisma.team.findMany({ select: { name: true, score: true } }),
      prisma.event.findUnique({ where: { id: 1 } }),
    ]);
    const lines = rankTeams(teams).map((t) => `**${t.rank}.** ${t.name} — \`${t.score}\``);
    return new EmbedBuilder()
      .setTitle('🏆 Cipher Hunt — Live Leaderboard')
      .setDescription(lines.join('\n') || 'No teams registered.')
      .setFooter({ text: `Event: ${ev?.status ?? 'INACTIVE'}` })
      .setTimestamp(new Date());
  }

  private async push(): Promise<void> {
    const ev = await prisma.event.findUnique({ where: { id: 1 } });
    const channelId = ev?.leaderboardChannelId ?? config.leaderboardChannelId;
    if (!channelId) return;
    const channel = await this.client.channels.fetch(channelId);
    if (!channel || !channel.isSendable()) throw new Error('Leaderboard channel not found or not sendable');

    const embed = await this.render();
    if (ev?.leaderboardMessageId && ev.leaderboardChannelId === channelId) {
      try {
        const msg = await channel.messages.fetch(ev.leaderboardMessageId);
        await msg.edit({ embeds: [embed] });
        return;
      } catch (e: any) {
        if (e?.code !== 10008) throw e; // only recreate if the message is gone
        await logEvent('Leaderboard message missing; recreating.');
      }
    }
    const sent = await channel.send({ embeds: [embed] });
    await prisma.event.update({
      where: { id: 1 },
      data: { leaderboardChannelId: channelId, leaderboardMessageId: sent.id },
    });
  }
}
