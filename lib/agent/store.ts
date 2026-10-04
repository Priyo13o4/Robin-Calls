"use client";

/**
 * Browser-only conversation storage.
 *
 * **This is a decision, not a stage.** Chat history is never sent to our
 * servers, for either mode (HANDOFF §6, recorded as K3 so it is not "fixed"
 * later). There is no sync, no account, no "sign in to save". The consequence
 * the UI has to state plainly: a conversation does not follow the user to
 * another device, and clearing site data clears it. Export is the only way one
 * leaves this browser, which is why it is a first-class affordance rather than
 * a menu item.
 *
 * IndexedDB rather than `localStorage` for the conversations: transcripts carry
 * whole tool results and blow past the 5 MB cap, and the synchronous API would
 * block the main thread while writing them. No wrapper library — the surface
 * used here is four operations.
 *
 * The provider key is `localStorage`, deliberately: it is small, it is needed
 * synchronously on first paint to decide which screen to show, and it is the
 * user's own credential in the user's own browser. It is never posted to our
 * origin, never logged, and never put in a URL.
 */

import type { ByokSettings, ChatMessage, ChatMode, Conversation } from "./types";
import type { ProviderId } from "./providers";

// Frozen at the old brand name: renaming it orphans every returning visitor's
// locally stored conversations. The export `source` field below shares the value.
const DB_NAME = "robincalls-consigliere";
const DB_VERSION = 1;
const STORE = "conversations";

const KEY_BYOK = "rc.agent.byok";
const KEY_MODE = "rc.agent.mode";
const KEY_PERSONA = "rc.agent.persona";

let dbPromise: Promise<IDBDatabase | null> | null = null;

const HISTORY_CHANNEL = "robincalls-agent-history";
const HISTORY_EVENT = "robincalls-agent-history-changed";

export class ConversationConflictError extends Error {
  constructor(message = "This conversation changed or was deleted in another tab. Load the saved version or save this copy as a new case before continuing.") {
    super(message);
    this.name = "ConversationConflictError";
  }
}

/** Cross-tab messages contain identifiers only; transcript content stays in IndexedDB. */
export function subscribeConversationChanges(onChange: () => void): () => void {
  if (typeof window !== "undefined") window.addEventListener(HISTORY_EVENT, onChange);
  let channel: BroadcastChannel | null = null;
  try {
    if (typeof BroadcastChannel !== "undefined") channel = new BroadcastChannel(HISTORY_CHANNEL);
  } catch {
    // Focus and visibility refreshes remain available when channel creation is blocked.
  }
  if (channel) channel.onmessage = (event: MessageEvent<unknown>) => {
    const message = event.data as { type?: unknown } | null;
    if (message?.type === "changed") onChange();
  };
  return () => {
    channel?.close();
    if (typeof window !== "undefined") window.removeEventListener(HISTORY_EVENT, onChange);
  };
}

function announceConversationChange(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(HISTORY_EVENT));
  if (typeof BroadcastChannel === "undefined") return;
  try {
    const channel = new BroadcastChannel(HISTORY_CHANNEL);
    channel.postMessage({ type: "changed" });
    channel.close();
  } catch {
    // A blocked notification channel must not make a completed local save fail.
  }
}

/**
 * Resolves to `null` rather than throwing when IndexedDB is unavailable —
 * private windows and some embedded webviews refuse `open()` outright. A chat
 * that works but forgets is a far better outcome than a page that will not
 * load, and every caller here degrades to in-memory state.
 */
function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === "undefined") return resolve(null);
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      return resolve(null);
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" }).createIndex("updatedAt", "updatedAt");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
  return dbPromise;
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  return openDb().then(
    (db) =>
      new Promise<T | null>((resolve) => {
        if (!db) return resolve(null);
        let request: IDBRequest<T>;
        try {
          request = run(db.transaction(STORE, mode).objectStore(STORE));
        } catch {
          return resolve(null);
        }
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(null);
      })
  );
}

export async function listConversations(): Promise<Conversation[]> {
  const all = (await tx<Conversation[]>("readonly", (store) => store.getAll())) ?? [];
  return all.map((conversation) => ({ ...conversation, storageRevision: conversation.storageRevision ?? 0 }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function saveConversation(conversation: Conversation, expectedRevision: number | null = null): Promise<number> {
  // `put` writes the object as given. Nothing here maps or rebuilds the
  // transcript — structured clone keeps every key, including provider-opaque
  // ones like `signature`, which is the whole point (see types.ts).
  const db = await openDb();
  if (!db) throw new Error("Conversation history is unavailable in this browser.");

  const revision = await new Promise<number>((resolve, reject) => {
    let transaction: IDBTransaction;
    let nextRevision: number | null = null;
    let conflict: ConversationConflictError | null = null;
    try {
      transaction = db.transaction(STORE, "readwrite");
      const store = transaction.objectStore(STORE);
      const get = store.get(conversation.id);
      get.onsuccess = () => {
        const current = get.result as Conversation | undefined;
        const actualRevision = current?.storageRevision ?? 0;
        if ((expectedRevision === null && current) || (expectedRevision !== null && (!current || actualRevision !== expectedRevision))) {
          conflict = new ConversationConflictError();
          transaction.abort();
          return;
        }
        nextRevision = actualRevision + 1;
        store.put({ ...conversation, storageRevision: nextRevision });
      };
      get.onerror = () => transaction.abort();
      transaction.oncomplete = () => {
        if (nextRevision === null) reject(new Error("Conversation history could not be saved."));
        else resolve(nextRevision);
      };
      transaction.onabort = () => reject(conflict ?? transaction.error ?? new Error("Conversation history could not be saved."));
      transaction.onerror = () => reject(conflict ?? transaction.error ?? new Error("Conversation history could not be saved."));
    } catch (error) {
      reject(error);
    }
  });
  announceConversationChange();
  return revision;
}

export async function deleteConversation(id: string): Promise<void> {
  await writeTransaction((store) => store.delete(id));
  announceConversationChange();
}

export async function clearConversations(): Promise<void> {
  await writeTransaction((store) => store.clear());
  announceConversationChange();
}

function writeTransaction(run: (store: IDBObjectStore) => IDBRequest): Promise<void> {
  return openDb().then((db) => new Promise<void>((resolve, reject) => {
    if (!db) return reject(new Error("Conversation history is unavailable in this browser."));
    try {
      const transaction = db.transaction(STORE, "readwrite");
      run(transaction.objectStore(STORE));
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error ?? new Error("Conversation history could not be updated."));
      transaction.onerror = () => reject(transaction.error ?? new Error("Conversation history could not be updated."));
    } catch (error) {
      reject(error);
    }
  }));
}

// ── Settings ────────────────────────────────────────────────────────────────

function readJson<T>(key: string): T | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Quota or a blocked store. Losing a preference is not worth an exception
    // on a keystroke.
  }
}

