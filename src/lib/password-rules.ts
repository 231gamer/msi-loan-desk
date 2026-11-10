import { COMMON_PASSWORDS } from "./common-passwords";

/*
 * Rules for a password the user chooses (SPEC 11; NIST SP 800-63B): long enough, not a common or
 * trivially guessable password, and not built from the user's own name. No symbol or upper-case
 * requirements and no periodic expiry. One module for the server action (the real check) and the
 * live hints on the page. "Different from the current or temporary password" is checked by
 * Supabase Auth and again in the database (complete_password_change).
 */
export const PASSWORD_MIN_LENGTH = 10;
/** bcrypt, which Supabase Auth uses, only reads the first 72 bytes. */
export const PASSWORD_MAX_BYTES = 72;

export const PASSWORD_PROBLEMS = [
  "tooShort",
  "tooLong",
  "containsName",
  "common",
  "repeated",
  "sequence",
] as const;
export type PasswordProblem = (typeof PASSWORD_PROBLEMS)[number];

export interface PasswordContext {
  email?: string;
  fullName?: string;
}

const NAME_PART_MIN = 3;

// Runs of characters people type in order; a password that sits inside one (either direction) is refused.
const SEQUENCES = [
  "01234567890123456789",
  "abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyz",
  "qwertyuiopasdfghjklzxcvbnm",
  "qwertyuiop[]asdfghjkl;'zxcvbnm,./",
  "1qaz2wsx3edc4rfv5tgb6yhn7ujm8ik,9ol.0p;/-['=]",
  "qazwsxedcrfvtgbyhnujmikolp",
  "!@#$%^&*()_+",
  "`1234567890-=",
];
const REVERSED = SEQUENCES.map((sequence) => [...sequence].reverse().join(""));

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** Lower-case letter runs of 3 or more from the email name part and the full name. */
export function namePartsOf(context: PasswordContext): string[] {
  const local = (context.email ?? "").split("@")[0] ?? "";
  const words = `${local} ${context.fullName ?? ""}`.toLowerCase().match(/\p{L}+/gu) ?? [];
  return [...new Set(words.filter((word) => word.length >= NAME_PART_MIN))];
}

function isRepeated(lower: string): boolean {
  // One character repeated, or a short unit repeated: "aaaaaaaaaa", "abababab", "abcabcabc".
  return /^(.{1,4})\1+$/su.test(lower);
}

function isSequence(lower: string): boolean {
  return [...SEQUENCES, ...REVERSED].some((sequence) => sequence.includes(lower));
}

/** Every rule the password breaks, in display order; an empty list means it is acceptable. */
export function passwordProblems(password: string, context: PasswordContext = {}): PasswordProblem[] {
  const problems: PasswordProblem[] = [];
  const lower = password.toLowerCase();
  if ([...password].length < PASSWORD_MIN_LENGTH) problems.push("tooShort");
  if (byteLength(password) > PASSWORD_MAX_BYTES) problems.push("tooLong");
  if (namePartsOf(context).some((part) => lower.includes(part))) problems.push("containsName");
  if (COMMON_PASSWORDS.has(lower)) problems.push("common");
  if (password.length > 0 && isRepeated(lower)) problems.push("repeated");
  else if (password.length > 1 && isSequence(lower)) problems.push("sequence");
  return problems;
}
