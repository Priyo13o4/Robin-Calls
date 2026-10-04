import test from "node:test";
import assert from "node:assert/strict";
import { clearConversations, deleteConversation, saveConversation } from "../lib/agent/store";
import type { Conversation } from "../lib/agent/types";

const conversation = {
  id: "unavailable",
  title: "case",
  persona: "interrogator",
  mode: "byok",
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
  subject: null,
  messages: [],
  transcript: [],
} as unknown as Conversation;

test("history mutations report unavailable IndexedDB instead of claiming persistence", async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: { open() { throw new Error("blocked"); } } });
  try {
    await assert.rejects(() => saveConversation(conversation), /unavailable in this browser/);
    await assert.rejects(() => deleteConversation(conversation.id), /unavailable in this browser/);
    await assert.rejects(() => clearConversations(), /unavailable in this browser/);
  } finally {
    if (original) Object.defineProperty(globalThis, "indexedDB", original);
    else Reflect.deleteProperty(globalThis, "indexedDB");
  }
});
