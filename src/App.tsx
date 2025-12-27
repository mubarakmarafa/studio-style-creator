import { useMemo, useState } from "react";
import { proxyChat, proxyImage } from "./openaiProxyClient";
import { ENV_STATE } from "./env";

type ChatMsg = { role: "user" | "assistant"; text: string };

export function App() {
  const [tab, setTab] = useState<"chat" | "image">("chat");

  if (!ENV_STATE.ok) {
    return (
      <div className="page">
        <header className="header">
          <div>
            <div className="title">OpenAI Key Test (via Supabase Edge Function)</div>
            <div className="subtitle">Configuration required</div>
          </div>
        </header>
        <main className="main">
          <section className="panel">
            <h2>Missing Vite environment variables</h2>
            <div className="error">{ENV_STATE.message}</div>
            <p className="hint">
              Create <code>.env.local</code> in the project root, then stop and
              restart <code>npm run dev</code>.
            </p>
            <div className="card">
              <div className="muted">Required keys:</div>
              <ul>
                {ENV_STATE.missing.map((k) => (
                  <li key={k}>
                    <code>{k}</code>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        </main>
      </div>
    );
  }

  return (
    <div className="page">
      <header className="header">
        <div>
          <div className="title">OpenAI Key Test (via Supabase Edge Function)</div>
          <div className="subtitle">
            Your OpenAI API key stays on Supabase as <code>OPENAI_API_KEY</code>.
          </div>
        </div>
        <nav className="tabs">
          <button
            className={tab === "chat" ? "tab active" : "tab"}
            onClick={() => setTab("chat")}
          >
            Chat
          </button>
          <button
            className={tab === "image" ? "tab active" : "tab"}
            onClick={() => setTab("image")}
          >
            Image
          </button>
        </nav>
      </header>

      <main className="main">
        {tab === "chat" ? <ChatPanel /> : <ImagePanel />}
      </main>
    </div>
  );
}

function ChatPanel() {
  const [model, setModel] = useState("gpt-4.1-mini");
  const [input, setInput] = useState("Say hello and confirm you can respond.");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);

  const canSend = input.trim().length > 0 && !sending;

  async function onSend() {
    const text = input.trim();
    if (!text) return;
    setError(null);
    setSending(true);
    setMsgs((m) => [...m, { role: "user", text }]);
    setInput("");
    try {
      const res = await proxyChat(text, { model });
      setMsgs((m) => [...m, { role: "assistant", text: res.text }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="panel">
      <h2>Chat</h2>

      <div className="row">
        <label className="label">
          Model
          <input
            className="input"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="e.g. gpt-4.1-mini"
          />
        </label>
      </div>

      <div className="card">
        <div className="chatLog">
          {msgs.length === 0 ? (
            <div className="muted">
              Send a message to verify your proxy + OpenAI key.
            </div>
          ) : (
            msgs.map((m, i) => (
              <div
                key={i}
                className={m.role === "user" ? "msg user" : "msg assistant"}
              >
                <div className="msgRole">{m.role}</div>
                <div className="msgText">{m.text}</div>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="row">
        <label className="label grow">
          Message
          <textarea
            className="textarea"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            rows={4}
          />
        </label>
      </div>

      <div className="row">
        <button className="button" onClick={onSend} disabled={!canSend}>
          {sending ? "Sending…" : "Send"}
        </button>
        {error ? <div className="error">{error}</div> : null}
      </div>

      <p className="hint">
        This calls <code>/openai-proxy/chat</code> on your Supabase Edge Function.
      </p>
    </section>
  );
}

function ImagePanel() {
  const [model, setModel] = useState("gpt-image-1");
  const [size, setSize] = useState("1024x1024");
  const [prompt, setPrompt] = useState("A cute robot writing code, watercolor");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [img, setImg] = useState<{ url: string; contentType: string } | null>(
    null,
  );

  const canGen = prompt.trim().length > 0 && !loading;

  const dataUrl = useMemo(() => {
    if (!img) return null;
    return img.url;
  }, [img]);

  async function onGenerate() {
    const p = prompt.trim();
    if (!p) return;
    setError(null);
    setLoading(true);
    setImg(null);
    try {
      const res = await proxyImage(p, { model, size });
      const url = `data:${res.contentType};base64,${res.base64}`;
      setImg({ url, contentType: res.contentType });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="panel">
      <h2>Image</h2>

      <div className="row">
        <label className="label">
          Model
          <input
            className="input"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="e.g. gpt-image-1"
          />
        </label>

        <label className="label">
          Size
          <select
            className="select"
            value={size}
            onChange={(e) => setSize(e.target.value)}
          >
            <option value="1024x1024">1024x1024</option>
            <option value="1024x1536">1024x1536</option>
            <option value="1536x1024">1536x1024</option>
          </select>
        </label>
      </div>

      <div className="row">
        <label className="label grow">
          Prompt
          <textarea
            className="textarea"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={4}
          />
        </label>
      </div>

      <div className="row">
        <button className="button" onClick={onGenerate} disabled={!canGen}>
          {loading ? "Generating…" : "Generate"}
        </button>
        {error ? <div className="error">{error}</div> : null}
      </div>

      {dataUrl ? (
        <div className="card">
          <img className="image" src={dataUrl} alt="Generated" />
        </div>
      ) : null}

      <p className="hint">
        This calls <code>/openai-proxy/image</code> on your Supabase Edge Function.
      </p>
    </section>
  );
}


