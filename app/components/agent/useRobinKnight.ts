"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  fetchConfig,
  fetchPersona,
  runByokTurn,
  runOurModelsTurn,
  type TurnPhase,
} from "@/lib/agent/runner";
import type {
  AgentConfig,
  ByokSettings,
  ChatMessage,
  ChatMode,
  Conversation,
  PersonaBundle,
  PersonaSummary,
  TraceEntry,
  TurnNotice,
} from "@/lib/agent/types";
import { compactTranscript } from "@/lib/agent/compaction";
import { contextualizeQuestion } from "@/lib/agent/terminal-context";
import { listModels } from "@/lib/agent/providers";
import type {
  CanonicalMessage,
  CanonicalUsage,
  ModelOption,
  ProviderId,
} from "@/lib/agent/providers";
import {
  clearConversations,
  ConversationConflictError,
  deleteConversation,
  listConversations,
  loadByok,
  loadMode,
  loadPersona,
  newId,
  saveByok,
  saveConversation,
  subscribeConversationChanges,
  saveMode,
  savePersona,
  forgetByok,
  titleFor,
} from "@/lib/agent/store";

/**
 * All Robin Knight state for one surface (the docked rail, or `/agent`).
 *
 * The hook owns the split the rest of the UI must never have to think about:
 * **which of the two paths a turn takes**. BYOK runs the whole loop in this
 * browser and never touches `/agent/chat`; our-models streams SSE from it.
 * `send()` picks, and everything downstream renders the same `TurnResult`.
 *
 * Conversations are browser-only by design (K3). This hook writes to IndexedDB
 * and to nothing else — there is no endpoint to post history to, deliberately.
 */

export interface LiveTurn {
  phase: TurnPhase;
  trace: TraceEntry[];
  notices: TurnNotice[];
  usage: CanonicalUsage;
}

/**
 * The provider's model list, tagged with the provider it came from.
 *
 * The tag is load-bearing, not bookkeeping. The key panel can test a key for
 * one provider while a different one is the connected provider — so a bare
 * `ModelOption[]` would let the quick-access picker offer Gemini models for a
 * saved Anthropic key, and every one of those choices would fail on the next
 * turn. Consumers compare against `byok.provider` before rendering.
 */
export interface ModelCatalogue {
  provider: ProviderId;
  models: ModelOption[];
}

export interface RobinKnightState {
  config: AgentConfig | null;
  configError: string | null;
  personas: PersonaSummary[];
  persona: string;
  setPersona(name: string): void;
  personaBundle: PersonaBundle | null;

  mode: ChatMode;
  setMode(mode: ChatMode): void;
  ourModelsEnabled: boolean;

  byok: ByokSettings | null;
  saveKey(settings: ByokSettings): void;
  clearKey(): void;

  /**
   * Which models this key offers — held HERE rather than in the key panel.
   *
   * It used to live in `KeyEntry`'s own state, and `KeyEntry` unmounts every
   * time the panel closes. So the list existed only while the panel was open,
   * which was fine when the panel was the only place to change model and is not
   * fine now that the composer offers a quick picker: a chip that had to
   * re-fetch on every open would either spend a request per press or show
   * nothing. Lifting it also removes the fetch-once-per-open hack.
   */
  models: ModelCatalogue | null;
  modelsError: string | null;
  modelsLoading: boolean;
  /**
   * Fetch the list. With no argument it uses the saved key; the key panel
   * passes the credentials being typed, which are not saved yet.
   *
   * Returns the list on success and `null` on failure. The caller needs the
   * value in hand rather than off the next render — the key panel picks a
   * default model the moment a connection is proven, and reading that off
   * `models` would be reading state it has not been re-rendered with yet.
   * The error text is on `modelsError` for anyone rendering.
   */
  loadModels(override?: { provider: ProviderId; apiKey: string }): Promise<ModelOption[] | null>;
  /** Switch model on the saved key. A no-op when no key is connected. */
  chooseModel(id: string): void;

