ALTER TYPE "RecruitmentConversationState" ADD VALUE 'REGIONS';
ALTER TYPE "RecruitmentConversationState" ADD VALUE 'EXPERIENCE_KIND';
ALTER TYPE "RecruitmentConversationState" ADD VALUE 'CONFIRMATION';
ALTER TYPE "RecruitmentConversationState" ADD VALUE 'EDIT_SELECTION';
ALTER TABLE "RecruitmentConversation" ADD COLUMN "editingAnswer" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "RecruitmentLead" ADD COLUMN "serviceRegions" TEXT;
