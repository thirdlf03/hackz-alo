import type { Context, Next } from "hono";
import type { AppVariables, Bindings } from "./types.js";

export async function devAuth(
  c: Context<{ Bindings: Bindings; Variables: AppVariables }>,
  next: Next
) {
  const id = c.req.header("x-dev-user-id") ?? "dev-user";
  const displayName = c.req.header("x-dev-display-name") ?? "Night Operator";
  c.set("user", { id, displayName });
  await next();
}
