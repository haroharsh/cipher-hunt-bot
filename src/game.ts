import { Prisma, Difficulty, LedgerType, Question } from '@prisma/client';
import { randomInt } from 'node:crypto';
import { prisma } from './db';
import { config } from './config';
import { normalize } from './normalize';

type Tx = Prisma.TransactionClient;
export type Fail = { ok: false; error: string };
const fail = (error: string): Fail => ({ ok: false, error });

export const POINTS: Record<Difficulty, number> = { EASY: 150, MEDIUM: 250, HARD: 400 };
export const WRONG_PENALTY = -2;
export const PASS_BONUS = 20;
export const START_SCORE = 100;

const pick = <T>(arr: T[]): T => arr[randomInt(arr.length)];

/** All state-changing operations run in one transaction under a global advisory lock. */
async function locked<R>(fn: (t: Tx) => Promise<R>): Promise<R | Fail> {
  try {
    return await prisma.$transaction(
      async (t) => {
        await t.$executeRaw`SELECT pg_advisory_xact_lock(7355608)`;
        return fn(t);
      },
      { timeout: 20_000, maxWait: 20_000 },
    );
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return fail('Duplicate command ignored.');
    }
    throw e;
  }
}

const getEvent = (t: Tx) => t.event.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });

async function applyDelta(
  t: Tx,
  teamId: number,
  type: LedgerType,
  delta: number,
  floor: number | null,
  o: { commandId: string; questionId?: string; actorId?: string; note?: string },
) {
  const team = await t.team.findUniqueOrThrow({ where: { id: teamId } });
  let next = team.score + delta;
  if (delta < 0 && floor !== null) {
    next = Math.max(next, floor);
    if (next > team.score) next = team.score; // floor never raises a score
  }
  const actual = next - team.score;
  await t.ledger.create({ data: { teamId, type, delta: actual, ...o } });
  if (actual !== 0) await t.team.update({ where: { id: teamId }, data: { score: next } });
  return { score: next, delta: actual };
}

async function assignNext(t: Tx, teamId: number): Promise<Question | null> {
  const eligible = await t.teamQuestion.findMany({
    where: { teamId, state: 'AVAILABLE', question: { active: true } },
    include: { question: true },
  });
  if (!eligible.length) return null;
  const c = pick(eligible);
  await t.teamQuestion.update({
    where: { teamId_questionId: { teamId, questionId: c.questionId } },
    data: { state: 'ACTIVE' },
  });
  return c.question;
}

// ---------------- Player actions ----------------

export async function requestCipher(teamId: number) {
  return locked(async (t) => {
    const ev = await getEvent(t);
    if (ev.status !== 'ACTIVE') return fail('The event is not active right now.');
    const active = await t.teamQuestion.findFirst({
      where: { teamId, state: 'ACTIVE' },
      include: { question: true },
    });
    if (active) return { ok: true as const, resumed: true, question: active.question };
    const q = await assignNext(t, teamId);
    if (!q) return fail('Your question queue is exhausted — no more questions are available to your team.');
    return { ok: true as const, resumed: false, question: q };
  });
}

export async function submitAnswer(teamId: number, userId: string, messageId: string, text: string) {
  return locked(async (t) => {
    const ev = await getEvent(t);
    if (ev.status !== 'ACTIVE') return fail('The event is not active right now.');
    const active = await t.teamQuestion.findFirst({
      where: { teamId, state: 'ACTIVE' },
      include: { question: true },
    });
    if (!active) return fail('Your team has no active question. Use `./cipher` to get one.');
    const q = active.question;
    const submitted = normalize(text, config.normalize);
    const correct = q.answers.some((a) => normalize(a, config.normalize) === submitted);

    await t.attempt.create({
      data: { teamId, questionId: q.id, userId, submitted: text.slice(0, 500), correct, messageId },
    });

    let res;
    let next: Question | null = null;
    if (correct) {
      res = await applyDelta(t, teamId, 'CORRECT_ANSWER', POINTS[q.difficulty], ev.scoreFloor, {
        commandId: messageId, questionId: q.id, actorId: userId,
      });
      await t.teamQuestion.update({
        where: { teamId_questionId: { teamId, questionId: q.id } },
        data: { state: 'SOLVED' },
      });
      if (ev.autoAssignNext) next = await assignNext(t, teamId);
    } else {
      res = await applyDelta(t, teamId, 'WRONG_ANSWER', WRONG_PENALTY, ev.scoreFloor, {
        commandId: messageId, questionId: q.id, actorId: userId,
      });
    }
    return { ok: true as const, correct, question: q, delta: res.delta, score: res.score, next };
  });
}

