"use client";

/** Last resort when the root layout itself fails: plain HTML, one button. */
export default function GlobalError() {
  return (
    <html lang="hi">
      <body style={{ fontFamily: "system-ui, sans-serif", display: "flex", minHeight: "100dvh", alignItems: "center", justifyContent: "center", textAlign: "center", padding: 24 }}>
        <div>
          <h1 style={{ fontSize: 20 }}>कुछ गड़बड़ हो गई · Something went wrong</h1>
          <button
            type="button"
            onClick={() => (window.location.href = "/")}
            style={{ marginTop: 16, minHeight: 48, padding: "0 20px", borderRadius: 12, border: 0, background: "#1d4ed8", color: "#fff", fontSize: 16, fontWeight: 600 }}
          >
            फिर से शुरू करें · Start again
          </button>
        </div>
      </body>
    </html>
  );
}
