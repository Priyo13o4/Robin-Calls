"use client";

import { useEffect, useRef, useState } from "react";

import { PROVIDERS, PROVIDER_IDS, type ModelOption, type ProviderId } from "@/lib/agent/providers";
import type { ByokSettings, ChatMode } from "@/lib/agent/types";
import { LABEL, MONO } from "./MessageStates";
import type { ModelCatalogue } from "./useRobinKnight";

/**
 * Bring your own key.
 *
 * **The key never touches our servers.** The request goes from this browser to
 * the provider's own origin — `assertProviderUrl` refuses anything else — and
 * the value is held in this browser's local storage, never posted to our
 * origin, never logged, never put in a URL.
 *
 * "Test connection" is the provider's model list, which is the honest test: it
 * proves the key authenticates *and* fills the model selector, and it fails
 * readably because all three providers send CORS headers on their error paths.
 * A model whose tool support we cannot verify is offered with a warning rather
 * than hidden — a hidden model somebody is paying for is a support ticket, a
 * warned one is a choice, and every persona here needs tools.
 */

export function ModeToggle({
  mode,
  onChange,
  ourModelsEnabled,
}: {
  mode: ChatMode;
  onChange(mode: ChatMode): void;
  ourModelsEnabled: boolean;
}) {
  return (
    <div className="flex items-stretch border-2 border-[#2a2a2a] bg-[#141414]">
      <button
        type="button"
        onClick={() => onChange("byok")}
        className={`${LABEL} flex items-center gap-2 border-r-2 border-[#2a2a2a] px-3.5 py-2.5 ${
          mode === "byok" ? "text-[#ededea]" : "text-[#8a8a8a] hover:text-[#b4b4b4]"
        }`}
      >
        {mode === "byok" && <span className="block h-1.5 w-1.5 bg-[#ccff00]" />}
        BYOK · FREE
      </button>
      {/* Unavailable reads as COMING SOON, in the site's white box, rather than
          as a greyed-out control.
          `ourModelsEnabled` is false whenever this deployment holds no model key
          — which is the state production is *deliberately* pinned in until
          metering lands (METERING_IMPLEMENTED in settings.py refuses the key
          rather than honouring it). A disabled toggle reads as broken, and it
          reads that way to everyone, because right now that is everyone. It is
          not broken; it is not built yet, and saying so is both honest and the
          better sales line. */}
      {ourModelsEnabled ? (
        <button
          type="button"
          onClick={() => onChange("our_models")}
          className={`${LABEL} flex items-center gap-2 px-3.5 py-2.5 ${
            mode === "our_models" ? "text-[#ededea]" : "text-[#8a8a8a] hover:text-[#b4b4b4]"
          }`}
        >
          {mode === "our_models" && <span className="block h-1.5 w-1.5 bg-[#ccff00]" />}
          OUR MODELS · CREDITS
        </button>
      ) : (
        <div
          className={`${LABEL} halftone-light flex cursor-default items-center gap-2 bg-[#ededea] px-3.5 py-2.5 text-[#0a0a0a]`}
          title="Credits are not live yet. Bring your own key in the meantime — it costs nothing and never leaves your browser."
        >
          OUR MODELS · COMING SOON
        </div>
      )}
    </div>
  );
}

/**
 * `onSave` PERSISTS. It does not close this panel — `onDone` does.
 *
 * They used to be the same callback, and the caller closed the panel inside it.
 * That made every persisting action a dismissal: picking a different model in
 * the dropdown slammed the panel shut, and once the model list was fetched
 * automatically on open the panel closed the instant it appeared. Two different
 * intentions ("remember this" and "I am finished here") cannot share one prop.
 */
