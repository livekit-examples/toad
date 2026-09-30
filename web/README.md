# Toad Assistant (web)

A Next.js app for talking to a [LiveKit Agent](https://docs.livekit.io/agents/) by voice, text, or both.
You can prompt the agent to do tasks either way, and the conversation is shown as a single transcript.

## How it works

- `src/app/api/token/route.ts` mints a LiveKit access token. It follows the `TokenSource.endpoint`
  request/response contract from `livekit-client`. If `AGENT_NAME` is set, the token dispatches that
  agent into the room.
- `src/components/app.tsx` manages the connection with `useSession` from `@livekit/components-react`.
  You can start with the microphone on (voice) or off (text only).
- `src/components/session-view.tsx` renders the agent's state, a merged transcript of spoken and typed
  messages (`useSessionMessages`), a text box, and a mic toggle. Typed messages go to the agent on the
  standard `lk.chat` text stream topic. The agent's replies arrive as transcriptions.

## Setup

```bash
pnpm install
cp .env.example .env.local   # then fill in your LiveKit URL, API key and secret
pnpm dev
```

If you use the LiveKit CLI, `lk app env -w` can write `.env.local` from a configured project.

Open http://localhost:3000.

## Agent requirements

You need a running agent (Python or Node.js LiveKit Agents) connected to the same LiveKit project.
Text input works with the default `AgentSession` room options, which listen on `lk.chat`.

- **Explicit dispatch**: set `agent_name` on your agent and set `AGENT_NAME` to the same value here.
- **Automatic dispatch**: leave `AGENT_NAME` empty. The agent must not set an `agent_name`.

If no agent joins within about 20 seconds, the session ends and the app shows an error.

To try the UI without a real agent, run `pnpm scratch-agent` alongside `pnpm dev`.
It's a fake agent that echoes typed messages; see [scratchagent/README.md](scratchagent/README.md).
