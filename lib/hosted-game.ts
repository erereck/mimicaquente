import type { RawData, WebSocket } from "ws";
import type Redis from "ioredis";
import wordGroups from "@/data/palavras.json";
import { redis } from "./redis";

const ROOM_TTL_SECONDS = 6 * 60 * 60;
const STREAM_KEY = "mimica:events";
const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL || "https://mimicaquente.vercel.app";

type Role = "host" | "controller" | "player";
type ConnectionMeta = {
  roomCode?: string;
  role?: Role;
  playerId?: string;
};

type StoredPlayer = {
  id: string;
  name: string;
  score: number;
  joined: boolean;
  token: string | null;
};

type StoredRoom = {
  code: string;
  mode: "single" | "multi";
  status: "lobby" | "running" | "round_end" | "finished";
  players: StoredPlayer[];
  currentIndex: number;
  round: number;
  totalRounds: number;
  roundSeconds: number;
  endsAt: number | null;
  currentWord: string | null;
  currentTheme: string | null;
  previousWord: string | null;
  wordShown: boolean;
  lastEvent: { kind: string; text: string; at: number } | null;
  turnId: number;
  hostToken: string;
  controllerToken: string | null;
  updatedAt: number;
};

type ClientMessage = Record<string, unknown> & {
  type?: string;
  code?: string;
  token?: string;
  playerId?: string;
  guesserId?: string;
  mode?: string;
  players?: unknown[];
  totalRounds?: number;
  roundSeconds?: number;
};

type Hub = {
  connections: Map<WebSocket, ConnectionMeta>;
  instanceId: string;
  streaming: boolean;
  streamClient: Redis | null;
  cursor: string;
};

const globalHub = globalThis as unknown as { mimicaHub?: Hub };
const hub: Hub =
  globalHub.mimicaHub ??
  {
    connections: new Map(),
    instanceId: crypto.randomUUID(),
    streaming: false,
    streamClient: null,
    cursor: "0-0",
  };

if (process.env.NODE_ENV !== "production") globalHub.mimicaHub = hub;

const cards = Object.entries(wordGroups as Record<string, string[]>).flatMap(
  ([theme, words]) => words.map((word) => ({ theme, word })),
);

class GameError extends Error {}

function roomKey(code: string) {
  return `mimica:room:${code}`;
}

function normalizeCode(value: unknown) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .slice(0, 4);
}

function token() {
  return crypto.randomUUID();
}

function send(ws: WebSocket, payload: Record<string, unknown>) {
  if (ws.readyState === 1) ws.send(JSON.stringify(payload));
}

function fail(ws: WebSocket, message: string) {
  send(ws, { type: "error", message });
}

function publicRoom(room: StoredRoom) {
  return {
    code: room.code,
    mode: room.mode,
    status: room.status,
    players: room.players.map((player) => ({
      id: player.id,
      name: player.name,
      score: player.score,
      connected: player.joined,
    })),
    currentPlayerId: room.players[room.currentIndex]?.id ?? null,
    round: room.round,
    totalRounds: room.totalRounds,
    roundSeconds: room.roundSeconds,
    endsAt: room.endsAt,
    currentTheme: room.wordShown ? room.currentTheme : null,
    lastEvent: room.lastEvent,
    controllerConnected: Boolean(room.controllerToken),
    turnId: room.turnId,
  };
}

function joinUrls(code: string) {
  return [`${APP_URL.replace(/\/$/, "")}/jogar?codigo=${code}`];
}

function broadcastSnapshot(snapshot: ReturnType<typeof publicRoom>) {
  for (const [ws, meta] of hub.connections) {
    if (meta.roomCode !== snapshot.code) continue;
    send(ws, {
      type: "state",
      room: snapshot,
      ...(meta.playerId ? { you: meta.playerId } : {}),
    });
  }
}

async function publishRoom(room: StoredRoom) {
  const snapshot = publicRoom(room);
  broadcastSnapshot(snapshot);
  if (!redis) return;
  await redis.xadd(
    STREAM_KEY,
    "MAXLEN",
    "~",
    500,
    "*",
    "d",
    JSON.stringify(snapshot),
    "o",
    hub.instanceId,
  );
}

function fields(values: string[]) {
  const result: Record<string, string> = {};
  for (let index = 0; index + 1 < values.length; index += 2) {
    result[values[index]] = values[index + 1];
  }
  return result;
}

