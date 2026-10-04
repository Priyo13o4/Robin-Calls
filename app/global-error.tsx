"use client";

// L230: the root layout itself failed, so app/error.tsx cannot render; this replaces the whole document.
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en" className="dark">
      <body style={{ margin: 0, minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", background: "#0b0d0b", color: "#d8dcd5", fontFamily: "system-ui, sans-serif", textAlign: "center" }}>
        <main style={{ padding: 24 }}>
          <h1 style={{ fontSize: 22, fontWeight: 600 }}>RobinCalls did not load</h1>
          <p style={{ fontSize: 14, color: "#9aa29a", maxWidth: 420 }}>
            One of our data sources did not answer in time. Try again in a moment.
          </p>
          <button
            type="button"
            onClick={() => reset()}
            style={{ marginTop: 12, padding: "8px 16px", borderRadius: 6, border: "1px solid #f5b942", background: "transparent", color: "#f5b942", cursor: "pointer" }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
