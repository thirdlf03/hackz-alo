import type { Context, Next } from "hono";
import type { AppVariables, Bindings } from "./types.js";

/** 単一プレイヤー想定。本番認証は設けず、固定 ID で D1 の user_id を揃えるだけ。 */
export async function devAuth(
  c: Context<{ Bindings: Bindings; Variables: AppVariables }>,
  next: Next
) {
  c.set("user", { id: "dev-user", displayName: "Night Operator" });
  await next();
}
