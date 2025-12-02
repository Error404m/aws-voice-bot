import React from "react";
import VoiceStreamer from "./components/VoiceStreamer";

const App: React.FC = () => {
  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <h1 style={styles.title}>Multilingual Voice Chat Bot</h1>
        <p style={styles.subtitle}>
          Hold the mic, speak in Hindi, English, Tamil, Kannada, French…  
          Your voice becomes chat messages. Bot replies with “Processing…” for now.
        </p>
        <VoiceStreamer />
      </div>
    </div>
  );
};

const styles: { [key: string]: React.CSSProperties } = {
  page: {
    minHeight: "100vh",
    background: "#020617",
    color: "#e5e7eb",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  },
  card: {
    width: "100%",
    maxWidth: "900px",
    padding: "24px",
    borderRadius: "20px",
    background: "#020617",
    border: "1px solid #1f2937",
    boxShadow: "0 20px 40px rgba(0,0,0,0.5)",
    display: "flex",
    flexDirection: "column",
    gap: "16px",
  },
  title: {
    fontSize: "24px",
    marginBottom: "4px",
  },
  subtitle: {
    fontSize: "13px",
    color: "#9ca3af",
    marginBottom: "4px",
  },
};

export default App;
