import { MicIcon, ChatIcon } from "./icons";

type WelcomeProps = {
  onStart: (withVoice: boolean) => void;
  error: string | null;
};

export function Welcome({ onStart, error }: WelcomeProps) {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-8 px-4 text-center">
      <div className="space-y-3">
        <h1 className="text-3xl font-semibold tracking-tight">Toad Assistant</h1>
        <p className="max-w-md text-muted">
          Ask your agent to get things done. Talk to it, type to it, or both — you can switch at any
          time during the session.
        </p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <button
          onClick={() => onStart(true)}
          className="flex items-center justify-center gap-2 rounded-full bg-accent px-6 py-3 font-medium text-accent-fg transition hover:opacity-90"
        >
          <MicIcon className="size-5" />
          Start with voice
        </button>
        <button
          onClick={() => onStart(false)}
          className="flex items-center justify-center gap-2 rounded-full border border-border bg-surface px-6 py-3 font-medium transition hover:bg-surface-hover"
        >
          <ChatIcon className="size-5" />
          Start with text
        </button>
      </div>

      {error && (
        <p role="alert" className="max-w-md rounded-lg bg-danger/10 px-4 py-2 text-sm text-danger">
          {error}
        </p>
      )}
    </main>
  );
}
