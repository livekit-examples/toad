import { AccessToken, RoomAgentDispatch, RoomConfiguration } from "livekit-server-sdk";
import type { TokenSourceRequestPayload, TokenSourceResponsePayload } from "livekit-client";

const API_KEY = process.env.LIVEKIT_API_KEY;
const API_SECRET = process.env.LIVEKIT_API_SECRET;
const LIVEKIT_URL = process.env.LIVEKIT_URL;
const AGENT_NAME = process.env.AGENT_NAME;

// Issues a LiveKit access token for the browser. The request/response shapes follow the
// `TokenSource.endpoint` contract from livekit-client, so the client can call this route directly.
export async function POST(request: Request) {
  if (!API_KEY || !API_SECRET || !LIVEKIT_URL) {
    return Response.json(
      { error: "LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET must be set" },
      { status: 500 },
    );
  }

  let body: Partial<TokenSourceRequestPayload> = {};
  try {
    body = await request.json();
  } catch {
    // An empty body is fine; defaults are used below.
  }

  const suffix = crypto.randomUUID().slice(0, 8);
  const roomName = body.room_name || `assistant-${suffix}`;
  const identity = body.participant_identity || `user-${suffix}`;

  const token = new AccessToken(API_KEY, API_SECRET, {
    identity,
    name: body.participant_name || "User",
    metadata: body.participant_metadata,
    attributes: body.participant_attributes,
    ttl: "15m",
  });
  token.addGrant({
    room: roomName,
    roomJoin: true,
    canPublish: true,
    canPublishData: true,
    canSubscribe: true,
  });

  // Explicit agent dispatch: prefer what the client asked for, fall back to AGENT_NAME.
  // With neither set, any agent registered for automatic dispatch will join.
  const roomConfig = body.room_config
    ? RoomConfiguration.fromJson(body.room_config as never, { ignoreUnknownFields: true })
    : new RoomConfiguration();
  if (roomConfig.agents.length === 0 && AGENT_NAME) {
    roomConfig.agents = [new RoomAgentDispatch({ agentName: AGENT_NAME })];
  }
  if (roomConfig.agents.length > 0) {
    token.roomConfig = roomConfig;
  }

  const response: TokenSourceResponsePayload = {
    server_url: LIVEKIT_URL,
    participant_token: await token.toJwt(),
  };
  return Response.json(response, { headers: { "Cache-Control": "no-store" } });
}
