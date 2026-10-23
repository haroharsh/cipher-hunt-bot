import fs from 'node:fs';
import path from 'node:path';
import { AttachmentBuilder, GuildMember, Message, PermissionFlagsBits } from 'discord.js';
import { prisma } from './db';
import { config } from './config';
import * as game from './game';
import { rankTeams } from './rank';
import { logEvent } from './logger';
import type { LeaderboardUpdater } from './leaderboard';

const seen = new Set<string>(); // in-process duplicate-event guard (DB constraints are the real guard)
const PLAYER = new Set(['cipher', 'answer', 'pass']);
const ADMIN = new Set(['start', 'stop', 'resume', 'leaderboard', 'status', 'team', 'reset', 'export', 'adjust', 'config']);

const HELP = [
  '**Player commands**',
  '`./cipher` — get your next question',
  '`./answer <text>` — answer your active question (wrong answers cost 2 points)',
  '`./pass` — pass your active question (other teams get +20; one more of your questions is forfeited)',
  '',
  '**Admin commands**',
  '`./start` `./stop` `./resume` `./leaderboard` `./status` `./team <name>` `./reset confirm` `./export`',
  '`./adjust <delta> <team name>` · `./config floor <n|none>` · `./config autonext <on|off>`',
].join('\n');

function isAdmin(m: GuildMember): boolean {
  return (
    config.adminUserIds.includes(m.id) ||
    m.roles.cache.some((r) => config.adminRoleIds.includes(r.id)) ||
    m.permissions.has(PermissionFlagsBits.Administrator)
  );
}

async function resolveTeam(m: GuildMember) {
  const byUser = await prisma.teamMember.findUnique({ where: { discordUserId: m.id }, include: { team: true } });
  if (byUser) return byUser.team;
  const roleIds = [...m.roles.cache.keys()];
  if (!roleIds.length) return null;
  const teams = await prisma.team.findMany({ where: { roleId: { in: roleIds } } });
  return teams.length === 1 ? teams[0] : null; // ambiguous or none -> reject
}

function resolveImage(ref: string): { files: (string | AttachmentBuilder)[]; note: string } {
  if (/^https?:\/\//.test(ref)) {
    return { files: [ref], note: '' };
  }
  const local = path.resolve(config.imagesDir, ref);
  if (fs.existsSync(local)) {
    return { files: [local], note: '' };
  }
  return { files: [], note: `\n⚠️ *(Image file \`${ref}\` not found on server)*` };
}

const label = (d: string) => d[0] + d.slice(1).toLowerCase();

