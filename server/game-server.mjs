import { WebSocketServer, WebSocket } from "ws";
import { networkInterfaces } from "node:os";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const PORT = Number(process.env.GAME_PORT || 8787);
const __dirname = dirname(fileURLToPath(import.meta.url));
const wordGroups = JSON.parse(
  await readFile(join(__dirname, "..", "data", "palavras.json"), "utf8"),
);
const cards = Object.entries(wordGroups).flatMap(([theme, themeWords]) =>
  themeWords.map((word) => ({ theme, word })),
);
const rooms = new Map();

function send(ws, type, payload = {}) {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type, ...payload }));
  }
}

function code() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let value = "";
  do {
    value = Array.from(
      { length: 4 },
      () => alphabet[Math.floor(Math.random() * alphabet.length)],
    ).join("");
  } while (rooms.has(value));
  return value;
}

function id() {
  return crypto.randomUUID();
}

function localAddresses(roomCode = "") {
  const found = [];
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family === "IPv4" && !entry.internal && !entry.address.startsWith("169.254.")) {
        found.push(entry.address);
      }
    }
  }
  const privateNetwork = found.filter((address) => {
    if (address.startsWith("10.") || address.startsWith("192.168.")) return true;
    const match = address.match(/^172\.(\d+)\./);
    return match ? Number(match[1]) >= 16 && Number(match[1]) <= 31 : false;
  });
  return (privateNetwork.length ? privateNetwork : found).map(
    (address) => `http://${address}:3000/jogar?codigo=${roomCode}`,
  );
}

function publicRoom(room) {
  return {
    code: room.code,
    mode: room.mode,
    status: room.status,
    players: room.players.map(({ id, name, score, connected }) => ({
      id,
      name,
      score,
      connected,
    })),
    currentPlayerId: room.players[room.currentIndex]?.id ?? null,
    round: room.round,
    totalRounds: room.totalRounds,
    roundSeconds: room.roundSeconds,
    endsAt: room.endsAt,
    currentTheme: room.wordShown ? room.currentTheme : null,
    lastEvent: room.lastEvent,
    controllerConnected: Boolean(room.controller),
  };
}

function broadcast(room) {
  const snapshot = publicRoom(room);
  send(room.host, "state", { room: snapshot });
  if (room.controller) send(room.controller, "state", { room: snapshot });
  for (const player of room.players) {
    send(player.ws, "state", { room: snapshot, you: player.id });
  }
}

function fail(ws, message) {
  send(ws, "error", { message });
}

function randomCard(previous) {
  const choices = cards.filter((card) => card.word !== previous);
  return choices[Math.floor(Math.random() * choices.length)] || cards[0];
}

function canPlay(room, ws) {
  if (room.status !== "running") return false;
  if (room.mode === "single") return room.controller === ws;
  return room.players[room.currentIndex]?.ws === ws;
}

function advance(room) {
  room.currentIndex = (room.currentIndex + 1) % room.players.length;
  room.currentWord = null;
  room.currentTheme = null;
  room.wordShown = false;
}

function startRound(room) {
  room.status = "running";
  room.endsAt = Date.now() + room.roundSeconds * 1000;
  room.currentWord = null;
  room.currentTheme = null;
  room.wordShown = false;
  room.lastEvent = {
    kind: "round",
    text: `Rodada ${room.round} começou!`,
    at: Date.now(),
  };
  broadcast(room);
}

function endRound(room) {
  if (room.status !== "running") return;
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
  broadcast(room);
}

const wss = new WebSocketServer({ port: PORT });

