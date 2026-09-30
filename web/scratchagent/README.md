# Scratch agent

A fake LiveKit agent for testing the web app without a real LLM or voice pipeline. It joins every new
room on the server as an agent participant and echoes typed messages back as agent replies.

It is **text only**: it ignores audio and never speaks, so it won't answer voice input.

```bash
pnpm scratch-agent
```

It reads `LIVEKIT_URL`, `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` from `web/.env.local`.

It doesn't use agent dispatch. It polls for rooms and joins any it finds, so `AGENT_NAME` has no
effect on it. Point it at a local or test server only, since it will join every room on that project.
