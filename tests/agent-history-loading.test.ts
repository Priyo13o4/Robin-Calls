import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { transformSync } from "esbuild";
import type { Conversation } from "../lib/agent/types";

const hookPath = new URL("../app/components/agent/useRobinKnight.ts", import.meta.url);
const saved: Conversation = {
  id: "synthetic-saved-case",
  title: "Saved before this mount",
  persona: "interrogator",
  mode: "byok",
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
  subject: null,
  messages: [{ id: "m1", role: "user", text: "synthetic only", createdAt: "2026-09-01T00:00:00.000Z" }],
  transcript: [{ role: "assistant", content: [{ type: "tool_use", id: "synthetic-tool", name: "synthetic", input: {}, signature: "opaque synthetic transcript field" }] }],
};

function extractEffect(source: string, start: string, end: string): string {
  const begin = source.indexOf(start);
  const finish = source.indexOf(end, begin) + end.length;
  assert.ok(begin >= 0 && finish > begin, `could not find effect starting ${start}`);
  return source.slice(begin, finish);
}

async function executeEffect(effect: string, context: Record<string, unknown>) {
  vm.runInNewContext(transformSync(effect, { loader: "ts", target: "es2022" }).code, context);
  await new Promise<void>((resolve) => setImmediate(resolve));
}

async function executeCallback(source: string, name: string, end: string, context: Record<string, unknown>) {
  const begin = source.indexOf(`  const ${name} = useCallback(`);
  const finish = source.indexOf(end, begin);
  assert.ok(begin >= 0 && finish > begin, `could not find callback ${name}`);
  const callback = source.slice(begin, finish).replace(`const ${name} = useCallback(`, `globalThis.${name} = useCallback(`);
  vm.runInNewContext(transformSync(callback, { loader: "ts", target: "es2022" }).code, context);
  return context[name] as (...args: any[]) => Promise<void>;
}

function setup() {
  let configError: string | null = null;
  let conversations: Conversation[] = [];
  let selected: Conversation | null = null;
  let notify = () => {};
  const context: Record<string, any> = {
    AbortController,
    Promise,
    setImmediate,
    useEffect: (effect: () => (() => void) | void) => { context.cleanup = effect(); },
    scopeGeneration: { current: 0 },
    turnGeneration: { current: 0 },
    selectionGeneration: { current: 0 },
    historyRefreshGeneration: { current: 0 },
    conversationRef: { current: null },
    liveRef: { current: null },
    persistenceInFlight: { current: 0 },
    historyErrorRef: { current: null },
    configRef: { current: null },
    abortRef: { current: null },
    fetchConfig: async () => { throw new Error("synthetic config 503"); },
    listConversations: async () => [structuredClone(saved)],
    subscribeConversationChanges: (callback: () => void) => { notify = callback; return () => {}; },
    setConfigError: (value: string | null) => { configError = value; },
    setConversation: (value: Conversation | null) => { selected = value; context.conversationRef.current = value; },
    setConversations: (value: Conversation[]) => { conversations = value; },
    setConfig: () => {}, setPersonaState: () => {}, setModeState: () => {}, setByokState: () => {}, setLive: () => {},
    loadByok: () => null, loadMode: () => null, loadPersona: () => null,
    defaultPersona: undefined, subject: null, allowedPersonas: undefined,
    window: { addEventListener() {}, removeEventListener() {} },
    document: { visibilityState: "visible", addEventListener() {}, removeEventListener() {} },
  };
  return {
    context,
    get configError() { return configError; },
    get conversations() { return conversations; },
    get selected() { return selected; },
    notify: () => notify(),
  };
}

const CONFIG_START = "  useEffect(() => {\n    scopeGeneration.current";
const CONFIG_END = "  }, [defaultPersona, subject, allowedPersonas]);";
const HISTORY_START = "  useEffect(() => {\n    let cancelled = false;";
const HISTORY_END = "  }, [subject, defaultPersona, allowedPersonas]);";

test("saved local history loads even when the independent config request fails", async () => {
  const source = await readFile(hookPath, "utf8");
  const configEffect = extractEffect(source, CONFIG_START, CONFIG_END);
  const historyEffect = extractEffect(source, HISTORY_START, HISTORY_END);
  const state = setup();
  await executeEffect(configEffect, state.context);
  await executeEffect(historyEffect, state.context);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.ok(state.configError, "the rejected configuration request is recorded");
  assert.equal(state.conversations[0]?.id, saved.id);
  assert.equal(state.selected, null, "unscoped /agent history remains selectable instead of auto-opening");
  state.context.cleanup?.();
});

test("a deferred initial read cannot reselect over a manual New action", async () => {
  const source = await readFile(hookPath, "utf8");
  const effect = extractEffect(source, HISTORY_START, HISTORY_END);
  const state = setup();
  let resolveRead!: (rows: Conversation[]) => void;
  state.context.listConversations = () => new Promise<Conversation[]>((resolve) => { resolveRead = resolve; });
  await executeEffect(effect, state.context);
  const manuallySelected = { ...saved, id: "manual-new-selection" };
  state.context.selectionGeneration.current += 1;
  state.context.setConversation(manuallySelected);
  resolveRead([structuredClone(saved)]);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(state.selected?.id, manuallySelected.id);
  state.context.cleanup?.();
});

