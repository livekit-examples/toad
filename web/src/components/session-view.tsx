"use client";

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Track } from "livekit-client";
import {
  BarVisualizer,
  useAgent,
  useSessionContext,
  useSessionMessages,
  useTrackToggle,
  type AgentState,
  type ReceivedMessage,
} from "@livekit/components-react";
import { CloseIcon, MicIcon, MicOffIcon, SendIcon } from "./icons";

const STATE_LABELS: Record<AgentState, string> = {
  disconnected: "Disconnected",
  connecting: "Connecting…",
  "pre-connect-buffering": "Listening…",
  initializing: "Starting up…",
  idle: "Ready",
  listening: "Listening",
  thinking: "Thinking…",
  speaking: "Speaking",
  failed: "Agent unavailable",
};

type SessionViewProps = {
  /** Called when the session can't continue; the message is shown after returning to the welcome screen. */
  onFatalError: (message: string) => void;
};

export function SessionView({ onFatalError }: SessionViewProps) {
  const session = useSessionContext();
  const agent = useAgent(session);
  const { messages, send, isSending } = useSessionMessages(session);
  const [notice, setNotice] = useState<string | null>(null);

  // If no agent shows up in time, end the session and explain why on the welcome screen.
  useEffect(() => {
    if (agent.state === "failed") {
      onFatalError(agent.failureReasons.join(" ") || "The agent failed to join the session.");
      session.end();
    }
  }, [agent.state, agent.failureReasons, onFatalError, session]);

  return (
    <main className="mx-auto flex h-dvh w-full max-w-3xl flex-col">
      <header className="flex items-center gap-4 border-b border-border px-4 py-3">
        <BarVisualizer
          state={agent.state}
          track={agent.microphoneTrack}
          barCount={5}
          options={{ minHeight: 15 }}
          className="agent-visualizer h-8 w-14"
        />
        <div className="flex-1">
          <p className="font-medium">{agent.name || "Assistant"}</p>
          <p className="text-sm text-muted" aria-live="polite">
            {STATE_LABELS[agent.state]}
          </p>
        </div>
        <button
          onClick={() => session.end()}
          className="flex items-center gap-1.5 rounded-full bg-danger/10 px-3 py-1.5 text-sm font-medium text-danger transition hover:bg-danger/20"
        >
          <CloseIcon className="size-4" />
          End
        </button>
      </header>

      <MessageList messages={messages} />

      {notice && (
        <div role="alert" className="mx-4 flex items-center gap-3 rounded-lg bg-danger/10 px-4 py-2 text-sm text-danger">
          <span className="flex-1">{notice}</span>
          <button onClick={() => setNotice(null)} aria-label="Dismiss">
            <CloseIcon className="size-4" />
          </button>
        </div>
      )}

      <Composer
        disabled={!agent.isConnected}
        isSending={isSending}
        onSend={(text) =>
          send(text).catch((e) => setNotice(`Message failed to send: ${e instanceof Error ? e.message : e}`))
        }
        onDeviceError={(e) => setNotice(`Microphone unavailable: ${e.message}`)}
      />
    </main>
  );
}

function MessageList({ messages }: { messages: ReceivedMessage[] }) {
  const bottomRef = useRef<HTMLLIElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center px-4 text-center text-muted">
        Say hello or type a task below to get started.
      </div>
    );
  }

  return (
    <ol className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-6">
      {messages.map((msg) => {
        const fromUser = msg.from?.isLocal ?? false;
        // Agents reply via transcription even to typed input, so only the user's own speech is marked.
        const spoken = msg.type === "userTranscript";
        return (
          <li
            key={msg.id}
            className={`flex max-w-[85%] flex-col gap-1 ${fromUser ? "self-end items-end" : "self-start items-start"}`}
          >
            <div
              className={`whitespace-pre-wrap rounded-2xl px-4 py-2 leading-relaxed ${
                fromUser ? "bg-accent text-accent-fg" : "bg-surface"
              }`}
            >
              {msg.message}
            </div>
            <span className="flex items-center gap-1 px-1 text-xs text-muted">
              {spoken && <MicIcon className="size-3" />}
              {new Date(msg.timestamp).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
            </span>
          </li>
        );
      })}
      <li ref={bottomRef} aria-hidden />
    </ol>
  );
}

type ComposerProps = {
  disabled: boolean;
  isSending: boolean;
  onSend: (text: string) => void;
  onDeviceError: (error: Error) => void;
};

function Composer({ disabled, isSending, onSend, onDeviceError }: ComposerProps) {
  const [text, setText] = useState("");
  const mic = useTrackToggle({ source: Track.Source.Microphone, onDeviceError });

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setText("");
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) submit(e);
  };

  return (
    <form onSubmit={submit} className="flex items-end gap-2 border-t border-border p-4">
      <button
        type="button"
        onClick={() => mic.toggle()}
        disabled={mic.pending}
        aria-pressed={mic.enabled}
        aria-label={mic.enabled ? "Mute microphone" : "Unmute microphone"}
        className={`flex size-11 shrink-0 items-center justify-center rounded-full transition disabled:opacity-50 ${
          mic.enabled ? "bg-accent text-accent-fg" : "border border-border bg-surface hover:bg-surface-hover"
        }`}
      >
        {mic.enabled ? <MicIcon className="size-5" /> : <MicOffIcon className="size-5" />}
      </button>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        rows={1}
        placeholder={disabled ? "Waiting for agent…" : "Type a task or message…"}
        className="max-h-40 min-h-11 flex-1 resize-none rounded-2xl border border-border bg-surface px-4 py-2.5 outline-none field-sizing-content placeholder:text-muted focus:border-accent"
      />
      <button
        type="submit"
        disabled={disabled || isSending || !text.trim()}
        aria-label="Send message"
        className="flex size-11 shrink-0 items-center justify-center rounded-full bg-accent text-accent-fg transition hover:opacity-90 disabled:opacity-40"
      >
        <SendIcon className="size-5" />
      </button>
    </form>
  );
}