export async function passQuestion(teamId: number, userId: string, messageId: string) {
  return locked(async (t) => {
    const ev = await getEvent(t);
    if (ev.status !== 'ACTIVE') return fail('The event is not active right now.');
    const active = await t.teamQuestion.findFirst({ where: { teamId, state: 'ACTIVE' } });
    if (!active) return fail('Your team has no active question to pass.');

    await t.teamQuestion.update({
      where: { teamId_questionId: { teamId, questionId: active.questionId } },
      data: { state: 'PASSED' },
    });

    const extras = await t.teamQuestion.findMany({
      where: { teamId, state: 'AVAILABLE', question: { active: true } },
    });
    let forfeited: string | null = null;
    if (extras.length) {
      const x = pick(extras);
      forfeited = x.questionId;
      await t.teamQuestion.update({
        where: { teamId_questionId: { teamId, questionId: x.questionId } },
        data: { state: 'FORFEITED' },
      });
    }

    await applyDelta(t, teamId, 'PASS', 0, ev.scoreFloor, {
      commandId: messageId, questionId: active.questionId, actorId: userId,
      note: forfeited ? `forfeited ${forfeited}` : 'no extra question to forfeit',
    });
    const others = await t.team.findMany({ where: { id: { not: teamId } } });
    for (const o of others) {
      await applyDelta(t, o.id, 'PASS_BONUS', PASS_BONUS, ev.scoreFloor, {
        commandId: messageId, questionId: active.questionId, actorId: userId,
        note: `pass by team ${teamId}`,
      });
    }
    return { ok: true as const, passed: active.questionId, forfeited, bonusTeams: others.length };
  });
}

// ---------------- Admin actions ----------------

export async function adminStart(actorId: string) {
  return locked(async (t) => {
    const ev = await getEvent(t);
    if (ev.status !== 'INACTIVE') return fail('Event already started. Use `./reset confirm` before starting a new one.');
    const [teams, questions] = await Promise.all([
      t.team.findMany(),
      t.question.findMany({ where: { active: true } }),
    ]);
    if (!teams.length) return fail('No teams registered. Run the seed script.');
    if (!questions.length) return fail('No active questions configured.');

    await t.attempt.deleteMany();
    await t.ledger.deleteMany();
    await t.teamQuestion.deleteMany();
    await t.team.updateMany({ data: { score: 0 } });
    await t.teamQuestion.createMany({
      data: teams.flatMap((tm) => questions.map((q) => ({ teamId: tm.id, questionId: q.id }))),
    });
    const commandId = `start-${Date.now()}`;
    for (const tm of teams) {
      await applyDelta(t, tm.id, 'INIT', START_SCORE, null, { commandId, actorId });
    }
    await t.event.update({ where: { id: 1 }, data: { status: 'ACTIVE' } });
    return { ok: true as const, teams: teams.length, questions: questions.length };
  });
}

export async function adminSetStatus(from: 'ACTIVE' | 'PAUSED', to: 'ACTIVE' | 'PAUSED') {
  return locked(async (t) => {
    const ev = await getEvent(t);
    if (ev.status !== from) return fail(`Event is ${ev.status}; expected ${from}.`);
    await t.event.update({ where: { id: 1 }, data: { status: to } });
    return { ok: true as const };
  });
}

export async function adminReset() {
  return locked(async (t) => {
    await t.attempt.deleteMany();
    await t.ledger.deleteMany();
    await t.teamQuestion.deleteMany();
    await t.team.updateMany({ data: { score: 0 } });
    await t.event.upsert({ where: { id: 1 }, update: { status: 'INACTIVE' }, create: { id: 1, status: 'INACTIVE' } });
    return { ok: true as const };
  });
}

export async function adminAdjust(teamId: number, delta: number, actorId: string, commandId: string) {
  return locked(async (t) => {
    const ev = await getEvent(t);
    const r = await applyDelta(t, teamId, 'ADMIN_ADJUST', delta, ev.scoreFloor, { commandId, actorId });
    return { ok: true as const, ...r };
  });
}

export async function adminConfig(data: { scoreFloor?: number | null; autoAssignNext?: boolean }) {
  return locked(async (t) => {
    await getEvent(t);
    await t.event.update({ where: { id: 1 }, data });
    return { ok: true as const };
  });
}

// ---------------- Read-only queries ----------------

export async function getStatus() {
  const [ev, teams, groups] = await Promise.all([
    prisma.event.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } }),
    prisma.team.findMany(),
    prisma.teamQuestion.groupBy({ by: ['teamId', 'state'], _count: { _all: true } }),
  ]);
  return { ev, teams, groups };
}

export async function getTeamDetail(name: string) {
  const team = await prisma.team.findFirst({ where: { name: { equals: name, mode: 'insensitive' } } });
  if (!team) return null;
  const [questions, ledger, attempts] = await Promise.all([
    prisma.teamQuestion.findMany({ where: { teamId: team.id, state: { not: 'AVAILABLE' } }, include: { question: true }, orderBy: { updatedAt: 'asc' } }),
    prisma.ledger.findMany({ where: { teamId: team.id }, orderBy: { id: 'desc' }, take: 10 }),
    prisma.attempt.count({ where: { teamId: team.id } }),
  ]);
  return { team, questions, ledger, attempts };
}

export const exportLedger = () => prisma.ledger.findMany({ orderBy: { id: 'asc' }, include: { team: true } });