  conversation: Conversation | null;
  conversations: Conversation[];
  historyError: string | null;
  historyConflict: boolean;
  historyMutationError: boolean;
  historySaving: boolean;
  startConversation(): void;
  openConversation(id: string): void;
  loadSavedVersion(id: string): void;
  saveConversationAsNew(): Promise<void>;
  retryConversationSave(): Promise<void>;
  removeConversation(id: string): Promise<void>;
  removeAll(): Promise<void>;

  live: LiveTurn | null;
  send(text: string): Promise<void>;
  stop(): void;
  /** Non-null when a turn cannot be sent, and says why in one sentence. */
  blocked: string | null;

  /**
   * Shrink the model-facing transcript on the user's command.
   *
   * Deliberately not automatic. The existing `trim()` already handles the
   * ceiling on its own by dropping the oldest turns, and that stays as the
   * backstop — a conversation must never fail just because nobody pressed a
   * button. This is the gentler option offered *before* that happens: keep
   * every word, drop the bulk. See `lib/agent/compaction.ts`.
   */
  compact(): Promise<void>;
  compacting: boolean;
}

/**
 * How many *visible* exchanges fell out, given a count of dropped transcript
 * entries. `history.trim` only ever cuts at a turn boundary — a user message
 * with no `tool_result` blocks — so those boundaries are exactly the messages
 * the page shows on the user's side.
 */
function countDroppedTurns(transcript: CanonicalMessage[], dropped: number): number {
  let turns = 0;
  for (const message of transcript.slice(0, dropped)) {
    if (message.role !== "user") continue;
    const isBoundary =
      typeof message.content === "string" ||
      !message.content.some((block) => block?.type === "tool_result");
    if (isBoundary) turns += 1;
  }
  return turns;
}

const EMPTY_USAGE: CanonicalUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
};