export function loadByok(): ByokSettings | null {
  const stored = readJson<Partial<ByokSettings>>(KEY_BYOK);
  if (!stored?.apiKey || !stored.provider) return null;
  return {
    provider: stored.provider as ProviderId,
    model: stored.model ?? "",
    apiKey: stored.apiKey,
  };
}

export function saveByok(settings: ByokSettings): void {
  writeJson(KEY_BYOK, settings);
}

export function forgetByok(): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(KEY_BYOK);
  } catch {
    /* nothing to do — the key is already unreachable */
  }
}

export function loadMode(): ChatMode | null {
  const stored = readJson<ChatMode>(KEY_MODE);
  return stored === "byok" || stored === "our_models" ? stored : null;
}

export function saveMode(mode: ChatMode): void {
  writeJson(KEY_MODE, mode);
}

export function loadPersona(): string | null {
  return readJson<string>(KEY_PERSONA);
}

export function savePersona(name: string): void {
  writeJson(KEY_PERSONA, name);
}

// ── Export ──────────────────────────────────────────────────────────────────

/**
 * The transcript goes out too, not just the prose.
 *
 * We hold nothing, so an export is the user's only copy — and the transcript is
 * what makes it a record rather than a screenshot in text form: it is what the
 * model was actually given, tool results included.
 */
export function toJson(conversations: Conversation[]): string {
  return JSON.stringify(
    { exportedAt: new Date().toISOString(), source: "robincalls-consigliere", conversations },
    null,
    2
  );
}

export function toMarkdown(conversation: Conversation): string {
  const lines: string[] = [
    `# ${conversation.title}`,
    "",
    `- Persona: ${conversation.persona}`,
    `- Mode: ${conversation.mode === "byok" ? "your own provider key" : "RobinCalls models"}`,
    `- Started: ${conversation.createdAt}`,
    conversation.subject ? `- Subject: ${conversation.subject}` : "",
    "",
    "> The Robin Knight explains verdicts. It does not produce them.",
    "",
  ].filter(Boolean);

  for (const message of conversation.messages) {
    lines.push(message.role === "user" ? "## You" : "## The Robin Knight", "");
    if (message.trace?.length) {
      lines.push("<!-- tools read -->");
      for (const entry of message.trace) {
        lines.push(`- \`${entry.name}\` — ${entry.outcome} (${entry.durationMs}ms)`);
        // Why a failed row carries its reason: the five outcome words are for
        // the reader deciding whether to believe the answer, and "transient" is
        // all they need for that. But an export is the only copy that leaves
        // this browser, and it is what a user sends us when something breaks —
        // so dropping the message turned every client-side failure into an
        // undiagnosable word. A rate limit, a missing explorer endpoint and a
        // wrong-chain RPC all exported as `transient` and nothing else.
        // The UI has always shown this behind the PAYLOAD button; the export
        // simply never carried it across.
        const reason = entry.payload?.ok === false ? entry.payload.error : null;
        if (reason) {
          const code = entry.payload?.code ? ` [${entry.payload.code}]` : "";
          lines.push(`  - reason${code}: ${reason}`);
        }
      }
      lines.push("");
    }
    lines.push(message.text || "_(no answer)_", "");
    if (message.strippedClaims) {
      lines.push(
        `_${message.strippedClaims} sentence(s) were removed: they stated a number no tool returned._`,
        ""
      );
    }
  }
  return lines.join("\n");
}

export function download(filename: string, body: string, type: string): void {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

// ── Helpers ─────────────────────────────────────────────────────────────────

export function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `id_${Math.random().toString(36).slice(2, 12)}`;
}

/** First user message, clipped. A conversation with no question keeps a placeholder. */
export function titleFor(messages: ChatMessage[]): string {
  const first = messages.find((m) => m.role === "user" && m.text.trim());
  if (!first) return "New case file";
  const text = first.text.trim().replace(/\s+/g, " ");
  return text.length > 64 ? `${text.slice(0, 63)}…` : text;
}
