import { describe, expect, it } from "vitest";
import {
  ATTR_EMBED_DIM,
  ATTR_EMBED_MODEL,
  ATTR_EMBED_STUB_MODEL,
  BankAttrEmbedder,
  descriptorToBankKey,
  meanPoolL2,
  StubAttrEmbedder,
} from "./attr-embed.js";

function unit(i: number): number[] {
  const v = new Array<number>(ATTR_EMBED_DIM).fill(0);
  v[i % ATTR_EMBED_DIM] = 1;
  return v;
}

describe("descriptorToBankKey", () => {
  it("maps open-vocab keys", () => {
    expect(descriptorToBankKey("breed", "labrador")).toBe("breed:labrador");
    expect(descriptorToBankKey("fur_color", "golden")).toBe("fur_color:golden");
  });

  it("rejects unrelated descriptors", () => {
    expect(descriptorToBankKey("license_plate", "ABC")).toBeNull();
  });
});

describe("meanPoolL2", () => {
  it("averages and normalizes", () => {
    const out = meanPoolL2([unit(0), unit(1)]);
    expect(out).toHaveLength(ATTR_EMBED_DIM);
    expect(out![0]).toBeCloseTo(Math.SQRT1_2, 5);
    expect(out![1]).toBeCloseTo(Math.SQRT1_2, 5);
  });

  it("returns null for empty or mismatched dims", () => {
    expect(meanPoolL2([])).toBeNull();
    expect(meanPoolL2([[1, 0], [1]])).toBeNull();
  });
});

describe("BankAttrEmbedder", () => {
  it("mean-pools matching bank rows", async () => {
    const bank = {
      "breed:labrador": unit(0),
      "fur_color:golden": unit(1),
    };
    const emb = await new BankAttrEmbedder(bank).embed([
      { key: "breed", value: "labrador" },
      { key: "fur_color", value: "golden" },
      { key: "license_plate", value: "X" },
    ]);
    expect(emb?.model).toBe(ATTR_EMBED_MODEL);
    expect(emb?.dim).toBe(ATTR_EMBED_DIM);
    expect(emb?.values[0]).toBeCloseTo(Math.SQRT1_2, 5);
    expect(emb?.values[1]).toBeCloseTo(Math.SQRT1_2, 5);
  });

  it("soft-nulls when the bank is missing or keys miss", async () => {
    expect(await new BankAttrEmbedder(null).embed([{ key: "breed", value: "x" }])).toBeNull();
    expect(
      await new BankAttrEmbedder({}).embed([{ key: "breed", value: "missing" }]),
    ).toBeNull();
  });

  it("two keys differ from either alone", async () => {
    const bank = {
      "breed:a": unit(0),
      "breed:b": unit(1),
    };
    const both = await new BankAttrEmbedder(bank).embed([
      { key: "breed", value: "a" },
      { key: "breed", value: "b" },
    ]);
    const onlyA = await new BankAttrEmbedder(bank).embed([{ key: "breed", value: "a" }]);
    expect(both?.values[0]).not.toBeCloseTo(onlyA!.values[0]!, 5);
  });
});

describe("StubAttrEmbedder", () => {
  it("returns a stable 512-d vector for CI", async () => {
    const emb = await new StubAttrEmbedder().embed([
      { key: "breed", value: "labrador" },
    ]);
    expect(emb?.model).toBe(ATTR_EMBED_STUB_MODEL);
    expect(emb?.values).toHaveLength(ATTR_EMBED_DIM);
  });
});