export function KeyEntry({
  settings,
  catalogue,
  error,
  testing,
  onTest,
  onSave,
  onDone,
  onForget,
}: {
  settings: ByokSettings | null;
  /**
   * The shared list, from `useRobinKnight`. It survives this panel closing,
   * which is why the composer's quick picker can offer it without a fetch —
   * and why the fetch-once-per-open hack that used to live here is gone.
   */
  catalogue: ModelCatalogue | null;
  error: string | null;
  testing: boolean;
  onTest(credentials: { provider: ProviderId; apiKey: string }): Promise<ModelOption[] | null>;
  onSave(settings: ByokSettings): void;
  onDone(): void;
  onForget(): void;
}) {
  const [provider, setProvider] = useState<ProviderId>(settings?.provider ?? "anthropic");
  const [apiKey, setApiKey] = useState(settings?.apiKey ?? "");
  const [model, setModel] = useState(settings?.model ?? "");
  const [reveal, setReveal] = useState(false);

  const adapter = PROVIDERS[provider];
  /*
   * A list for a DIFFERENT provider is not this panel's list.
   *
   * The tabs change `provider` without saving, so the held catalogue can
   * legitimately describe another provider's key. Rendering it here would offer
   * Anthropic models under the Gemini tab, and every one of those picks would
   * fail on the first turn. Same comparison guards the composer's picker.
   */
  const models = catalogue?.provider === provider ? catalogue.models : null;

  /**
   * Fetch the list for a key we already hold, once, on open.
   *
   * Kept because the panel is where a reader goes to inspect a connection, and
   * arriving to a blank selector reads as a broken feature. It is now a no-op
   * whenever the shared catalogue already holds this provider's list, so
   * reopening the panel no longer spends a request.
   *
   * Bounded by a ref rather than a dependency array so it fires once per open
   * and never loops on the state it sets.
   */
  const primed = useRef(false);
  useEffect(() => {
    if (primed.current || models || testing || !settings?.apiKey) return;
    primed.current = true;
    void test();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function test() {
    const found = await onTest({ provider, apiKey });
    if (!found) return;
    const preferred = found.find((m) => m.id === model) ?? found[0];
    if (preferred) {
      setModel(preferred.id);
      onSave({ provider, model: preferred.id, apiKey });
    }
  }

  return (
    <div className="border-2 border-[#2a2a2a] bg-[#141414]">
      <div className="flex items-center justify-between border-b-2 border-[#2a2a2a] px-4 py-3.5">
        <span className={`${LABEL} text-[#ededea]`}>CONNECT YOUR PROVIDER</span>
        <span className={`${MONO} text-[#ccff00]`}>FREE</span>
      </div>

      <div className="p-4">
        <div className="mb-4 flex items-stretch border-2 border-[#2a2a2a] bg-[#0f0f0f]">
          {PROVIDER_IDS.map((id, index) => (
            <button
              key={id}
              type="button"
              // The catalogue is not cleared: it still describes whichever
              // provider it was fetched for, and `models` above already refuses
              // to show it under the wrong tab.
              onClick={() => {
                setProvider(id);
                setModel("");
              }}
              className={`${LABEL} flex-1 py-2.5 ${index > 0 ? "border-l-2 border-[#2a2a2a]" : ""} ${
                provider === id ? "bg-[#ededea] text-[#0a0a0a]" : "text-[#b4b4b4] hover:text-[#ededea]"
              }`}
            >
              {PROVIDERS[id].label.replace("Google ", "").toUpperCase()}
            </button>
          ))}
        </div>

        <div className={`${LABEL} mb-2 text-[#8a8a8a]`}>API KEY</div>
        <div className="mb-2.5 flex items-stretch">
          <input
            type={reveal ? "text" : "password"}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            spellCheck={false}
            autoComplete="off"
            placeholder="sk-…"
            aria-label={`${adapter.label} API key`}
            className="min-w-0 flex-1 border-2 border-[#2a2a2a] bg-[#1c1c1c] px-3 py-3 font-mono text-[13px] tracking-[0.08em] text-[#ededea] outline-none placeholder:text-[#3d3d3d] focus:border-[#ccff00]"
          />
          <button
            type="button"
            onClick={() => setReveal((v) => !v)}
            className={`${LABEL} border-2 border-l-0 border-[#2a2a2a] bg-[#1c1c1c] px-3 text-[#b4b4b4] hover:text-[#ededea]`}
          >
            {reveal ? "HIDE" : "SHOW"}
          </button>
        </div>

        <div className="mb-4 flex items-start gap-2.5">
          <span className="mt-1 block h-1.5 w-1.5 flex-none bg-[#ccff00]" />
          <p className={`${MONO} leading-relaxed text-[#b4b4b4]`}>
            STORED IN THIS BROWSER. THE REQUEST GOES FROM YOUR MACHINE TO {adapter.label.toUpperCase()}.
            THE KEY NEVER TOUCHES OUR SERVERS.
          </p>
        </div>

        <div className="mb-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void test()}
            disabled={!apiKey.trim() || testing}
            className={`${LABEL} brutalist-shadow-dark border-2 border-[#ededea] bg-[#ededea] px-4 py-2.5 text-[#0a0a0a] disabled:opacity-50`}
          >
            {testing ? "REACHING…" : "TEST CONNECTION"}
          </button>
          {settings?.apiKey && (
            <button
              type="button"
              onClick={onDone}
              className={`${LABEL} border-2 border-[#ccff00] bg-[#ccff00] px-4 py-2.5 text-[#0a0a0a] hover:bg-[#e4ff9a] hover:border-[#e4ff9a]`}
            >
              DONE
            </button>
          )}
          {settings && (
            <button
              type="button"
              onClick={onForget}
              className={`${LABEL} border-2 border-[#2a2a2a] bg-[#1c1c1c] px-4 py-2.5 text-[#b4b4b4] hover:text-[#ededea]`}
            >
              FORGET KEY
            </button>
          )}
          <a
            href={adapter.consoleUrl}
            target="_blank"
            rel="noreferrer noopener"
            className={`${LABEL} flex items-center px-2 text-[#8a8a8a] underline decoration-[#2a2a2a] hover:text-[#ccff00]`}
          >
            GET A KEY ↗
          </a>
        </div>

        {error && (
          <p className="mb-4 border border-[#5a5a2a] bg-[#1a1a0e] px-3 py-2.5 text-xs leading-relaxed text-[#f5c433]">
            {error}
          </p>
        )}

        {/* A key with a saved model but no list yet — the list is being fetched,
            or the fetch failed. Either way the reader must be able to see which
            model their key is about to spend, not a blank space. */}
        {!models && settings?.model && (
          <div className="border border-[#2a2a2a] bg-[#0f0f0f] p-3.5">
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <span className={`${LABEL} text-[#8a8a8a]`}>MODEL</span>
              <span className={`${LABEL} text-[#8a8a8a]`}>
                {testing ? "LOADING THE LIST…" : "LIST NOT LOADED"}
              </span>
            </div>
            <div className={`${MONO} break-all text-[#ededea]`}>{settings.model}</div>
            {!testing && (
              <p className="mt-2 text-xs leading-relaxed text-[#8a8a8a]">
                Press TEST CONNECTION to load the models this key offers and pick a different one.
              </p>
            )}
          </div>
        )}

        {models && (
          <div className="border border-[#2a2a2a] bg-[#0f0f0f] p-3.5">
            <div className="mb-2 flex items-center justify-between">
              <span className={`${LABEL} text-[#8a8a8a]`}>HANDSHAKE</span>
              <span className={`${LABEL} text-[#ccff00]`}>REACHED</span>
            </div>
            {/* Tool-capable first. Every persona here calls tools, so a model
                that cannot is not a usable choice — but it is still offered,
                below the line and labelled, because hiding a model somebody is
                paying for produces a support ticket where a warning produces a
                decision. */}
            <div className={`${MONO} mb-3 leading-loose text-[#b4b4b4]`}>
              {models.filter((m) => m.toolSupport === "known").length} OF {models.length} SUPPORT
              TOOL CALLING
            </div>
            <label className={`${LABEL} mb-1.5 block text-[#8a8a8a]`} htmlFor="rc-agent-model">
              MODEL
            </label>
            <select
              id="rc-agent-model"
              value={model}
              onChange={(e) => {
                setModel(e.target.value);
                onSave({ provider, model: e.target.value, apiKey });
              }}
              className="w-full border-2 border-[#2a2a2a] bg-[#1c1c1c] px-3 py-2.5 font-mono text-xs text-[#ededea] outline-none focus:border-[#ccff00]"
            >
              {[...models]
                .sort((a, b) =>
                  a.toolSupport === b.toolSupport ? 0 : a.toolSupport === "known" ? -1 : 1
                )
                .map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                    {option.toolSupport === "unverified" ? " — tool support unverified" : ""}
                  </option>
                ))}
            </select>
            {models.find((m) => m.id === model)?.toolSupport === "unverified" && (
              <p className="mt-2 text-xs leading-relaxed text-[#f5c433]">
                We could not confirm this model supports tools. Every persona here needs them, so if
                the first answer fails, pick another model.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * No key, and our-models is not running. Not a broken page — an unconnected one.
 *
 * The second option matters as much as the first: every verdict, check and
 * deduction is on the site without an agent at all. The Robin Knight narrates
 * the record; it is not the source of it.
 */
export function NoLineOut({ onConnect }: { onConnect(): void }) {
  return (
    <div className="flex flex-col gap-3 border border-[#2a2a2a] bg-[#141414] p-4">
      <div>
        <h3 className="text-base font-semibold text-white">Connect an AI key to chat.</h3>
        <p className="mt-1 text-xs leading-relaxed text-[#b4b4b4]">
          Your key is saved in this browser. Chat requests go to your AI provider.
        </p>
      </div>
      <div>
        <button
          type="button"
          onClick={onConnect}
          className="border border-[#ededea] bg-[#ededea] px-4 py-2.5 text-xs font-semibold text-[#0a0a0a] hover:border-[#ccff00] hover:bg-[#ccff00]"
        >
          Connect key
        </button>
      </div>
    </div>
  );
}
