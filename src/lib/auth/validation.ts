import { z } from "zod";

export const usernameSchema = z
  .string()
  .trim()
  .min(3, "Username must be at least 3 characters.")
  .max(32, "Username must be at most 32 characters.")
  .regex(/^[a-zA-Z0-9_.-]+$/, "Use letters, numbers, dots, dashes and underscores only.")
  .transform((s) => s.toLowerCase());

export const passwordSchema = z
  .string()
  .min(10, "Password must be at least 10 characters.")
  .max(256, "Password is too long.");

export const credentialsSchema = z.object({
  username: usernameSchema,
  password: z.string().min(1).max(256),
});

export const registerSchema = z.object({ username: usernameSchema, password: passwordSchema });
