"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { signIn } from "@/lib/auth/client";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const from = params.get("from") || "/admin";
  const forbidden = params.get("error") === "forbidden";

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(
    forbidden ? "That account is not an admin." : null
  );
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await signIn.username({ username: username.trim(), password });
    if (error) {
      setError(error.message ?? "Invalid credentials.");
      setBusy(false);
      return;
    }
    router.push(from.startsWith("/admin") ? from : "/admin");
    router.refresh();
  }

  const input =
    "w-full border border-[#2a2a2a] bg-[#141414] px-4 py-3 font-mono text-sm text-[#ededea] placeholder-[#3d3d3d] outline-none focus:border-[#ccff00]";

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0a0a0a] px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <Link href="/" className="inline-block hover:opacity-80 transition-opacity">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/logo-sm.webp" alt="Home" className="mx-auto mb-4 h-9 w-9 object-contain" />
          </Link>
          <h1 className="font-cinzel text-xl font-bold tracking-[0.16em] text-[#ededea]">
            ADMIN CONSOLE
          </h1>
          <p className="mt-1 text-xs tracking-[0.14em] text-[#8a8a8a]">
            RobinCalls · restricted
          </p>
        </div>
        <form onSubmit={onSubmit} className="space-y-3">
          <input
            className={input}
            placeholder="USERNAME"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
          <input
            className={input}
            type="password"
            placeholder="PASSWORD"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {error && <p className="text-sm text-[#8a8a8a]">{error}</p>}
          <button
            type="submit"
            disabled={busy}
            className="w-full border-2 border-[#ededea] bg-[#ededea] px-6 py-3 font-cinzel text-sm font-bold tracking-[0.18em] text-[#0a0a0a] disabled:opacity-60"
          >
            {busy ? "…" : "ENTER"}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function AdminLoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
