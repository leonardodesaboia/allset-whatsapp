-- CreateEnum
CREATE TYPE "RecruitmentStatus" AS ENUM ('LEAD', 'PRE_CADASTRO', 'TRIAGEM', 'CONVERSA_PENDENTE', 'ENTREVISTA', 'REFERENCIA', 'PRE_APROVADA', 'DOCUMENTACAO', 'ONBOARDING', 'TESTE_OPERACIONAL', 'EM_VALIDACAO', 'ATIVA', 'PREFERENCIAL', 'PRECISA_DE_AJUDA', 'LIGACAO_SOLICITADA', 'BASE_FUTURA', 'AGUARDANDO_COMPLEMENTACAO', 'REPROVADA', 'DESISTIU', 'PAUSADA', 'SUSPENSA');

-- CreateEnum
CREATE TYPE "LeadOrigin" AS ENUM ('META_ADS', 'INSTAGRAM', 'FACEBOOK', 'INDICACAO_PROFISSIONAL', 'INDICACAO_CLIENTE', 'IDT', 'PARCEIRO', 'ORGANICO', 'WHATSAPP', 'CADASTRO_MANUAL', 'OUTRO');

-- CreateEnum
CREATE TYPE "CommunicationMode" AS ENUM ('TEXT', 'AUDIO', 'PHONE', 'MIXED');

-- CreateEnum
CREATE TYPE "InitialChannelPreference" AS ENUM ('WHATSAPP', 'PHONE');

-- CreateEnum
CREATE TYPE "WhatsappAutonomy" AS ENUM ('INDEPENDENT', 'OCCASIONAL_SUPPORT', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "ExperienceDuration" AS ENUM ('LT_1Y', 'Y1_3', 'GT_3Y', 'BY_AUDIO');

-- CreateEnum
CREATE TYPE "AreaCompatibility" AS ENUM ('SIM', 'TALVEZ', 'NAO');

-- CreateEnum
CREATE TYPE "LeadNoteType" AS ENUM ('GERAL', 'ENTREVISTA', 'REFERENCIA', 'DOCUMENTACAO', 'OPERACIONAL', 'PAGAMENTO', 'INCIDENTE', 'FOLLOW_UP');

-- CreateTable
CREATE TABLE "RecruitmentLead" (
    "id" TEXT NOT NULL,
    "status" "RecruitmentStatus" NOT NULL DEFAULT 'LEAD',
    "version" INTEGER NOT NULL DEFAULT 0,
    "phoneE164" TEXT,
    "fullName" TEXT,
    "neighborhood" TEXT,
    "origin" "LeadOrigin" NOT NULL,
    "campaign" TEXT,
    "referralCode" TEXT,
    "partnerName" TEXT,
    "referredByProfessionalId" TEXT,
    "originNote" TEXT,
    "preferredCommunicationMode" "CommunicationMode",
    "initialChannelPreference" "InitialChannelPreference",
    "whatsappAutonomy" "WhatsappAutonomy" DEFAULT 'UNKNOWN',
    "hasProfessionalExperience" BOOLEAN,
    "hasInformalExperience" BOOLEAN,
    "experienceDuration" "ExperienceDuration",
    "canServeInitialArea" "AreaCompatibility",
    "availabilityDays" JSONB,
    "nextAction" TEXT,
    "nextActionAt" TIMESTAMP(3),
    "professionalProfileId" TEXT,
    "lastInteractionAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecruitmentLead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecruitmentStatusHistory" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "fromStatus" "RecruitmentStatus",
    "toStatus" "RecruitmentStatus" NOT NULL,
    "actor" TEXT NOT NULL,
    "reason" TEXT,
    "override" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecruitmentStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadNote" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "type" "LeadNoteType" NOT NULL DEFAULT 'GERAL',
    "content" TEXT NOT NULL,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "editedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "LeadNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadNoteRevision" (
    "id" TEXT NOT NULL,
    "noteId" TEXT NOT NULL,
    "previousContent" TEXT NOT NULL,
    "editedBy" TEXT NOT NULL,
    "editedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadNoteRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadReminder" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "doneAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadReminder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadEvent" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,

    CONSTRAINT "LeadEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RecruitmentLead_professionalProfileId_key" ON "RecruitmentLead"("professionalProfileId");
CREATE INDEX "RecruitmentLead_status_idx" ON "RecruitmentLead"("status");
CREATE INDEX "RecruitmentLead_neighborhood_idx" ON "RecruitmentLead"("neighborhood");
CREATE INDEX "RecruitmentLead_origin_idx" ON "RecruitmentLead"("origin");
CREATE INDEX "RecruitmentLead_nextActionAt_idx" ON "RecruitmentLead"("nextActionAt");
CREATE INDEX "RecruitmentStatusHistory_leadId_idx" ON "RecruitmentStatusHistory"("leadId");
CREATE INDEX "LeadNote_leadId_idx" ON "LeadNote"("leadId");
CREATE INDEX "LeadNoteRevision_noteId_idx" ON "LeadNoteRevision"("noteId");
CREATE INDEX "LeadReminder_leadId_idx" ON "LeadReminder"("leadId");
CREATE INDEX "LeadReminder_dueAt_idx" ON "LeadReminder"("dueAt");
CREATE INDEX "LeadEvent_leadId_idx" ON "LeadEvent"("leadId");

-- AddForeignKey
ALTER TABLE "RecruitmentLead" ADD CONSTRAINT "RecruitmentLead_professionalProfileId_fkey" FOREIGN KEY ("professionalProfileId") REFERENCES "ProfessionalProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RecruitmentStatusHistory" ADD CONSTRAINT "RecruitmentStatusHistory_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "RecruitmentLead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LeadNote" ADD CONSTRAINT "LeadNote_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "RecruitmentLead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LeadNoteRevision" ADD CONSTRAINT "LeadNoteRevision_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "LeadNote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LeadReminder" ADD CONSTRAINT "LeadReminder_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "RecruitmentLead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LeadEvent" ADD CONSTRAINT "LeadEvent_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "RecruitmentLead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