test("notifications refresh the list without replacing a live or persistence-pending conversation", async () => {
  const source = await readFile(hookPath, "utf8");
  const effect = extractEffect(source, HISTORY_START, HISTORY_END);
  const state = setup();
  await executeEffect(effect, state.context);
  await new Promise<void>((resolve) => setImmediate(resolve));
  const localBranch = { ...saved, title: "In-progress local branch" };
  state.context.setConversation(localBranch);
  state.context.liveRef.current = { phase: "thinking" };
  state.notify();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(state.selected?.title, localBranch.title);

  state.context.liveRef.current = null;
  state.context.persistenceInFlight.current = 1;
  let resolveNotification!: (rows: Conversation[]) => void;
  state.context.listConversations = () => new Promise<Conversation[]>((resolve) => { resolveNotification = resolve; });
  state.notify();
  await new Promise<void>((resolve) => setImmediate(resolve));
  resolveNotification([{ ...saved, title: "Newer remote version" }]);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(state.selected?.title, localBranch.title);
  state.context.cleanup?.();
});

test("deleting another chat leaves the active turn alone; deleting the active chat stops it", async () => {
  const source = await readFile(hookPath, "utf8");
  let turnGeneration = 4;
  let selectionGeneration = 2;
  let aborts = 0;
  let live: object | null = { phase: "thinking" };
  let selected: Conversation | null = saved;
  const context: Record<string, any> = {
    useCallback: (fn: unknown) => fn,
    conversation: saved,
    conversationRef: { current: saved },
    turnGeneration: { get current() { return turnGeneration; }, set current(value) { turnGeneration = value; } },
    selectionGeneration: { get current() { return selectionGeneration; }, set current(value) { selectionGeneration = value; } },
    historyErrorRef: { current: null }, historyMutationErrorRef: { current: false },
    liveRef: { current: live },
    abortRef: { current: { abort() { aborts += 1; } } },
    setLive: (value: object | null) => { live = value; context.liveRef.current = value; },
    setConversation: (value: Conversation | null) => { selected = value; },
    setConversations: () => {}, setHistoryError: () => {}, setHistoryConflict: () => {}, setHistoryMutationError: () => {},
    deleteConversation: async () => {}, clearConversations: async () => {},
  };
  const removeConversation = await executeCallback(source, "removeConversation", "  const removeAll = useCallback", context);
  await removeConversation("other-history-id");
  assert.equal(aborts, 0, "deleting an unrelated row must not abort the live turn");
  assert.equal(turnGeneration, 4);
  assert.equal(live !== null, true);

  await removeConversation(saved.id);
  assert.equal(aborts, 1);
  assert.equal(turnGeneration, 5);
  assert.equal(selectionGeneration, 3);
  assert.equal(live, null);
  assert.equal(selected, null);
});

test("failed history deletion is handled and keeps the selected chat available", async () => {
  const source = await readFile(hookPath, "utf8");
  let selected: Conversation | null = saved;
  let errorText = "";
  const context: Record<string, any> = {
    useCallback: (fn: unknown) => fn,
    conversation: saved,
    conversationRef: { current: saved },
    turnGeneration: { current: 0 }, selectionGeneration: { current: 0 },
    historyErrorRef: { current: null }, historyMutationErrorRef: { current: false },
    liveRef: { current: null }, abortRef: { current: null }, setLive: () => {},
    setConversation: (value: Conversation | null) => { selected = value; },
    setConversations: () => {},
    setHistoryError: (value: string) => { errorText = value; }, setHistoryConflict: () => {}, setHistoryMutationError: () => {},
    deleteConversation: async () => { throw new Error("synthetic blocked transaction"); }, clearConversations: async () => {},
  };
  const removeConversation = await executeCallback(source, "removeConversation", "  const removeAll = useCallback", context);
  await assert.doesNotReject(() => removeConversation(saved.id));
  assert.equal(selected?.id, saved.id);
  assert.match(errorText, /Delete failed/);
});

test("failed clear stops a live turn but retains the selected chat and reports the failure", async () => {
  const source = await readFile(hookPath, "utf8");
  let live: object | null = { phase: "thinking" };
  let selected: Conversation | null = saved;
  let errorText = "";
  let aborts = 0;
  const context: Record<string, any> = {
    useCallback: (fn: unknown) => fn,
    conversationRef: { current: saved }, turnGeneration: { current: 1 }, selectionGeneration: { current: 0 },
    historyErrorRef: { current: null }, historyMutationErrorRef: { current: false },
    liveRef: { current: live }, abortRef: { current: { abort() { aborts += 1; } } },
    setLive: (value: object | null) => { live = value; },
    setConversation: (value: Conversation | null) => { selected = value; }, setConversations: () => {},
    setHistoryError: (value: string) => { errorText = value; }, setHistoryConflict: () => {}, setHistoryMutationError: () => {},
    clearConversations: async () => { throw new Error("synthetic blocked transaction"); },
  };
  const removeAll = await executeCallback(source, "removeAll", "  const saveConversationAsNew = useCallback", context);
  await assert.doesNotReject(() => removeAll());
  assert.equal(aborts, 1);
  assert.equal(live, null);
  assert.equal(selected?.id, saved.id);
  assert.match(errorText, /Clear failed/);
});
