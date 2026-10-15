import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  admin: vi.fn(),
  control: vi.fn(),
  resume: vi.fn(),
  dispatch: vi.fn(),
  revalidate: vi.fn(),
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@/infrastructure/auth/auth", () => ({
  auth: { api: { getSession: mocks.session } },
}));
vi.mock("@/infrastructure/db/prisma-client", () => ({
  prisma: { user: { findFirst: mocks.admin } },
}));
vi.mock("@/application/customer/customer-booking-conversation.usecase", () => ({
  controlCustomerConversation: mocks.control,
  resumeCustomerBookingConversation: mocks.resume,
}));
vi.mock("@/infrastructure/jobs/publish-job", () => ({
  publishJobSafe: mocks.dispatch,
}));
import { controlCustomerConversationAction } from "./actions";

const conversationId = "803cb181-4963-4b28-b2ec-e660b0fa041d";
describe("customer conversation server actions", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.session.mockResolvedValue({ user: { email: "admin@test.local" } });
    mocks.admin.mockResolvedValue({ email: "admin@test.local" });
    mocks.control.mockResolvedValue({ ok: true, value: { conversationId } });
    mocks.resume.mockResolvedValue({ ok: true, value: { conversationId } });
    mocks.dispatch.mockResolvedValue(undefined);
  });
  it.each(["pause", "resume", "step", "restart", "close"] as const)(
    "requires an ADMIN for %s",
    async (action) => {
      mocks.admin.mockResolvedValue(null);
      expect(
        (
          await controlCustomerConversationAction({
            conversationId,
            expectedVersion: 3,
            action,
          })
        ).ok
      ).toBe(false);
      expect(mocks.admin).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { email: "admin@test.local", role: "ADMIN" },
        })
      );
      expect(mocks.control).not.toHaveBeenCalled();
      expect(mocks.resume).not.toHaveBeenCalled();
    }
  );
  it("rejects anonymous sessions", async () => {
    mocks.session.mockResolvedValue(null);
    expect(
      (
        await controlCustomerConversationAction({
          conversationId,
          expectedVersion: 3,
          action: "pause",
        })
      ).ok
    ).toBe(false);
    expect(mocks.control).not.toHaveBeenCalled();
  });
  it("validates IDs and versions before invoking the use case", async () => {
    expect(
      (
        await controlCustomerConversationAction({
          conversationId: "invalid",
          expectedVersion: -1,
          action: "restart",
        })
      ).ok
    ).toBe(false);
    expect(mocks.control).not.toHaveBeenCalled();
  });
  it("supplies the authenticated actor, revalidates both pages and schedules outbox dispatch", async () => {
    expect(
      (
        await controlCustomerConversationAction({
          conversationId,
          expectedVersion: 3,
          action: "step",
          step: "NAME",
        })
      ).ok
    ).toBe(true);
    expect(mocks.control).toHaveBeenCalledWith(expect.anything(), {
      conversationId,
      expectedVersion: 3,
      actor: "admin@test.local",
      action: "step",
      step: "NAME",
    });
    expect(mocks.revalidate).toHaveBeenCalledWith(
      `/admin/customer-conversations/${conversationId}`
    );
    expect(mocks.revalidate).toHaveBeenCalledWith(
      "/admin/customer-conversations"
    );
    expect(mocks.dispatch).toHaveBeenCalled();
  });
  it("reuses the resume use case", async () => {
    await controlCustomerConversationAction({
      conversationId,
      expectedVersion: 3,
      action: "resume",
    });
    expect(mocks.resume).toHaveBeenCalled();
    expect(mocks.control).not.toHaveBeenCalled();
  });
  it("returns actionable domain errors without dispatching", async () => {
    mocks.control.mockResolvedValue({ ok: false, error: "A conversa mudou." });
    expect(
      await controlCustomerConversationAction({
        conversationId,
        expectedVersion: 3,
        action: "pause",
      })
    ).toEqual({ ok: false, error: "A conversa mudou." });
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });
  it("converts unexpected transaction failures to UI feedback", async () => {
    mocks.control.mockRejectedValue(new Error("database unavailable"));
    expect(
      (
        await controlCustomerConversationAction({
          conversationId,
          expectedVersion: 3,
          action: "pause",
        })
      ).ok
    ).toBe(false);
  });
});
