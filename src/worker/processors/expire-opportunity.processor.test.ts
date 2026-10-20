import { beforeEach, expect, it, vi } from "vitest";
import type { Job } from "bullmq";
import { prisma } from "@/infrastructure/db/prisma-client";
import { publishJobSafe } from "@/infrastructure/jobs/publish-job";
import { expireOpportunities } from "@/application/marketplace/expire-opportunities.usecase";
import { expireOpportunityProcessor } from "./expire-opportunity.processor";

vi.mock("@/infrastructure/db/prisma-client", () => ({ prisma: { serviceOpportunity: { findUnique: vi.fn() } } }));
vi.mock("@/infrastructure/jobs/publish-job", () => ({ publishJobSafe: vi.fn(async () => {}) }));
vi.mock("@/application/marketplace/expire-opportunities.usecase", () => ({ expireOpportunities: vi.fn() }));
vi.mock("@/infrastructure/observability/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn() } }));

beforeEach(() => vi.clearAllMocks());

it("reagenda um prazo estendido sem consumir retries nem reutilizar o job ativo", async () => {
  const expiresAt = new Date(Date.now() + 4 * 60 * 60_000);
  vi.mocked(prisma.serviceOpportunity.findUnique).mockResolvedValue({ status: "OPEN", expiresAt } as never);
  await expireOpportunityProcessor({ id: "active-job", data: { opportunityId: "offer" } } as Job<{ opportunityId: string }>);
  expect(expireOpportunities).not.toHaveBeenCalled();
  expect(publishJobSafe).toHaveBeenCalledWith(expect.objectContaining({
    jobId: expect.stringContaining(":recheck:active-job"),
    payload: { opportunityId: "offer" }, delay: expect.any(Number),
  }));
});
