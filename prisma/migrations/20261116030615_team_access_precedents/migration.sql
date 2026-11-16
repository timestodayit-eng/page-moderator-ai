-- AlterTable
ALTER TABLE "AgentVersion" ADD COLUMN     "credentialId" TEXT;

-- AlterTable
ALTER TABLE "AiCredential" ADD COLUMN     "ownerUserId" TEXT;

-- AlterTable
ALTER TABLE "CommentClassification" ADD COLUMN     "precedentId" TEXT;

-- AlterTable
ALTER TABLE "Invitation" ADD COLUMN     "allowedPageIds" TEXT[],
ADD COLUMN     "maxAgents" INTEGER,
ADD COLUMN     "maxPages" INTEGER,
ADD COLUMN     "pageAccess" TEXT NOT NULL DEFAULT 'ALL';

-- AlterTable
ALTER TABLE "Membership" ADD COLUMN     "allowedPageIds" TEXT[],
ADD COLUMN     "maxAgents" INTEGER,
ADD COLUMN     "maxPages" INTEGER,
ADD COLUMN     "pageAccess" TEXT NOT NULL DEFAULT 'ALL';

-- CreateTable
CREATE TABLE "ModerationPrecedent" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "pageId" TEXT,
    "text" TEXT NOT NULL,
    "normalizedText" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "sourceCommentId" TEXT,
    "sourceDecisionId" TEXT,
    "createdById" TEXT,
    "hits" INTEGER NOT NULL DEFAULT 0,
    "lastHitAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModerationPrecedent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ModerationPrecedent_workspaceId_status_idx" ON "ModerationPrecedent"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "ModerationPrecedent_workspaceId_pageId_idx" ON "ModerationPrecedent"("workspaceId", "pageId");

-- AddForeignKey
ALTER TABLE "ModerationPrecedent" ADD CONSTRAINT "ModerationPrecedent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
