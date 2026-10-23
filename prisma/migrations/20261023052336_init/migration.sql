-- CreateEnum
CREATE TYPE "EventStatus" AS ENUM ('INACTIVE', 'ACTIVE', 'PAUSED');

-- CreateEnum
CREATE TYPE "Difficulty" AS ENUM ('EASY', 'MEDIUM', 'HARD');

-- CreateEnum
CREATE TYPE "QState" AS ENUM ('AVAILABLE', 'ACTIVE', 'SOLVED', 'PASSED', 'FORFEITED');

-- CreateEnum
CREATE TYPE "LedgerType" AS ENUM ('INIT', 'CORRECT_ANSWER', 'WRONG_ANSWER', 'PASS', 'PASS_BONUS', 'ADMIN_ADJUST');

-- CreateTable
CREATE TABLE "Event" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "status" "EventStatus" NOT NULL DEFAULT 'INACTIVE',
    "scoreFloor" INTEGER,
    "autoAssignNext" BOOLEAN NOT NULL DEFAULT false,
    "leaderboardChannelId" TEXT,
    "leaderboardMessageId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Team" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "roleId" TEXT,
    "score" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamMember" (
    "discordUserId" TEXT NOT NULL,
    "teamId" INTEGER NOT NULL,

    CONSTRAINT "TeamMember_pkey" PRIMARY KEY ("discordUserId")
);

-- CreateTable
CREATE TABLE "Question" (
    "id" TEXT NOT NULL,
    "imageRef" TEXT NOT NULL,
    "difficulty" "Difficulty" NOT NULL,
    "answers" TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Question_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamQuestion" (
    "teamId" INTEGER NOT NULL,
    "questionId" TEXT NOT NULL,
    "state" "QState" NOT NULL DEFAULT 'AVAILABLE',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeamQuestion_pkey" PRIMARY KEY ("teamId","questionId")
);

-- CreateTable
CREATE TABLE "Attempt" (
    "id" SERIAL NOT NULL,
    "teamId" INTEGER NOT NULL,
    "questionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "submitted" TEXT NOT NULL,
    "correct" BOOLEAN NOT NULL,
    "messageId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Attempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ledger" (
    "id" SERIAL NOT NULL,
    "teamId" INTEGER NOT NULL,
    "type" "LedgerType" NOT NULL,
    "delta" INTEGER NOT NULL,
    "questionId" TEXT,
    "actorId" TEXT,
    "commandId" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Ledger_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Team_name_key" ON "Team"("name");

-- CreateIndex
CREATE INDEX "TeamQuestion_teamId_state_idx" ON "TeamQuestion"("teamId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "Attempt_messageId_key" ON "Attempt"("messageId");

-- CreateIndex
CREATE UNIQUE INDEX "Ledger_commandId_teamId_type_key" ON "Ledger"("commandId", "teamId", "type");

-- AddForeignKey
ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamQuestion" ADD CONSTRAINT "TeamQuestion_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamQuestion" ADD CONSTRAINT "TeamQuestion_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attempt" ADD CONSTRAINT "Attempt_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ledger" ADD CONSTRAINT "Ledger_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
