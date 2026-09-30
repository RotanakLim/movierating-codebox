import { z } from "zod";
import { isCalendarDate, isValidTimeZone, todayIn } from "./dates";
import { isValidScore } from "./score";
import { NOTE_MAX_LENGTH } from "./types";

/** Server-side validation for saveEntry. Never trusts client scores, dates, or IDs. */
export const entryInputSchema = z
  .object({
    id: z.uuid(),
    movieId: z.number().int().positive().max(2_147_483_647),
    expectedVersion: z.number().int().positive().nullable(),
    score: z
      .number()
      .nullable()
      .refine(
        (value) => value === null || isValidScore(value),
        "Choose a score from 0.0 to 10.0 with one decimal place.",
      ),
    note: z
      .string()
      // Plain text: keep line breaks, normalise Windows newlines, trim the ends.
      .transform((value) => value.replace(/\r\n?/g, "\n").trim())
      .refine(
        (value) => value.length <= NOTE_MAX_LENGTH,
        `Reviews can be up to ${NOTE_MAX_LENGTH.toLocaleString("en-US")} characters.`,
      ),
    spoiler: z.boolean(),
    watched: z.boolean(),
    watchedDate: z
      .string()
      .refine(isCalendarDate, "Choose a valid watch date.")
      .nullable(),
    timeZone: z.string().refine(isValidTimeZone, "Unknown timezone."),
  })
  .strict()
  .superRefine((entry, context) => {
    if (!entry.watched && entry.watchedDate)
      context.addIssue({
        code: "custom",
        path: ["watchedDate"],
        message: "Only watched entries have a watch date.",
      });
    if (
      entry.watchedDate &&
      isValidTimeZone(entry.timeZone) &&
      entry.watchedDate > todayIn(entry.timeZone)
    )
      context.addIssue({
        code: "custom",
        path: ["watchedDate"],
        message: "The watch date can't be in the future.",
      });
    if (!entry.watched && entry.score === null && !entry.note)
      context.addIssue({
        code: "custom",
        message: "Add a score, a review, or mark it watched.",
      });
  });
export type ValidEntryInput = z.infer<typeof entryInputSchema>;
