import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

const mocks = vi.hoisted(() => ({ session: vi.fn(), admin: vi.fn(), document: vi.fn(), get: vi.fn(), error: vi.fn() }));
vi.mock("@/infrastructure/auth/auth", () => ({ auth: { api: { getSession: mocks.session } } }));
vi.mock("@/infrastructure/db/prisma-client", () => ({ prisma: { user: { findFirst: mocks.admin }, professionalDocument: { findUnique: mocks.document } } }));
vi.mock("@/infrastructure/storage/storage-runtime", () => ({ createRuntimeStorage: () => ({ get: mocks.get }) }));
vi.mock("@/infrastructure/observability/logger", () => ({ logger: { error: mocks.error } }));

const documentId = "f8715bd7-110b-4281-9965-aedb0a6ccb60";
const request = (id = documentId) => GET(new Request(`http://localhost/admin/documents/${id}/file`), { params: Promise.resolve({ documentId: id }) });

describe("private document file", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.session.mockResolvedValue({ user: { email: "admin@allset.test" } });
    mocks.admin.mockResolvedValue({ id: "admin" });
    mocks.document.mockResolvedValue({ storageKey: "private/document", contentType: "image/png" });
    mocks.get.mockResolvedValue(new Uint8Array([1, 2, 3]));
  });

  it("requires an authenticated session before looking up the file", async () => {
    mocks.session.mockResolvedValue(null);
    expect((await request()).status).toBe(401);
    expect(mocks.document).not.toHaveBeenCalled();
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it("requires the administrative role", async () => {
    mocks.admin.mockResolvedValue(null);
    expect((await request()).status).toBe(403);
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it("rejects an invalid identifier without querying documents", async () => {
    expect((await request("invalid")).status).toBe(404);
    expect(mocks.document).not.toHaveBeenCalled();
  });

  it("returns 404 for a missing document", async () => {
    mocks.document.mockResolvedValue(null);
    expect((await request()).status).toBe(404);
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it("streams the file privately with its original supported content type", async () => {
    const response = await request();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("does not serve unsupported executable content", async () => {
    mocks.document.mockResolvedValue({ storageKey: "private/document", contentType: "text/html" });
    expect((await request()).status).toBe(404);
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it("reports an unavailable file without exposing storage errors", async () => {
    mocks.get.mockRejectedValue(new Error("private storage detail"));
    const response = await request();
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private storage detail");
  });
});