wss.on("connection", (ws) => {
  ws.meta = {};

  ws.on("message", (raw) => {
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      return fail(ws, "Mensagem inválida.");
    }

    if (message.type === "create_room") {
      const names = (message.players || [])
        .map((name) => String(name).trim())
        .filter(Boolean)
        .slice(0, 12);
      if (names.length < 2) return fail(ws, "Adicione pelo menos 2 jogadores.");

      const roomCode = code();
      const room = {
        code: roomCode,
        host: ws,
        controller: null,
        mode: message.mode === "multi" ? "multi" : "single",
        status: "lobby",
        players: names.map((name) => ({
          id: id(),
          name,
          score: 0,
          connected: false,
          ws: null,
        })),
        currentIndex: 0,
        round: 1,
        totalRounds: Math.min(10, Math.max(1, Number(message.totalRounds) || 3)),
        roundSeconds: Math.min(
          3600,
          Math.max(15, Number(message.roundSeconds) || 600),
        ),
        endsAt: null,
        currentWord: null,
        currentTheme: null,
        wordShown: false,
        lastEvent: null,
      };
      rooms.set(roomCode, room);
      ws.meta = { role: "host", roomCode };
      send(ws, "room_created", {
        room: publicRoom(room),
        joinUrls: localAddresses(roomCode),
      });
      return;
    }

    const roomCode = String(message.code || ws.meta.roomCode || "").toUpperCase();
    const room = rooms.get(roomCode);
    if (!room) return fail(ws, "Sala não encontrada.");

    if (message.type === "inspect_room") {
      send(ws, "room_preview", { room: publicRoom(room) });
      return;
    }

    if (message.type === "join_controller") {
      if (room.mode !== "single") return fail(ws, "Esta sala usa vários celulares.");
      if (room.controller && room.controller.readyState === WebSocket.OPEN) {
        return fail(ws, "O celular compartilhado já está conectado.");
      }
      room.controller = ws;
      ws.meta = { role: "controller", roomCode };
      send(ws, "joined", { room: publicRoom(room) });
      broadcast(room);
      return;
    }

    if (message.type === "join_player") {
      if (room.mode !== "multi") return fail(ws, "Esta sala usa um celular compartilhado.");
      const player = room.players.find((item) => item.id === message.playerId);
      if (!player) return fail(ws, "Jogador não encontrado.");
      if (player.ws && player.ws.readyState === WebSocket.OPEN) {
        return fail(ws, "Esse jogador já está conectado.");
      }
      player.ws = ws;
      player.connected = true;
      ws.meta = { role: "player", roomCode, playerId: player.id };
      send(ws, "joined", { room: publicRoom(room), you: player.id });
      broadcast(room);
      return;
    }

    if (message.type === "start_game" && room.host === ws) {
      if (room.status !== "lobby") return;
      if (room.mode === "single" && !room.controller) {
        return fail(ws, "Conecte o celular antes de começar.");
      }
      if (room.mode === "multi" && !room.players.every((player) => player.connected)) {
        return fail(ws, "Todos os jogadores precisam conectar seus celulares.");
      }
      startRound(room);
      return;
    }

    if (message.type === "next_round" && room.host === ws) {
      if (room.status !== "round_end") return;
      room.round += 1;
      advance(room);
      startRound(room);
      return;
    }

    if (message.type === "reveal") {
      if (!canPlay(room, ws)) return fail(ws, "Ainda não é sua vez.");
      if (!room.currentWord) {
        const card = randomCard(room.previousWord);
        room.currentWord = card.word;
        room.currentTheme = card.theme;
      }
      room.previousWord = room.currentWord;
      room.wordShown = true;
      broadcast(room);
      send(ws, "word", { word: room.currentWord, theme: room.currentTheme });
      return;
    }

    if (message.type === "give_up") {
      if (!canPlay(room, ws)) return fail(ws, "Ainda não é sua vez.");
      const actor = room.players[room.currentIndex];
      actor.score -= 1;
      room.lastEvent = {
        kind: "give_up",
        text: `${actor.name} desistiu: −1 ponto`,
        at: Date.now(),
      };
      advance(room);
      broadcast(room);
      return;
    }

    if (message.type === "success") {
      if (!canPlay(room, ws)) return fail(ws, "Ainda não é sua vez.");
      const actor = room.players[room.currentIndex];
      const guesser = room.players.find((player) => player.id === message.guesserId);
      if (!guesser || guesser.id === actor.id) {
        return fail(ws, "Escolha quem acertou.");
      }
      actor.score += 1;
      guesser.score += 1;
      room.lastEvent = {
        kind: "success",
        text: `${actor.name} e ${guesser.name} ganharam +1 ponto`,
        at: Date.now(),
      };
      advance(room);
      broadcast(room);
    }
  });

  ws.on("close", () => {
    const room = rooms.get(ws.meta.roomCode);
    if (!room) return;
    if (ws.meta.role === "host") {
      for (const player of room.players) send(player.ws, "room_closed");
      send(room.controller, "room_closed");
      rooms.delete(room.code);
      return;
    }
    if (ws.meta.role === "controller" && room.controller === ws) {
      room.controller = null;
    }
    if (ws.meta.role === "player") {
      const player = room.players.find((item) => item.id === ws.meta.playerId);
      if (player && player.ws === ws) {
        player.connected = false;
        player.ws = null;
      }
    }
    broadcast(room);
  });
});

setInterval(() => {
  for (const room of rooms.values()) {
    if (room.status === "running" && room.endsAt && Date.now() >= room.endsAt) {
      endRound(room);
    }
  }
}, 250);

console.log(`Servidor do jogo ativo na porta ${PORT}`);
for (const url of localAddresses()) {
  console.log(`Rede local: ${url.replace("/jogar?codigo=", "")}`);
}
