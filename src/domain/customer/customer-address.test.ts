import { describe, expect, it } from "vitest";
import { extractNeighborhood } from "./customer-address";

describe("extractNeighborhood", () => {
  it.each([
    ["Rua Silva Paulet, 1234, apto 501, Aldeota, Fortaleza - CE", "Aldeota"],
    ["Rua A, 50 - Centro", "Centro"],
    ["Av. Beira Mar, 3000, Meireles", "Meireles"],
    ["rua das flores 10, bairro aldeota", "Aldeota"],
    ["Rua B, 20, Bairro: Papicu, Fortaleza", "Papicu"],
  ])("%s -> %s", (address, expected) => {
    expect(extractNeighborhood(address)).toBe(expected);
  });

  it("não inventa o bairro quando não há indício", () => {
    expect(extractNeighborhood("Rua das Flores 123")).toBeUndefined();
    expect(extractNeighborhood("Av Beira Mar 3000 apto 12")).toBeUndefined();
  });
});
