import { describe, expect, it } from "vitest";
import { parseJsonBody } from "@/infrastructure/http/parse-json-body";

describe("parseJsonBody", () => {
  it("parses a valid webhook body", async () => {
    await expect(parseJsonBody(new Request("http://localhost", {
      method: "POST",
      body: JSON.stringify({ data: { key: { id: "message" } } }),
    }), 1_048_576)).resolves.toEqual({ data: { key: { id: "message" } } });
  });

  it("rejects malformed JSON", async () => {
    await expect(parseJsonBody(new Request("http://localhost", {
      method: "POST",
      body: "not-json",
    }), 1_048_576)).rejects.toThrow(SyntaxError);
  });

  it("rejects a body larger than one MiB even without Content-Length", async () => {
    await expect(parseJsonBody(new Request("http://localhost", {
      method: "POST",
      body: "x".repeat(1_048_577),
    }), 1_048_576)).rejects.toThrow("Request payload too large");
  });
});
