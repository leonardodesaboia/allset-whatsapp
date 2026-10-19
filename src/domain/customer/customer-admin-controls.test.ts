import { describe, expect, it } from "vitest";
import {
  CUSTOMER_ADMIN_STEPS,
  customerResumeStep,
  isCustomerAdminStep,
} from "./customer-admin-controls";

describe("customer administrative steps", () => {
  it("offers only interactive, persistent customer steps", () => {
    for (const step of CUSTOMER_ADMIN_STEPS)
      expect(isCustomerAdminStep(step)).toBe(true);
    for (const step of [
      null,
      "QUOTE",
      "PAUSED",
      "MANUAL_REVIEW",
      "COMPLETED",
      "INVALID",
    ])
      expect(isCustomerAdminStep(step)).toBe(false);
  });
  it("resumes the question preserved by a manual pause", () => {
    expect(
      customerResumeStep({
        state: "PAUSED",
        lastQuestionKey: "NAME",
        hasBooking: false,
      })
    ).toBe("NAME");
    expect(
      customerResumeStep({
        state: "PAUSED",
        lastQuestionKey: "SCHEDULE_TIME",
        hasBooking: true,
      })
    ).toBe("SCHEDULE_TIME");
  });
  it("returns reviews to data collection without approving coverage", () => {
    expect(
      customerResumeStep({
        state: "MANUAL_REVIEW",
        lastQuestionKey: "MANUAL_REVIEW",
        hasBooking: true,
      })
    ).toBe("ADDRESS");
    expect(
      customerResumeStep({
        state: "MANUAL_REVIEW",
        lastQuestionKey: "MANUAL_REVIEW",
        hasBooking: false,
      })
    ).toBe("NAME");
  });
  it("does not resume active or completed conversations", () => {
    for (const state of ["COMPLETED", "NAME", "INTRODUCTION"])
      expect(
        customerResumeStep({
          state,
          lastQuestionKey: "NAME",
          hasBooking: false,
        })
      ).toBeNull();
  });
});
