import test from "node:test";
import assert from "node:assert/strict";
import {
  clearConversations,
  ConversationConflictError,
  deleteConversation,
  listConversations,
  saveConversation,
} from "../lib/agent/store";
import type { Conversation } from "../lib/agent/types";

class FakeRequest<T = unknown> {
  result!: T;
  onsuccess: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
}

class FakeStore {
  constructor(private readonly tx: FakeTransaction) {}
  get(key: IDBValidKey) { return this.tx.request(() => this.tx.db.records.get(String(key))); }
  getAll() { return this.tx.request(() => [...this.tx.db.records.values()]); }
  put(value: Conversation) {
    this.tx.request(() => { this.tx.db.records.set(value.id, structuredClone(value)); return value.id; });
    return {} as IDBRequest<IDBValidKey>;
  }
  delete(key: IDBValidKey) {
    this.tx.request(() => { this.tx.db.records.delete(String(key)); return undefined; });
    return {} as IDBRequest<undefined>;
  }
  clear() {
    this.tx.request(() => { this.tx.db.records.clear(); return undefined; });
    return {} as IDBRequest<undefined>;
  }
  createIndex() { return {} as IDBIndex; }
}

class FakeTransaction {
  oncomplete: ((event: Event) => void) | null = null;
  onabort: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  error: DOMException | null = null;
  private pending = 0;
  private aborted = false;
  private released = false;
  private readonly ready: Promise<void>;
  private release!: () => void;
  constructor(readonly db: FakeDatabase, mode: IDBTransactionMode) {
    if (mode === "readwrite") {
      this.ready = db.writeQueue;
      db.writeQueue = new Promise<void>((resolve) => { this.release = resolve; });
    } else {
      this.ready = Promise.resolve();
    }
  }
  objectStore() { return new FakeStore(this); }
  request<T>(run: () => T): FakeRequest<T> {
    const request = new FakeRequest<T>();
    this.pending += 1;
    void this.ready.then(() => queueMicrotask(() => {
      if (!this.aborted) {
        request.result = run();
        request.onsuccess?.(new Event("success"));
      }
      this.pending -= 1;
      this.finishIfReady();
    }));
    return request;
  }
  abort() { this.aborted = true; }
  private finishIfReady() {
    if (this.pending !== 0 || this.released) return;
    this.released = true;
    const finish = () => {
      if (this.aborted) this.onabort?.(new Event("abort"));
      else this.oncomplete?.(new Event("complete"));
      this.release?.();
    };
    if (this.db.completionDelay) setTimeout(finish, this.db.completionDelay);
    else queueMicrotask(finish);
  }
}

class FakeDatabase {
  readonly records = new Map<string, Conversation>();
  readonly objectStoreNames = { contains: (_name: string) => true } as DOMStringList;
  writeQueue = Promise.resolve();
  completionDelay = 0;
  transaction(_store: string, mode: IDBTransactionMode) { return new FakeTransaction(this, mode) as unknown as IDBTransaction; }
  createObjectStore() { return new FakeStore(new FakeTransaction(this, "readwrite")) as unknown as IDBObjectStore; }
}

class FakeIndexedDB {
  readonly database = new FakeDatabase();
  open() {
    const fakeRequest = new FakeRequest<IDBDatabase>();
    const request = fakeRequest as unknown as IDBOpenDBRequest;
    queueMicrotask(() => {
      fakeRequest.result = this.database as unknown as IDBDatabase;
      request.onupgradeneeded?.call(request, new Event("upgradeneeded") as IDBVersionChangeEvent);
      request.onsuccess?.call(request, new Event("success"));
    });
    return request as IDBOpenDBRequest;
  }
}

function makeConversation(id = "case-1", messages = ["first"]): Conversation {
  return {
    id,
    title: "case",
    persona: "interrogator",
    mode: "byok",
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    subject: null,
    messages: messages.map((text, index) => ({ id: `m${index}`, role: "user", text, createdAt: "2026-09-01T00:00:00.000Z" })),
    transcript: [{ role: "assistant", content: [{ type: "tool_use", id: "opaque", name: "tool", input: {}, signature: "provider-signature" }] }],
  } as unknown as Conversation;
}

test("history saves use atomic revisions, preserve opaque transcript fields, and reject stale/deleted branches", async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
  const fake = new FakeIndexedDB();
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: fake });
  try {
    const initial = makeConversation();
    fake.database.completionDelay = 15;
    let saveSettled = false;
    const delayedSave = saveConversation(initial).then((revision) => { saveSettled = true; return revision; });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(saveSettled, false, "save must wait until the readwrite transaction commits");
    assert.equal(await delayedSave, 1);
    fake.database.completionDelay = 0;
    const stored = await listConversations();
    assert.equal(stored[0].storageRevision, 1);
    assert.equal((stored[0].transcript[0].content as Array<{ signature: string }>)[0].signature, "provider-signature");

    // A pre-revision record treats a missing field as revision zero.
    delete fake.database.records.get(initial.id)!.storageRevision;
    const legacy = (await listConversations())[0];
    assert.equal(await saveConversation({ ...legacy, title: "legacy updated" }, 0), 1);

    // Two tabs read revision 1. The second full-object branch cannot erase the first.
    const tabA = { ...legacy, title: "tab A", messages: [...legacy.messages, { id: "a", role: "user" as const, text: "A", createdAt: "2026-09-02T00:00:00.000Z" }] };
    const tabB = { ...legacy, title: "tab B", messages: [...legacy.messages, { id: "b", role: "user" as const, text: "B", createdAt: "2026-09-02T00:00:00.000Z" }] };
    const revisions = await Promise.allSettled([saveConversation(tabA, 1), saveConversation(tabB, 1)]);
    assert.equal(revisions.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(revisions.filter((result) => result.status === "rejected" && result.reason instanceof ConversationConflictError).length, 1);
    const winner = (await listConversations())[0];
    assert.ok(["tab A", "tab B"].includes(winner.title));
    assert.equal((winner.transcript[0].content as Array<{ signature: string }>)[0].signature, "provider-signature");

    await deleteConversation(initial.id);
    await assert.rejects(() => saveConversation(winner, winner.storageRevision ?? 0), ConversationConflictError);
    await saveConversation(makeConversation("other"));
    await clearConversations();
    await assert.rejects(() => saveConversation(makeConversation("other"), 1), ConversationConflictError);
    assert.equal(await saveConversation(makeConversation("other"), null), 1, "null revision is an explicit create");
    await clearConversations();
    assert.deepEqual(await listConversations(), []);
  } finally {
    if (original) Object.defineProperty(globalThis, "indexedDB", original);
    else Reflect.deleteProperty(globalThis, "indexedDB");
  }
});
