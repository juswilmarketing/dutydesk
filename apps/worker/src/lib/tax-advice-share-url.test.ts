import { describe, expect, it } from "vitest";
import { buildTaxAdviceShareUrl, resolveShareBaseOrigin } from "./tax-advice-share-url";

describe("resolveShareBaseOrigin", () => {
  it("uses branded TAX_ADVICE_SHARE_BASE_URL when set", () => {
    expect(
      resolveShareBaseOrigin(
        "https://advice.pastrinidad.com/",
        "https://dutydesk.mwilson-561.workers.dev/api/tax-advice/share",
      ),
    ).toBe("https://advice.pastrinidad.com");
  });

  it("falls back to request origin when unset", () => {
    expect(
      resolveShareBaseOrigin(
        undefined,
        "https://pas-trinidad-api.mwilson-561.workers.dev/api/tax-advice/share",
      ),
    ).toBe("https://pas-trinidad-api.mwilson-561.workers.dev");
  });
});

describe("buildTaxAdviceShareUrl", () => {
  it("builds the share path", () => {
    expect(buildTaxAdviceShareUrl("https://advice.pastrinidad.com", "abc")).toBe(
      "https://advice.pastrinidad.com/api/tax-advice/share/abc",
    );
  });
});
