"use client";

// Catches errors in the root layout itself. Must render its own <html>/<body>.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en" className="dark">
      <body
        style={{
          background: "#0b0e14",
          color: "#eef1f8",
          fontFamily: "system-ui, sans-serif",
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "column",
          textAlign: "center",
          padding: "1.5rem",
        }}
      >
        <h1 style={{ fontSize: "1.5rem", fontWeight: 700 }}>Something went wrong</h1>
        <p style={{ marginTop: "0.5rem", color: "#8b93a7" }}>
          A critical error occurred while loading the app.
        </p>
        <button
          onClick={reset}
          style={{
            marginTop: "1.5rem",
            background: "#f59e0b",
            color: "#0b0e14",
            border: "none",
            borderRadius: "0.75rem",
            padding: "0.75rem 1.5rem",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
