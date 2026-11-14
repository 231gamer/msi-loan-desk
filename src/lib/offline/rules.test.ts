import { describe, expect, it } from "vitest";

import { OFFLINE_KEEP_HOURS, isExpired, offlineReference, slipReference, syncResultFor } from "./rules";

const HOUR = 60 * 60 * 1000;

describe("isExpired", () => {
  const now = Date.UTC(2026, 10, 14, 12, 0);
  it("keeps a list for 72 hours", () => {
    expect(OFFLINE_KEEP_HOURS).toBe(72);
    expect(isExpired(now - 71 * HOUR, now)).toBe(false);
    expect(isExpired(now - 72 * HOUR, now)).toBe(false);
    expect(isExpired(now - 72 * HOUR - 1, now)).toBe(true);
  });
  it("drops a list stamped far in the future (a wrong phone clock) or unreadable", () => {
    expect(isExpired(now + 73 * HOUR, now)).toBe(true);
    expect(isExpired(Number.NaN, now)).toBe(true);
  });
});

describe("slipReference", () => {
  it("takes six characters of the request key", () => {
    expect(slipReference("3f9a2c1d-0b4e-4c3a-9d2e-1234567890ab")).toBe("OFF-3F9A2C");
  });
});

describe("offlineReference", () => {
  const at = new Date(Date.UTC(2026, 10, 14, 10, 32));
  it("records the collection time for cash", () => {
    expect(offlineReference("cash", "", at)).toBe("Collected offline 14 Nov 2026, 10:32");
  });
  it("keeps the transaction reference first for mobile money and bank", () => {
    expect(offlineReference("mobile_money", " MM-12345 ", at)).toBe(
      "MM-12345 · collected offline 14 Nov 2026, 10:32",
    );
  });
  it("stays within the 100 characters the database allows", () => {
    expect(offlineReference("bank", "X".repeat(200), at).length).toBeLessThanOrEqual(100);
  });
});

describe("syncResultFor", () => {
  it("gives up only on errors a retry cannot fix", () => {
    expect(syncResultFor("OVERPAYMENT")).toBe("failed");
    expect(syncResultFor("INVALID_STATE")).toBe("failed");
    expect(syncResultFor("UNKNOWN")).toBe("retry");
  });
});