export async function handleMessage(message: Message, lb: LeaderboardUpdater): Promise<void> {
  if (message.author.bot || !message.guild || !message.content.startsWith(config.prefix)) return;
  const m = /^\.\/(\w+)(?:\s+([\s\S]*))?$/.exec(message.content.trim());
  if (!m) return;
  const cmd = m[1].toLowerCase();
  const args = (m[2] ?? '').trim();
  if (!PLAYER.has(cmd) && !ADMIN.has(cmd) && cmd !== 'help') return;

  if (seen.has(message.id)) return;
  seen.add(message.id);
  if (seen.size > 5000) seen.delete(seen.values().next().value as string);

  const say = (content: string, files?: (string | AttachmentBuilder)[]) =>
    message.reply({ content, files, allowedMentions: { repliedUser: false } });

  try {
    if (cmd === 'help') { await say(HELP); return; }

    const member = message.member ?? (await message.guild.members.fetch(message.author.id));

    // ---------- Admin ----------
    if (ADMIN.has(cmd)) {
      if (!isAdmin(member)) { await say('⛔ You are not authorized to use admin commands.'); return; }
      if (config.adminChannelId && message.channelId !== config.adminChannelId) {
        await say('Admin commands must be used in the admin channel.'); return;
      }
      await logEvent(`ADMIN ${message.author.tag} ran: ${message.content.slice(0, 200)}`);

      switch (cmd) {
        case 'start': {
          const r = await game.adminStart(message.author.id);
          if (!r.ok) { await say(r.error); return; }
          lb.request();
          await say(`✅ Event started: ${r.teams} teams at 100 points, ${r.questions} questions each.`);
          return;
        }
        case 'stop': {
          const r = await game.adminSetStatus('ACTIVE', 'PAUSED');
          if (!r.ok) { await say(r.error); return; }
          lb.request();
          await say('⏸️ Event paused. Gameplay commands are frozen.');
          return;
        }
        case 'resume': {
          const r = await game.adminSetStatus('PAUSED', 'ACTIVE');
          if (!r.ok) { await say(r.error); return; }
          lb.request();
          await say('▶️ Event resumed.');
          return;
        }
        case 'leaderboard':
          lb.request();
          await say('Leaderboard refresh requested.');
          return;
        case 'status': {
          const { ev, teams, groups } = await game.getStatus();
          const lines = rankTeams(teams).map((t) => {
            const id = teams.find((x) => x.name === t.name)!.id;
            const c = (s: string) => groups.find((g) => g.teamId === id && g.state === s)?._count._all ?? 0;
            return `${t.rank}. ${t.name} — ${t.score} pts | avail ${c('AVAILABLE')}, active ${c('ACTIVE')}, solved ${c('SOLVED')}, passed ${c('PASSED')}, forfeited ${c('FORFEITED')}`;
          });
          await say(`**Event:** ${ev.status} | floor: ${ev.scoreFloor ?? 'none'} | auto-next: ${ev.autoAssignNext ? 'on' : 'off'}\n${lines.join('\n')}`);
          return;
        }
        case 'team': {
          if (!args) { await say('Usage: `./team <name>`'); return; }
          const d = await game.getTeamDetail(args);
          if (!d) { await say('Team not found.'); return; }
          const qs = d.questions.map((q) => `${q.questionId} (${label(q.question.difficulty)}) — ${q.state}`).join('\n') || 'none yet';
          const led = d.ledger.map((l) => `${l.type} ${l.delta >= 0 ? '+' : ''}${l.delta}${l.questionId ? ` [${l.questionId}]` : ''}`).join('\n') || 'none';
          await say(`**${d.team.name}** — ${d.team.score} pts, ${d.attempts} attempts\n**Questions:**\n${qs}\n**Last 10 score changes:**\n${led}`);
          return;
        }
        case 'reset': {
          if (args.toLowerCase() !== 'confirm') { await say('This wipes all scores and progress. Run `./reset confirm` to proceed.'); return; }
          const rows = await game.exportLedger(); // keep an audit copy in the log channel
          await logEvent(`RESET by ${message.author.tag}. Ledger entries cleared: ${rows.length}`);
          await game.adminReset();
          lb.request();
          await say('🧹 Event reset. All scores are 0 and the event is inactive. Use `./start` to begin a new event.');
          return;
        }
        case 'export': {
          const rows = await game.exportLedger();
          const csv = ['time,team,type,delta,question,actor,note',
            ...rows.map((r) => [r.createdAt.toISOString(), `"${r.team.name}"`, r.type, r.delta, r.questionId ?? '', r.actorId ?? '', `"${r.note ?? ''}"`].join(','))].join('\n');
          await say('Score ledger export:', [new AttachmentBuilder(Buffer.from(csv), { name: 'ledger.csv' })]);
          return;
        }
        case 'adjust': {
          const am = /^(-?\d+)\s+(.+)$/.exec(args);
          if (!am) { await say('Usage: `./adjust <delta> <team name>`'); return; }
          const team = await prisma.team.findFirst({ where: { name: { equals: am[2], mode: 'insensitive' } } });
          if (!team) { await say('Team not found.'); return; }
          const r = await game.adminAdjust(team.id, Number(am[1]), message.author.id, message.id);
          if (!r.ok) { await say(r.error); return; }
          lb.request();
          await say(`${team.name} adjusted by ${r.delta}. New score: ${r.score}.`);
          return;
        }
        case 'config': {
          const [key, val] = args.split(/\s+/);
          if (key === 'floor' && val) {
            const n = val === 'none' ? null : Number(val);
            if (n !== null && !Number.isInteger(n)) { await say('Floor must be an integer or `none`.'); return; }
            await game.adminConfig({ scoreFloor: n });
            await say(`Score floor set to ${n ?? 'none'}.`);
          } else if (key === 'autonext' && (val === 'on' || val === 'off')) {
            await game.adminConfig({ autoAssignNext: val === 'on' });
            await say(`Auto-assign next question: ${val}.`);
          } else await say('Usage: `./config floor <n|none>` or `./config autonext <on|off>`');
          return;
        }
      }
      return;
    }

    // ---------- Player ----------
    const team = await resolveTeam(member);
    if (!team) { await say('You are not assigned to a registered team.'); return; }

    if (cmd === 'cipher') {
      const r = await game.requestCipher(team.id);
      if (!r.ok) { await say(r.error); return; }
      const q = r.question;
      const head = r.resumed
        ? `You already have an active question — answer it with \`./answer\` or use \`./pass\`.`
        : `New question for **${team.name}**!`;
      const img = resolveImage(q.imageRef);
      await say(`${head}\n**${q.id}** — Difficulty: **${label(q.difficulty)}**${img.note}`, img.files);
      return;
    }

    if (cmd === 'answer') {
      if (!args) { await say('Usage: `./answer <your answer>` (no penalty for malformed commands).'); return; }
      const r = await game.submitAnswer(team.id, message.author.id, message.id, args);
      if (!r.ok) { await say(r.error); return; }
      lb.request(); // every accepted attempt, correct or not
      if (r.correct) {
        let text = `✅ Correct! **+${r.delta}** points. **${team.name}** now has **${r.score}**.`;
        if (r.next) {
          const nextImg = resolveImage(r.next.imageRef);
          await say(text + `\nNext question: **${r.next.id}** — ${label(r.next.difficulty)}${nextImg.note}`, nextImg.files);
        } else await say(text + '\nUse `./cipher` for your next question.');
      } else {
        await say(`❌ Incorrect. **${r.delta}** points. **${team.name}** now has **${r.score}**. The question stays active — try again or \`./pass\`.`);
      }
      return;
    }

    if (cmd === 'pass') {
      const r = await game.passQuestion(team.id, message.author.id, message.id);
      if (!r.ok) { await say(r.error); return; }
      lb.request();
      await say(
        `⏭️ **${r.passed}** passed. Each of the other ${r.bonusTeams} teams received +20.` +
          (r.forfeited ? `\nAnother question was also removed from your queue.` : `\nNo extra question was left to remove.`),
      );
      return;
    }
  } catch (e) {
    await logEvent(`ERROR handling "${message.content.slice(0, 100)}": ${String(e)}`);
    await message.reply('Something went wrong processing that command. Admins have been notified.').catch(() => {});
  }
}
