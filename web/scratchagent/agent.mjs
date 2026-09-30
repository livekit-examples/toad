// A fake LiveKit agent for testing the web app without a real LLM/voice pipeline.
//
// It polls the server for rooms, joins each new one as an agent participant, and replies to every
// typed message (topic `lk.chat`) with an echo sent as an agent transcription (`lk.transcription`),
// cycling `lk.agent.state` through thinking -> listening like a real agent would. Audio is ignored.
//
// Reads LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET from the environment (see package.json).
import { Room, RoomEvent, ParticipantKind } from "@livekit/rtc-node";
import { AccessToken, RoomServiceClient } from "livekit-server-sdk";

const { LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET } = process.env;
if (!LIVEKIT_URL || !LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
  console.error("LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET must be set (e.g. in web/.env.local)");
  process.exit(1);
}

const POLL_MS = 500;
const THINKING_MS = 600;

// The server API wants http(s):// and the room connection wants ws(s)://; accept either in LIVEKIT_URL.
const HTTP_URL = LIVEKIT_URL.replace(/^ws/, "http");
const WS_URL = LIVEKIT_URL.replace(/^http/, "ws");
const rooms = new RoomServiceClient(HTTP_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET);
const joined = new Set();

async function join(roomName) {
  const token = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
    identity: `scratch-agent-${roomName}`,
    name: "Scratch Agent",
  });
  // The web app only treats participants of kind "agent" as the agent.
  token.kind = "agent";
  token.addGrant({
    room: roomName,
    roomJoin: true,
    canPublish: true,
    canPublishData: true,
    canSubscribe: true,
    // Needed to set the lk.agent.state attribute.
    canUpdateOwnMetadata: true,
  });

  const room = new Room();
  await room.connect(WS_URL, await token.toJwt(), { autoSubscribe: false, dynacast: false });
  const setState = (state) => room.localParticipant.setAttributes({ "lk.agent.state": state });
  console.log(`[${roomName}] joined`);

  room.registerTextStreamHandler("lk.chat", async (reader, sender) => {
    const text = await reader.readAll();
    console.log(`[${roomName}] ${sender.identity}: ${text}`);
    await setState("thinking");
    await new Promise((resolve) => setTimeout(resolve, THINKING_MS));
    await room.localParticipant.sendText(`On it! You asked me to: "${text}"`, { topic: "lk.transcription" });
    await setState("listening");
  });

  // Leave once no users are left, instead of lingering until the server closes the room.
  room.on(RoomEvent.ParticipantDisconnected, async () => {
    const users = [...room.remoteParticipants.values()].filter((p) => p.kind !== ParticipantKind.AGENT);
    if (users.length === 0) {
      console.log(`[${roomName}] no users left, leaving`);
      await room.disconnect();
    }
  });

  await setState("listening");
}

async function poll() {
  try {
    for (const { name } of await rooms.listRooms()) {
      if (joined.has(name)) continue;
      joined.add(name);
      join(name).catch((e) => console.error(`[${name}] failed to join:`, e));
    }
  } catch (e) {
    console.error("listRooms failed:", e.message ?? e);
  }
}

console.log(`Scratch agent watching ${HTTP_URL} for rooms…`);
setInterval(poll, POLL_MS);