export function useRobinKnight({
  subject = null,
  defaultPersona,
  terminalContext,
  allowedPersonas,
}: { subject?: string | null; defaultPersona?: string; terminalContext?: string | null; allowedPersonas?: readonly string[] } = {}): RobinKnightState {
  const [config, setConfig] = useState<AgentConfig | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [persona, setPersonaState] = useState<string>(defaultPersona ?? "interrogator");
  const [bundle, setBundle] = useState<PersonaBundle | null>(null);
  const [mode, setModeState] = useState<ChatMode>("byok");
  const [byok, setByokState] = useState<ByokSettings | null>(null);
  const [models, setModels] = useState<ModelCatalogue | null>(null);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyConflict, setHistoryConflict] = useState(false);
  const [historyMutationError, setHistoryMutationError] = useState(false);
  const [historySaving, setHistorySaving] = useState(false);
  const [compacting, setCompacting] = useState(false);
  const [live, setLive] = useState<LiveTurn | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const scopeGeneration = useRef(0);
  const turnGeneration = useRef(0);
  const conversationRef = useRef<Conversation | null>(conversation);
  const liveRef = useRef<LiveTurn | null>(live);
  const historyErrorRef = useRef<string | null>(historyError);
  const historyMutationErrorRef = useRef(historyMutationError);
  const configRef = useRef<AgentConfig | null>(config);
  const persistenceInFlight = useRef(0);
  const selectionGeneration = useRef(0);
  const historyRefreshGeneration = useRef(0);
  conversationRef.current = conversation;
  liveRef.current = live;
  historyErrorRef.current = historyError;
  historyMutationErrorRef.current = historyMutationError;
  configRef.current = config;
  // Bundles are immutable per persona and prompt version; refetching one on
  // every turn would add a round trip to the critical path for nothing.
  const bundleCache = useRef(new Map<string, PersonaBundle>());

  useEffect(() => {
    scopeGeneration.current += 1;
    selectionGeneration.current += 1;
    const controller = new AbortController();
    setConfigError(null);
    setConversation(null);
    Promise.resolve(fetchConfig(controller.signal))
      .then((next) => {
        if (controller.signal.aborted) return;
        setConfig(next);
        // A page-supplied default outranks the remembered choice: arriving on
        // an RWA page and being handed the persona that cannot read stock-token
        // infrastructure is worse than losing a preference.
        const available = next.personas.filter((p) => !allowedPersonas || allowedPersonas.includes(p.name));
        const active = conversationRef.current;
        const matching = subject && active?.subject?.toLowerCase() === subject.toLowerCase() ? active : null;
        const stored = matching?.persona ?? defaultPersona ?? loadPersona();
        setPersonaState(available.some((p) => p.name === stored) ? stored! : available.find((p) => p.name === defaultPersona)?.name ?? available[0]?.name ?? "interrogator");
        const storedMode = loadMode();
        // Our-models is not merely unselected when it is off — it cannot answer.
        // Restoring it would put the user on a mode whose every turn errors.
        setModeState(storedMode === "our_models" && next.ourModelsEnabled ? "our_models" : "byok");
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setConfigError(err instanceof Error ? err.message : "The agent service did not answer.");
      });
    setByokState(loadByok());
    return () => {
      scopeGeneration.current += 1;
      turnGeneration.current += 1;
      controller.abort();
      abortRef.current?.abort();
      abortRef.current = null;
      setLive(null);
    };
  }, [defaultPersona, subject, allowedPersonas]);

  useEffect(() => {
    let cancelled = false;
    const generation = scopeGeneration.current;
    const refresh = async (initial = false) => {
      const refreshId = ++historyRefreshGeneration.current;
      const selectedGeneration = selectionGeneration.current;
      const all = await listConversations();
      if (cancelled || generation !== scopeGeneration.current) return;
      if (refreshId !== historyRefreshGeneration.current) return;
      setConversations(all);
      const selected = conversationRef.current;
      const matchesSubject = (candidate: Conversation | undefined) =>
        candidate && (!subject || candidate.subject?.toLowerCase() === subject.toLowerCase());
      if (initial) {
        if (selectedGeneration !== selectionGeneration.current) return;
        const matching = subject ? all.find((item) => matchesSubject(item)) ?? null : null;
        setConversation(matching);
        const available = configRef.current?.personas
          .filter((item) => !allowedPersonas || allowedPersonas.includes(item.name))
          .map((item) => item.name) ?? [];
        if (matching && available.includes(matching.persona)) {
          setPersonaState(matching.persona);
        }
        return;
      }
      // Notifications refresh idle selections only. An in-flight turn owns its
      // local branch until its revision-checked save either commits or conflicts.
      if (selectedGeneration !== selectionGeneration.current || liveRef.current || persistenceInFlight.current || historyErrorRef.current || !selected) return;
      const fresh = all.find((item) => item.id === selected.id);
      if (!fresh) {
        setHistoryError("This saved case was deleted in another tab. Your current copy is still available here; save it as a new case to keep it.");
        setHistoryConflict(true);
        return;
      }
      if ((fresh.storageRevision ?? 0) !== (selected.storageRevision ?? 0)) {
        setConversation(fresh);
        setHistoryError(null);
        setHistoryConflict(false);
        setHistoryMutationError(false);
      }
    };
    void refresh(true);
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const unsubscribe = subscribeConversationChanges(() => void refresh());
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      cancelled = true;
      unsubscribe();
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [subject, defaultPersona, allowedPersonas]);

  useEffect(() => {
    let cancelled = false;
    const cached = bundleCache.current.get(persona);
    if (cached) {
      setBundle(cached);
      return;
    }
    setBundle(null);
    fetchPersona(persona)
      .then((next) => {
        if (cancelled) return;
        bundleCache.current.set(persona, next);
        setBundle(next);
      })
      .catch(() => {
        /* The picker still renders from /agent/config; only BYOK needs this. */
      });
    return () => {
      cancelled = true;
    };
  }, [persona]);

  const setPersona = useCallback((name: string) => {
    if (allowedPersonas && !allowedPersonas.includes(name)) return;
    setPersonaState(name);
    savePersona(name);
  }, [allowedPersonas]);

  const setMode = useCallback((next: ChatMode) => {
    setModeState(next);
    saveMode(next);
  }, []);

  const saveKey = useCallback((settings: ByokSettings) => {
    saveByok(settings);
    setByokState(settings);
  }, []);

  const clearKey = useCallback(() => {
    forgetByok();
    setByokState(null);
    // The list belonged to that key. Keeping it would leave a picker offering
    // models against credentials this browser no longer holds.
    setModels(null);
    setModelsError(null);
  }, []);

  const loadModels = useCallback(
    async (override?: { provider: ProviderId; apiKey: string }): Promise<ModelOption[] | null> => {
      const provider = override?.provider ?? byok?.provider;
      const apiKey = override?.apiKey ?? byok?.apiKey;
      if (!provider || !apiKey) return null;

      setModelsLoading(true);
      setModelsError(null);
      const result = await listModels(provider, apiKey);
      setModelsLoading(false);
      if (!result.ok) {
        // "The list is empty" and "we could not fetch the list" are different
        // sentences, and the picker must never render the first when it means
        // the second — the same rule the tool layer follows for verdict reads.
        // So the previous catalogue is left standing rather than nulled: an
        // expired network call should not erase a list that still describes the
        // connected key.
        setModelsError(result.error);
        return null;
      }
      setModels({ provider, models: result.models });
      return result.models;
    },
    [byok],
  );

  const chooseModel = useCallback(
    (id: string) => {
      if (!byok?.apiKey) return;
      saveKey({ provider: byok.provider, apiKey: byok.apiKey, model: id });
    },
    [byok, saveKey],
  );

  const startConversation = useCallback(() => {
    if (historyErrorRef.current) return;
    selectionGeneration.current += 1;
    turnGeneration.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    setLive(null);
    setConversation(null);
    setHistoryError(null);
    setHistoryConflict(false);
    setHistoryMutationError(false);
  }, []);

  const selectConversation = useCallback(
    (id: string, recover = false) => {
      if (historyErrorRef.current && !recover) return;
      const found = conversations.find((c) => c.id === id);
      if (found && (!subject || found.subject?.toLowerCase() === subject.toLowerCase())) {
        selectionGeneration.current += 1;
        turnGeneration.current += 1;
        abortRef.current?.abort();
        abortRef.current = null;
        setLive(null);
        setConversation(found);
        setHistoryError(null);
        setHistoryConflict(false);
        setHistoryMutationError(false);
        if (!allowedPersonas || allowedPersonas.includes(found.persona)) setPersonaState(found.persona);
      }
    },
    [conversations, allowedPersonas, subject]
  );
  const openConversation = useCallback((id: string) => selectConversation(id), [selectConversation]);
  const loadSavedVersion = useCallback((id: string) => selectConversation(id, true), [selectConversation]);

  const removeConversation = useCallback(
    async (id: string) => {
      if (historyErrorRef.current && !historyMutationErrorRef.current) return;
      const active = (conversationRef.current?.id ?? conversation?.id) === id;
      if (active) {
        selectionGeneration.current += 1;
        turnGeneration.current += 1;
        abortRef.current?.abort();
        abortRef.current = null;
        setLive(null);
      }
      const selection = selectionGeneration.current;
      try {
        await deleteConversation(id);
      } catch {
        setHistoryError("Delete failed. The saved chat is still available; try the delete action again.");
        setHistoryConflict(false);
        setHistoryMutationError(true);
        return;
      }
      setConversations((prev) => prev.filter((c) => c.id !== id));
      if (active && selection === selectionGeneration.current) setConversation(null);
      setHistoryError(null);
      setHistoryConflict(false);
      setHistoryMutationError(false);
    },
    [conversation]
  );

  const removeAll = useCallback(async () => {
    if (historyErrorRef.current && !historyMutationErrorRef.current) return;
    selectionGeneration.current += 1;
    const hadActiveTurn = Boolean(liveRef.current || abortRef.current);
    if (hadActiveTurn) {
      turnGeneration.current += 1;
      abortRef.current?.abort();
      abortRef.current = null;
      setLive(null);
    }
    try {
      await clearConversations();
    } catch {
      setHistoryError("Clear failed. Your saved chats are still available; try Clear all again.");
      setHistoryConflict(false);
      setHistoryMutationError(true);
      return;
    }
    setConversations([]);
    setConversation(null);
    setHistoryError(null);
    setHistoryConflict(false);
    setHistoryMutationError(false);
  }, []);

  const saveConversationAsNew = useCallback(async () => {
    if (!conversation || historyMutationErrorRef.current || persistenceInFlight.current > 0) return;
    const selection = selectionGeneration.current;
    const fork: Conversation = {
      ...conversation,
      id: newId(),
      storageRevision: undefined,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    persistenceInFlight.current += 1;
    setHistorySaving(true);
    try {
      const storageRevision = await saveConversation(fork, null);
      const saved = { ...fork, storageRevision };
      if (selection === selectionGeneration.current) {
        setConversation(saved);
        setHistoryError(null);
        setHistoryConflict(false);
        setHistoryMutationError(false);
      }
      setConversations(await listConversations());
    } catch (error) {
      if (selection === selectionGeneration.current) {
        setHistoryError(error instanceof Error ? error.message : "This case could not be saved in this browser.");
        setHistoryConflict(error instanceof ConversationConflictError);
        setHistoryMutationError(false);
      }
      setConversations(await listConversations());
    } finally {
      persistenceInFlight.current -= 1;
      setHistorySaving(false);
    }
  }, [conversation]);

  const retryConversationSave = useCallback(async () => {
    if (!conversation || historyMutationErrorRef.current || persistenceInFlight.current > 0) return;
    const selection = selectionGeneration.current;
    persistenceInFlight.current += 1;
    setHistorySaving(true);
    try {
      const storageRevision = await saveConversation(conversation, conversation.storageRevision ?? null);
      if (selection === selectionGeneration.current) {
        setConversation({ ...conversation, storageRevision });
        setHistoryError(null);
        setHistoryConflict(false);
        setHistoryMutationError(false);
      }
      setConversations(await listConversations());
    } catch (error) {
      if (selection === selectionGeneration.current) {
        setHistoryError(error instanceof Error ? error.message : "This case could not be saved in this browser.");
        setHistoryConflict(error instanceof ConversationConflictError);
        setHistoryMutationError(false);
      }
      setConversations(await listConversations());
    } finally {
      persistenceInFlight.current -= 1;
      setHistorySaving(false);
    }
  }, [conversation]);

  const ourModelsEnabled = config?.ourModelsEnabled ?? false;

  const blocked = useMemo(() => {
    if (historyError) return historyError;
    if (historySaving) return "Saving this conversation…";
    if (configError) return "The agent service is not reachable from this page.";
    if (!config) return null;
    if (mode === "our_models" && !ourModelsEnabled) {
      return "This deployment is not running our models. Connect your own provider key.";
    }
    if (mode === "byok") {
      if (!byok?.apiKey) return "Connect a provider key to start. It stays in this browser.";
      if (!byok.model) return "Pick a model for this key.";
      if (!bundle) return "Loading the persona bundle…";
    }
    return null;
  }, [config, configError, historyError, historySaving, mode, ourModelsEnabled, byok, bundle]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setLive(null);
  }, []);

  const send = useCallback(
    async (text: string) => {
      const question = text.trim();
      if (!question || !config || live || abortRef.current || persistenceInFlight.current > 0 || blocked) return;
      const turnScope = scopeGeneration.current;
      const turnId = ++turnGeneration.current;
      const turnSelection = selectionGeneration.current;

      const now = new Date().toISOString();
      const base: Conversation =
        conversation ??
        {
          id: newId(),
          title: "New case file",
          persona,
          mode,
          createdAt: now,
          updatedAt: now,
          subject,
          messages: [],
          transcript: [],
        };

      const userMessage: ChatMessage = {
        id: newId(),
        role: "user",
        text: question,
        createdAt: now,
        persona,
        personaChanged: base.persona !== persona,
      };

      const withUser: Conversation = {
        ...base,
        persona,
        mode,
        updatedAt: now,
        messages: [...base.messages, userMessage],
      };
      setConversation(withUser);

      // Refresh page context per turn without rewriting previous provider blocks.
      const modelText = contextualizeQuestion(question, { subject, terminalContext, persona, previousPersona: base.persona });

      const controller = new AbortController();
      abortRef.current = controller;
      setLive({ phase: "thinking", trace: [], notices: [], usage: EMPTY_USAGE });
      const isCurrentTurn = () => turnScope === scopeGeneration.current && turnId === turnGeneration.current && turnSelection === selectionGeneration.current;
      const canUpdateLive = () => isCurrentTurn() && abortRef.current === controller;

      const callbacks = {
        onPhase: (phase: TurnPhase) => { if (canUpdateLive()) setLive((prev) => (prev ? { ...prev, phase } : prev)); },
        onTrace: (entry: TraceEntry) =>
          { if (canUpdateLive()) setLive((prev) => (prev ? { ...prev, trace: [...prev.trace, entry] } : prev)); },
        onNotice: (notice: TurnNotice) =>
          { if (canUpdateLive()) setLive((prev) => (prev ? { ...prev, notices: [...prev.notices, notice] } : prev)); },
        onUsage: (usage: CanonicalUsage) => { if (canUpdateLive()) setLive((prev) => (prev ? { ...prev, usage } : prev)); },
      };

      let result;
      try {
        result =
          mode === "byok" && byok && bundle
            ? await runByokTurn(
                {
                  persona,
                  bundle,
                  settings: byok,
                  transcript: base.transcript,
                  userText: modelText,
                  rpc: config.rpc,
                  maxToolCalls: config.maxToolCallsPerTurn,
                  maxFreeToolCalls: config.maxFreeToolCallsPerTurn,
                  signal: controller.signal,
                },
                callbacks
              )
            : await runOurModelsTurn(
                {
                  persona,
                  transcript: base.transcript,
                  userText: modelText,
                  rpc: config.rpc,
                  signal: controller.signal,
                },
                callbacks
              );
      } finally {
        if (canUpdateLive()) {
          abortRef.current = null;
          setLive(null);
        }
      }
      if (!isCurrentTurn()) return;

      /*
       * An aborted turn appends nothing at all.
       *
       * Storing an empty assistant message rendered a user-initiated STOP under
       * the lime "ON THE RECORD · EVERY FIGURE CITED" strip — a stop dressed up
       * as a citation-validated answer. It also left the user's question on
       * screen while the model-facing transcript never received it, which is
       * exactly the silent divergence `history.ts` says must never happen.
       *
       * The question stays visible (it was asked), the conversation is not
       * saved, and the next send starts from the same transcript.
       */
      if (result.aborted) {
        setConversation({
          ...withUser,
          messages: [
            ...withUser.messages,
            {
              id: newId(),
              role: "assistant",
              text: "",
              createdAt: new Date().toISOString(),
              trace: result.trace,
              stopped: true,
            },
          ],
        });
        // Deliberately NOT persisted and NOT added to `transcript`: nothing was
        // answered, so there is nothing to remember. The marker is on screen
        // only, which is why a reload shows the question alone.
        return;
      }

      const assistant: ChatMessage = {
        id: newId(),
        role: "assistant",
        text: result.text,
        createdAt: new Date().toISOString(),
        persona,
        trace: result.trace,
        strippedClaims: result.strippedClaims,
        strippedText: result.strippedText,
        billable: result.billable,
        usage: result.usage,
        notices: result.notices,
        error: result.error,
      };

      /*
       * The divider marks where the model's memory began for THIS turn.
       *
       * `historyDropped` counts TRANSCRIPT entries, and on BYOK the transcript
       * carries an assistant message per model round and a user message per
       * tool-result batch — so three visible exchanges is easily a dozen
       * entries. Comparing it to a UI index put the divider on an unrelated
       * message, or (when the count exceeded the visible list) silently nowhere
       * at all. Both are claims about what the agent knew, and a wrong one is
       * worse than none.
       *
       * So it is converted through the transcript: count how many of the
       * dropped entries were user-authored turn openings, which is what a
       * visible user message corresponds to.
       */
      const droppedTurns = countDroppedTurns(base.transcript, result.historyDropped);
      let seenUserMessages = 0;
      const messages = withUser.messages.map((message) => {
        const marks =
          droppedTurns > 0 && message.role === "user" && seenUserMessages === droppedTurns;
        if (message.role === "user") seenUserMessages += 1;
        return { ...message, memoryStartsHere: marks };
      });

      const next: Conversation = {
        ...withUser,
        messages: [...messages, assistant],
        transcript: result.transcript,
        updatedAt: new Date().toISOString(),
      };
      next.title = titleFor(next.messages);

      setConversation(next);
      persistenceInFlight.current += 1;
      setHistorySaving(true);
      try {
        const storageRevision = await saveConversation(next, base.storageRevision ?? null);
        if (turnSelection === selectionGeneration.current) {
          setConversation({ ...next, storageRevision });
          if (!historyMutationErrorRef.current) {
            setHistoryError(null);
            setHistoryConflict(false);
            setHistoryMutationError(false);
          }
        }
      } catch (error) {
        if (turnSelection === selectionGeneration.current && !historyMutationErrorRef.current) {
          setHistoryError(error instanceof Error ? error.message : "This case could not be saved in this browser.");
          setHistoryConflict(error instanceof ConversationConflictError);
          setHistoryMutationError(false);
        }
      } finally {
        persistenceInFlight.current -= 1;
        setHistorySaving(false);
      }
      setConversations(await listConversations());
    },
    [byok, bundle, config, conversation, live, mode, persona, subject, terminalContext, blocked]
  );

  const compact = useCallback(async () => {
    if (!conversation || live || persistenceInFlight.current > 0) return;
    setCompacting(true);
    try {
      const result = compactTranscript(conversation.transcript);
      // Identity, not a count: `compactTranscript` returns the input array
      // untouched when there was nothing worth eliding, and rewriting storage
      // for a no-op would bump `updatedAt` and reorder the conversation list
      // for a press that changed nothing.
      if (result.transcript === conversation.transcript) return;

      const next: Conversation = {
        ...conversation,
        transcript: result.transcript,
        updatedAt: new Date().toISOString(),
      };
      setConversation(next);
      const selection = selectionGeneration.current;
      persistenceInFlight.current += 1;
      setHistorySaving(true);
      try {
        const storageRevision = await saveConversation(next, conversation.storageRevision ?? null);
        if (selection === selectionGeneration.current) {
          setConversation({ ...next, storageRevision });
          if (!historyMutationErrorRef.current) {
            setHistoryError(null);
            setHistoryConflict(false);
            setHistoryMutationError(false);
          }
        }
      } catch (error) {
        if (selection === selectionGeneration.current && !historyMutationErrorRef.current) {
          setHistoryError(error instanceof Error ? error.message : "This case could not be saved in this browser.");
          setHistoryConflict(error instanceof ConversationConflictError);
          setHistoryMutationError(false);
        }
      } finally {
        persistenceInFlight.current -= 1;
        setHistorySaving(false);
      }
      setConversations(await listConversations());
    } finally {
      setCompacting(false);
    }
  }, [conversation, live]);

  return {
    config,
    configError,
    personas: (config?.personas ?? []).filter((p) => !allowedPersonas || allowedPersonas.includes(p.name)),
    persona,
    setPersona,
    personaBundle: bundle,
    mode,
    setMode,
    ourModelsEnabled,
    byok,
    saveKey,
    clearKey,
    models,
    modelsError,
    modelsLoading,
    loadModels,
    chooseModel,
    conversation,
    conversations: subject ? conversations.filter((c) => c.subject?.toLowerCase() === subject.toLowerCase()) : conversations,
    historyError,
    historyConflict,
    historyMutationError,
    historySaving,
    startConversation,
    openConversation,
    loadSavedVersion,
    saveConversationAsNew,
    retryConversationSave,
    removeConversation,
    removeAll,
    live,
    send,
    stop,
    blocked,
    compact,
    compacting,
  };
}
