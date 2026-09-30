"use client";

import { useState, useSyncExternalStore } from "react";
import { ConnectionState, TokenSource } from "livekit-client";
import { RoomAudioRenderer, SessionProvider, StartAudio, useSession } from "@livekit/components-react";
import { useIrisSnapshot } from "@/lib/iris/use-snapshot";
import { InboxView } from "./inbox/inbox-view";
import { SessionView } from "./session-view";
import { Welcome } from "./welcome";

// Fetches credentials from our own token route; it also decides which agent gets dispatched.
const tokenSource = TokenSource.endpoint("/api/token");

type Tab = "talk" | "inbox";

// The active tab lives in the URL hash so it survives reloads.
function subscribeHash(onChange: () => void) {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}
const readTab = (): Tab => (window.location.hash === "#inbox" ? "inbox" : "talk");

export function App() {
  const session = useSession(tokenSource);
  const iris = useIrisSnapshot();
  const tab = useSyncExternalStore(subscribeHash, readTab, () => "talk" as const);
  const [error, setError] = useState<string | null>(null);

  const start = async (withVoice: boolean) => {
    setError(null);
    try {
      await session.start({ tracks: { microphone: { enabled: withVoice } } });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const pending = iris.approvals.filter((a) => a.status === "pending").length;

  return (
    // The session and snapshot polling live here so switching tabs doesn't end a call or reset the inbox.
    <SessionProvider session={session}>
      <div className="flex h-dvh flex-col">
        <nav className="flex items-center gap-1 border-b border-border px-4 py-2" aria-label="Main">
          <span className="mr-3 font-semibold">Toad</span>
          <TabLink tab="talk" current={tab} label="Talk" />
          <TabLink tab="inbox" current={tab} label="Inbox" badge={pending} />
        </nav>
        <div className="flex min-h-0 flex-1 flex-col">
          {tab === "inbox" ? (
            <InboxView iris={iris} />
          ) : session.connectionState === ConnectionState.Disconnected ? (
            <Welcome onStart={start} error={error} />
          ) : (
            <SessionView onFatalError={setError} />
          )}
        </div>
      </div>
      <RoomAudioRenderer />
      <StartAudio
        label="Click to enable audio playback"
        className="fixed bottom-24 left-1/2 -translate-x-1/2 rounded-full bg-accent px-4 py-2 text-sm font-medium text-accent-fg shadow-lg"
      />
    </SessionProvider>
  );
}

function TabLink({ tab, current, label, badge }: { tab: Tab; current: Tab; label: string; badge?: number }) {
  const active = tab === current;
  return (
    <a
      href={`#${tab}`}
      aria-current={active ? "page" : undefined}
      className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium transition ${
        active ? "bg-surface-hover" : "text-muted hover:bg-surface"
      }`}
    >
      {label}
      {badge ? (
        <span className="rounded-full bg-accent px-1.5 text-xs text-accent-fg" aria-label={`${badge} waiting`}>
          {badge}
        </span>
      ) : null}
    </a>
  );
}
