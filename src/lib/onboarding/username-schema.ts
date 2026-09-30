import { z } from "zod";
import { normalizeUsername, usernameProblem } from "./username";

// Server-side validation. Kept apart from username.ts so zod stays out of the
// client bundle; the browser form uses usernameProblem() directly.
export const usernameSchema = z
  .string()
  .max(100)
  .transform(normalizeUsername)
  .superRefine((value, context) => {
    const problem = usernameProblem(value);
    if (problem) context.addIssue({ code: "custom", message: problem });
  });
