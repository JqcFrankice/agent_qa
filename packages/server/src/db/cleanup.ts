import { eq } from "drizzle-orm";
import type { AppDb } from "./client.js";
import { messages } from "./schema.js";

export async function markStreamingMessagesAborted(db: AppDb): Promise<void> {
  await db.update(messages).set({ status: "aborted" }).where(eq(messages.status, "streaming"));
}
