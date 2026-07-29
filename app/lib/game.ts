export type Player = {
  id: string;
  name: string;
  score: number;
  connected: boolean;
};

export type GameRoom = {
  code: string;
  mode: "single" | "multi";
  status: "lobby" | "running" | "round_end" | "finished";
  players: Player[];
  currentPlayerId: string | null;
  round: number;
  totalRounds: number;
  roundSeconds: number;
  endsAt: number | null;
  currentTheme: string | null;
  lastEvent: { kind: string; text: string; at: number } | null;
  controllerConnected: boolean;
  turnId: number;
};

export type ServerMessage = {
  type: string;
  room?: GameRoom;
  joinUrls?: string[];
  you?: string;
  word?: string;
  theme?: string;
  turnId?: number;
  sessionToken?: string;
  message?: string;
};

export function socketUrl() {
  if (typeof window === "undefined") return "ws://localhost:8787";
  if (window.location.protocol === "https:") {
    return `wss://${window.location.host}/api/ws`;
  }
  return `ws://${window.location.hostname}:8787`;
}

export function formatTime(total: number) {
  const safe = Math.max(0, total);
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
