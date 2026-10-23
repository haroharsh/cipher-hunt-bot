import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { PrismaClient, Difficulty } from '@prisma/client';

const prisma = new PrismaClient();
const load = (p: string) => JSON.parse(readFileSync(p, 'utf8'));

async function main() {
  const { teams } = load('config/teams.json');
  for (const t of teams) {
    const team = await prisma.team.upsert({
      where: { name: t.name },
      update: { roleId: t.roleId || null },
      create: { name: t.name, roleId: t.roleId || null },
    });
    for (const uid of t.userIds ?? []) {
      await prisma.teamMember.upsert({
        where: { discordUserId: uid },
        update: { teamId: team.id },
        create: { discordUserId: uid, teamId: team.id },
      });
    }
  }
  const questions = load('config/questions.json');
  for (const q of questions) {
    const d = String(q.difficulty).toUpperCase() as Difficulty;
    if (!['EASY', 'MEDIUM', 'HARD'].includes(d)) throw new Error(`Bad difficulty for ${q.id}`);
    const data = { imageRef: q.image, difficulty: d, answers: q.answers, active: q.active ?? true };
    await prisma.question.upsert({ where: { id: q.id }, update: data, create: { id: q.id, ...data } });
  }
  await prisma.event.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
  console.log(`Seeded ${teams.length} teams and ${questions.length} questions.`);
}

main().finally(() => prisma.$disconnect());
