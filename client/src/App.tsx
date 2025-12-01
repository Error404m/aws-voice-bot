import React from "react";
import VoiceBotUI from "./components/VoiceBotUI";

const App: React.FC = () => {
  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <header style={styles.header}>
          <div>
            <h1 style={styles.title}>AWS Live Voice Bot</h1>
            <p style={styles.subtitle}>
              Speak in your native language (Hindi, English, Tamil, Kannada, Marathi, Gujarati, etc.). 
              The bot will listen and respond using Gemini Live (audio to audio).
            </p>
          </div>
          <div style={styles.badge}>Live • Prototype</div>
        </header>

        <VoiceBotUI />
      </div>
    </div>
  );
};

const styles: { [key: string]: React.CSSProperties } = {
  page: {
    minHeight: "100vh",
    margin: 0,
    background: "#020617",
    color: "#e5e7eb",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontFamily:
      "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    padding: "16px",
  },
  card: {
    width: "100%",
    maxWidth: "960px",
    padding: "20px",
    borderRadius: "20px",
    border: "1px solid #1f2937",
    background:
      "radial-gradient(circle at top left, rgba(45,212,191,0.12), transparent 55%), #020617",
    boxShadow: "0 24px 60px rgba(0,0,0,0.7)",
    display: "flex",
    flexDirection: "column",
    gap: "16px",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "12px",
  },
  title: {
    fontSize: "22px",
    fontWeight: 600,
    margin: 0,
  },
  subtitle: {
    marginTop: "4px",
    fontSize: "13px",
    color: "#9ca3af",
  },
  badge: {
    fontSize: "11px",
    padding: "4px 10px",
    borderRadius: "999px",
    border: "1px solid #4b5563",
    background: "#020617",
    color: "#e5e7eb",
    whiteSpace: "nowrap",
  },
};

export default App;