async function runStream() {
  const client = hub.streamClient;
  if (!client) return;
  while (hub.streaming) {
    try {
      const response = (await client.xread(
        "COUNT",
        20,
        "BLOCK",
        5_000,
        "STREAMS",
        STREAM_KEY,
        hub.cursor,
      )) as unknown as Array<[string, Array<[string, string[]]>]> | null;
      if (!response) continue;
      for (const [, entries] of response) {
        for (const [entryId, rawFields] of entries) {
          hub.cursor = entryId;
          const event = fields(rawFields);
          if (event.o === hub.instanceId) continue;
          try {
            broadcastSnapshot(JSON.parse(event.d));
          } catch {
            // Ignore malformed relay entries.
          }
        }
      }
    } catch (error) {
      if (!hub.streaming) break;
      console.error("[mimica] Redis stream failed", error);
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }
}

async function startStream() {
  if (!redis || hub.streaming) return;
  hub.streaming = true;
  hub.streamClient = redis.duplicate();
  try {
    const tail = await redis.xrevrange(STREAM_KEY, "+", "-", "COUNT", 1);
    hub.cursor = tail[0]?.[0] ?? "0-0";
  } catch {
    hub.cursor = "0-0";
  }
  void runStream();
}

function stopStream() {
  if (hub.connections.size > 0) return;
  hub.streaming = false;
  if (hub.streamClient) {
    void hub.streamClient.quit().catch(() => {});
    hub.streamClient = null;
  }
}

async function getRoom(code: string) {
  if (!redis) throw new GameError("O Redis ainda não foi configurado na Vercel.");
  const value = await redis.get(roomKey(code));
  return value ? (JSON.parse(value) as StoredRoom) : null;
}

async function acquireLock(code: string) {
  if (!redis) throw new GameError("O Redis ainda não foi configurado na Vercel.");
  const lockKey = `${roomKey(code)}:lock`;
  const lockToken = token();
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const acquired = await redis.set(lockKey, lockToken, "PX", 4_000, "NX");
    if (acquired === "OK") return { lockKey, lockToken };
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new GameError("A sala está ocupada. Tente novamente.");
}

async function releaseLock(lockKey: string, lockToken: string) {
  if (!redis) return;
  await redis.eval(
    "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
    1,
    lockKey,
    lockToken,
  );
}

async function mutateRoom<T>(
  code: string,
  callback: (room: StoredRoom) => T | Promise<T>,
) {
  if (!redis) throw new GameError("O Redis ainda não foi configurado na Vercel.");
  const lock = await acquireLock(code);
  try {
    const room = await getRoom(code);
    if (!room) throw new GameError("Sala não encontrada.");
    const value = await callback(room);
    room.updatedAt = Date.now();
    await redis.set(
      roomKey(code),
      JSON.stringify(room),
      "EX",
      ROOM_TTL_SECONDS,
    );
    return { room, value };
  } finally {
    await releaseLock(lock.lockKey, lock.lockToken);
  }
}

function randomCard(previous: string | null) {
  const choices = cards.filter((card) => card.word !== previous);
  return choices[Math.floor(Math.random() * choices.length)] || cards[0];
}

function advance(room: StoredRoom) {
  room.currentIndex = (room.currentIndex + 1) % room.players.length;
  room.currentWord = null;
  room.currentTheme = null;
  room.wordShown = false;
  room.turnId += 1;
}

function startRound(room: StoredRoom) {
  room.status = "running";
  room.endsAt = Date.now() + room.roundSeconds * 1_000;
  room.currentWord = null;
  room.currentTheme = null;
  room.wordShown = false;
  room.lastEvent = {
    kind: "round",
    text: `Rodada ${room.round} começou!`,
    at: Date.now(),
  };
}

function endRound(room: StoredRoom) {
  if (room.status !== "running") return false;
  const holder = room.players[room.currentIndex];
  holder.score -= 3;
  room.status = room.round >= room.totalRounds ? "finished" : "round_end";
  room.endsAt = null;
  room.currentWord = null;
  room.currentTheme = null;
  room.wordShown = false;
  room.lastEvent = {
    kind: "boom",
    text: `A batata explodiu com ${holder.name}: −3 pontos`,
    at: Date.now(),
  };
  return true;
}

function expireIfNeeded(room: StoredRoom) {
  return Boolean(
    room.status === "running" &&
      room.endsAt &&
      Date.now() >= room.endsAt &&
      endRound(room),
  );
}

function requireRole(ws: WebSocket, role: Role, code: string) {
  const meta = hub.connections.get(ws);
  if (meta?.role !== role || meta.roomCode !== code) {
    throw new GameError("Esta ação não está autorizada.");
  }
  return meta;
}

function canPlay(ws: WebSocket, room: StoredRoom) {
  const meta = hub.connections.get(ws);
  if (room.status !== "running" || !meta || meta.roomCode !== room.code) {
    return false;
  }
  if (room.mode === "single") return meta.role === "controller";
  return (
    meta.role === "player" &&
    meta.playerId === room.players[room.currentIndex]?.id
  );
}

async function createRoom(ws: WebSocket, message: ClientMessage) {
  if (!redis) throw new GameError("O Redis ainda não foi configurado na Vercel.");
  const names = (message.players || [])
    .map((name) => String(name).trim())
    .filter(Boolean)
    .slice(0, 12);
  if (names.length < 2) throw new GameError("Adicione pelo menos 2 jogadores.");

  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const code = Array.from(
      { length: 4 },
      () => alphabet[Math.floor(Math.random() * alphabet.length)],
    ).join("");
    const hostToken = token();
    const room: StoredRoom = {
      code,
      mode: message.mode === "multi" ? "multi" : "single",
      status: "lobby",
      players: names.map((name) => ({
        id: token(),
        name,
        score: 0,
        joined: false,
        token: null,
      })),
      currentIndex: 0,
      round: 1,
      totalRounds: Math.min(
        10,
        Math.max(1, Number(message.totalRounds) || 3),
      ),
      roundSeconds: Math.min(
        3_600,
        Math.max(15, Number(message.roundSeconds) || 600),
      ),
      endsAt: null,
      currentWord: null,
      currentTheme: null,
      previousWord: null,
      wordShown: false,
      lastEvent: null,
      turnId: 0,
      hostToken,
      controllerToken: null,
      updatedAt: Date.now(),
    };
    const created = await redis.set(
      roomKey(code),
      JSON.stringify(room),
      "EX",
      ROOM_TTL_SECONDS,
      "NX",
    );
    if (created !== "OK") continue;
    hub.connections.set(ws, { role: "host", roomCode: code });
    send(ws, {
      type: "room_created",
      room: publicRoom(room),
      joinUrls: joinUrls(code),
      sessionToken: hostToken,
    });
    return;
  }
  throw new GameError("Não foi possível criar a sala. Tente novamente.");
}

