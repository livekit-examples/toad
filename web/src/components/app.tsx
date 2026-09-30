"use client";

import { useState } from "react";
import { ConnectionState, TokenSource } from "livekit-client";
import { RoomAudioRenderer, SessionProvider, StartAudio, useSession } from "@livekit/components-react";
import { SessionView } from "./session-view";
import { Welcome } from "./welcome";

// Fetches credentials from our own token route; it also decides which agent gets dispatched.
const tokenSource = TokenSource.endpoint("/api/token");

export function App() {
  const session = useSession(tokenSource);
  const [error, setError] = useState<string | null>(null);

  const start = async (withVoice: boolean) => {
    setError(null);
    try {
      await session.start({ tracks: { microphone: { enabled: withVoice } } });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <SessionProvider session={session}>
      {session.connectionState === ConnectionState.Disconnected ? (
        <Welcome onStart={start} error={error} />
      ) : (
        <SessionView onFatalError={setError} />
      )}
      <RoomAudioRenderer />
      <StartAudio
        label="Click to enable audio playback"
        className="fixed bottom-24 left-1/2 -translate-x-1/2 rounded-full bg-accent px-4 py-2 text-sm font-medium text-accent-fg shadow-lg"
      />
    </SessionProvider>
  );
}
