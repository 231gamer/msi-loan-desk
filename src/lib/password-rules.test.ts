import { describe, expect, it } from "vitest";

import { COMMON_PASSWORDS } from "./common-passwords";
import { namePartsOf, passwordProblems } from "./password-rules";

const mariama = { email: "mariama.kollie@msi.example", fullName: "Mariama Kollie" };

describe("passwordProblems", () => {
  it("accepts long passphrases with no symbol or capital letter", () => {
    expect(passwordProblems("river tea lamp orange", mariama)).toEqual([]);
    expect(passwordProblems("gbarnga-bridge-at-noon", mariama)).toEqual([]);
    expect(passwordProblems("7 cups of palm butter")).toEqual([]);
  });

  it("accepts exactly 10 characters and exactly 72 bytes", () => {
    expect(passwordProblems("tq8vnm2xzp")).toEqual([]);
    expect(passwordProblems("b".repeat(35) + "c".repeat(37))).toEqual([]);
  });

  it("refuses fewer than 10 characters", () => {
    expect(passwordProblems("tq8vnm2xz")).toEqual(["tooShort"]);
    expect(passwordProblems("")).toContain("tooShort");
  });

  it("counts characters, not bytes, for the minimum", () => {
    expect(passwordProblems("éèêëàâäôöx")).toEqual([]);
  });

  it("refuses more than 72 bytes (bcrypt reads no further)", () => {
    expect(passwordProblems("t".repeat(36) + "q".repeat(37))).toEqual(["tooLong"]);
    // 37 two-byte characters are 74 bytes.
    expect(passwordProblems("é".repeat(18) + "è".repeat(19))).toContain("tooLong");
  });

  it("refuses the email name part, in any case", () => {
    expect(passwordProblems("KOLLIE-loves-tea", mariama)).toEqual(["containsName"]);
    expect(passwordProblems("x mariama x 2026", mariama)).toEqual(["containsName"]);
  });

  it("refuses any part of the full name of 3 letters or more", () => {
    expect(passwordProblems("tea with joe today", { fullName: "Joe Doe" })).toEqual(["containsName"]);
    expect(passwordProblems("blue river stone", { email: "corex-admin@x.test" })).toEqual([]);
    expect(passwordProblems("the admin desk 77", { email: "corex-admin@x.test" })).toEqual(["containsName"]);
  });

  it("ignores name parts shorter than 3 letters", () => {
    expect(namePartsOf({ fullName: "Al B. Kamara", email: "al.b@x.test" })).toEqual(["kamara"]);
    expect(passwordProblems("al bought a kite", { fullName: "Al B" })).toEqual([]);
  });

  it("refuses common passwords, in any case", () => {
    expect(passwordProblems("Password123")).toContain("common");
    expect(passwordProblems("BASKETBALL")).toContain("common");
    expect(COMMON_PASSWORDS.size).toBe(1000);
  });

  it("refuses one character repeated and short repeated units", () => {
    expect(passwordProblems("aaaaaaaaaaaa")).toContain("repeated");
    expect(passwordProblems("1111111111")).toContain("repeated");
    expect(passwordProblems("abcabcabcabc")).toContain("repeated");
    expect(passwordProblems("ab12ab12ab12")).toContain("repeated");
  });

  it("refuses runs of digits, letters and keyboard rows, in either direction", () => {
    expect(passwordProblems("1234567890")).toContain("sequence");
    expect(passwordProblems("0987654321")).toContain("sequence");
    expect(passwordProblems("8901234567")).toContain("sequence");
    expect(passwordProblems("abcdefghijk")).toContain("sequence");
    expect(passwordProblems("QWERTYUIOP")).toContain("sequence");
    expect(passwordProblems("poiuytrewq")).toContain("sequence");
    expect(passwordProblems("1qaz2wsx3edc")).toContain("sequence");
    expect(passwordProblems("qwertyuiopasd")).toContain("sequence");
  });

  it("lists every problem at once", () => {
    expect(passwordProblems("mariama", mariama)).toEqual(["tooShort", "containsName"]);
  });
});
