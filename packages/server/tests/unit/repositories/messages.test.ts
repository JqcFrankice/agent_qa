import { describe, expect, it } from "vitest";
import { createTestDb } from "../../helpers/test-db.js";
import { UserRepository } from "../../../src/db/repositories/users.js";
import { ConversationsRepository } from "../../../src/db/repositories/conversations.js";
import { MessagesRepository } from "../../../src/db/repositories/messages.js";
import { markStreamingMessagesAborted } from "../../../src/db/cleanup.js";

async function insertTestUser(db: ReturnType<typeof createTestDb>, name: string) {
  return new UserRepository(db).create(name, "hash");
}

describe("MessagesRepository", () => {
  it("appends assistant content and marks streaming leftovers aborted", async () => {
    const db = createTestDb();
    const conversations = new ConversationsRepository(db);
    const messages = new MessagesRepository(db);
    const user = await insertTestUser(db, "alice");
    const conversation = await conversations.create(user.id, { provider: "aiwoo-claude", model: "claude-opus-4-8" });
    const assistant = await messages.createAssistantStreaming(conversation.id);

    await messages.appendContent(assistant.id, "Hello");
    await messages.appendContent(assistant.id, " world");
    await markStreamingMessagesAborted(db);

    const rows = await messages.listForConversation(conversation.id, user.id);
    expect(rows[0].content).toBe("Hello world");
    expect(rows[0].status).toBe("aborted");
  });

  it("scopes message reads to the owner", async () => {
    const db = createTestDb();
    const conversations = new ConversationsRepository(db);
    const messages = new MessagesRepository(db);
    const alice = await insertTestUser(db, "alice");
    const bob = await insertTestUser(db, "bob");
    const conversation = await conversations.create(alice.id, { provider: "aiwoo-claude", model: "claude-opus-4-8" });
    await messages.createUserMessage(conversation.id, "hi");
    expect(await messages.listForConversation(conversation.id, bob.id)).toEqual([]);
    expect((await messages.listForConversation(conversation.id, alice.id)).length).toBe(1);
  });

  it("marks complete and error with metadata", async () => {
    const db = createTestDb();
    const conversations = new ConversationsRepository(db);
    const messages = new MessagesRepository(db);
    const user = await insertTestUser(db, "alice");
    const conversation = await conversations.create(user.id, { provider: "aiwoo-claude", model: "claude-opus-4-8" });
    const ok = await messages.createAssistantStreaming(conversation.id);
    await messages.markComplete(ok.id, { providerMessageId: "m1", usage: { inputTokens: 3, outputTokens: 2 } });
    const bad = await messages.createAssistantStreaming(conversation.id);
    await messages.markError(bad.id, "UPSTREAM_ERROR");
    const rows = await messages.listForConversation(conversation.id, user.id);
    expect(rows[0].status).toBe("complete");
    expect(rows[1].status).toBe("error");
    expect(rows[1].errorCode).toBe("UPSTREAM_ERROR");
  });
});