async function resume(ws: WebSocket, message: ClientMessage) {
  const code = normalizeCode(message.code);
  const room = await getRoom(code);
  if (!room || !message.token) throw new GameError("Sessão não encontrada.");

  if (message.token === room.hostToken) {
    hub.connections.set(ws, { role: "host", roomCode: code });
    send(ws, {
      type: "room_created",
      room: publicRoom(room),
      joinUrls: joinUrls(code),
    });
    return;
  }
  if (message.token === room.controllerToken) {
    hub.connections.set(ws, { role: "controller", roomCode: code });
    send(ws, { type: "joined", room: publicRoom(room) });
    return;
  }
  const player = room.players.find((item) => item.token === message.token);
  if (player) {
    hub.connections.set(ws, {
      role: "player",
      roomCode: code,
      playerId: player.id,
    });
    send(ws, {
      type: "joined",
      room: publicRoom(room),
      you: player.id,
    });
    return;
  }
  throw new GameError("Sessão não encontrada.");
}

export function register(ws: WebSocket) {
  hub.connections.set(ws, {});
  void startStream();
}

export function unregister(ws: WebSocket) {
  hub.connections.delete(ws);
  stopStream();
}

export async function handleClientMessage(ws: WebSocket, raw: RawData) {
  try {
    const message = JSON.parse(raw.toString()) as ClientMessage;
    if (message.type === "create_room") return await createRoom(ws, message);
    if (message.type === "resume") return await resume(ws, message);

    const meta = hub.connections.get(ws);
    const code = normalizeCode(message.code || meta?.roomCode);
    if (!code) throw new GameError("Informe o código da sala.");

    if (message.type === "inspect_room") {
      const room = await getRoom(code);
      if (!room) throw new GameError("Sala não encontrada.");
      send(ws, { type: "room_preview", room: publicRoom(room) });
      return;
    }

    if (message.type === "heartbeat") {
      const room = await getRoom(code);
      if (!room) return;
      if (meta?.role === "host" && redis) {
        await redis.expire(roomKey(code), ROOM_TTL_SECONDS);
      }
      if (!expireIfNeeded(room)) return;
      const updated = await mutateRoom(code, (current) => {
        expireIfNeeded(current);
      });
      await publishRoom(updated.room);
      return;
    }

    if (message.type === "join_controller") {
      const sessionToken = token();
      const updated = await mutateRoom(code, (room) => {
        if (room.mode !== "single") {
          throw new GameError("Esta sala usa vários celulares.");
        }
        if (room.controllerToken) {
          throw new GameError("O celular compartilhado já foi conectado.");
        }
        room.controllerToken = sessionToken;
      });
      hub.connections.set(ws, { role: "controller", roomCode: code });
      send(ws, {
        type: "joined",
        room: publicRoom(updated.room),
        sessionToken,
      });
      await publishRoom(updated.room);
      return;
    }

    if (message.type === "join_player") {
      const sessionToken = token();
      let selectedId = "";
      const updated = await mutateRoom(code, (room) => {
        if (room.mode !== "multi") {
          throw new GameError("Esta sala usa um celular compartilhado.");
        }
        const player = room.players.find(
          (item) => item.id === message.playerId,
        );
        if (!player) throw new GameError("Jogador não encontrado.");
        if (player.joined) throw new GameError("Esse jogador já foi conectado.");
        player.joined = true;
        player.token = sessionToken;
        selectedId = player.id;
      });
      hub.connections.set(ws, {
        role: "player",
        roomCode: code,
        playerId: selectedId,
      });
      send(ws, {
        type: "joined",
        room: publicRoom(updated.room),
        you: selectedId,
        sessionToken,
      });
      await publishRoom(updated.room);
      return;
    }

    if (message.type === "start_game") {
      requireRole(ws, "host", code);
      const updated = await mutateRoom(code, (room) => {
        if (room.status !== "lobby") return;
        if (room.mode === "single" && !room.controllerToken) {
          throw new GameError("Conecte o celular antes de começar.");
        }
        if (
          room.mode === "multi" &&
          !room.players.every((player) => player.joined)
        ) {
          throw new GameError(
            "Todos os jogadores precisam conectar seus celulares.",
          );
        }
        room.turnId = 1;
        startRound(room);
      });
      await publishRoom(updated.room);
      return;
    }

    if (message.type === "next_round") {
      requireRole(ws, "host", code);
      const updated = await mutateRoom(code, (room) => {
        if (room.status !== "round_end") return;
        room.round += 1;
        advance(room);
        startRound(room);
      });
      await publishRoom(updated.room);
      return;
    }

    if (["reveal", "give_up", "success"].includes(message.type || "")) {
      const updated = await mutateRoom(code, (room) => {
        if (expireIfNeeded(room)) return null;
        if (!canPlay(ws, room)) throw new GameError("Ainda não é sua vez.");

        if (message.type === "reveal") {
          if (!room.currentWord) {
            const card = randomCard(room.previousWord);
            room.currentWord = card.word;
            room.currentTheme = card.theme;
          }
          room.previousWord = room.currentWord;
          room.wordShown = true;
          return {
            word: room.currentWord,
            theme: room.currentTheme || "",
            turnId: room.turnId,
          };
        }

        const actor = room.players[room.currentIndex];
        if (message.type === "give_up") {
          actor.score -= 1;
          room.lastEvent = {
            kind: "give_up",
            text: `${actor.name} desistiu: −1 ponto`,
            at: Date.now(),
          };
          advance(room);
          return null;
        }

        const guesser = room.players.find(
          (player) => player.id === message.guesserId,
        );
        if (!guesser || guesser.id === actor.id) {
          throw new GameError("Escolha quem acertou.");
        }
        actor.score += 1;
        guesser.score += 1;
        room.lastEvent = {
          kind: "success",
          text: `${actor.name} e ${guesser.name} ganharam +1 ponto`,
          at: Date.now(),
        };
        advance(room);
        return null;
      });
      await publishRoom(updated.room);
      if (updated.value) send(ws, { type: "word", ...updated.value });
      return;
    }

    throw new GameError("Ação desconhecida.");
  } catch (error) {
    const message =
      error instanceof GameError
        ? error.message
        : "O servidor encontrou um problema. Tente novamente.";
    if (!(error instanceof GameError)) {
      console.error("[mimica] message failed", error);
    }
    fail(ws, message);
  }
}
