"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { ConnectionBadge } from "./components/ConnectionBadge";
import { Scoreboard } from "./components/Scoreboard";
import { Timer } from "./components/Timer";
import type { GameRoom, ServerMessage } from "./lib/game";
import { socketUrl } from "./lib/game";

const initialNames = ["Ana", "Bruno", "Carla", "Diego"];

export default function HostPage() {
  const socket = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [room, setRoom] = useState<GameRoom | null>(null);
  const [joinUrls, setJoinUrls] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [mode, setMode] = useState<"single" | "multi">("single");
  const [players, setPlayers] = useState(initialNames);
  const [roundMinutes, setRoundMinutes] = useState(10);
  const [rounds, setRounds] = useState(3);

  useEffect(() => {
    let cancelled = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectDelay = 1_000;
    const hosted = window.location.protocol === "https:";

    const connect = () => {
      const ws = new WebSocket(socketUrl());
      socket.current = ws;
      ws.onopen = () => {
        setConnected(true);
        reconnectDelay = 1_000;
        if (hosted) {
          const stored = sessionStorage.getItem("mimica:host-session");
          if (stored) {
            const session = JSON.parse(stored);
            ws.send(JSON.stringify({ type: "resume", ...session }));
          }
        }
      };
      ws.onclose = () => {
        setConnected(false);
        if (!cancelled && hosted) {
          reconnectTimer = setTimeout(connect, reconnectDelay);
          reconnectDelay = Math.min(reconnectDelay * 2, 30_000);
        }
      };
      ws.onmessage = (event) => {
        const message: ServerMessage = JSON.parse(event.data);
        if (message.type === "room_created" || message.type === "state") {
          if (message.room) setRoom(message.room);
          if (message.joinUrls) setJoinUrls(message.joinUrls);
          if (message.room && message.sessionToken) {
            sessionStorage.setItem(
              "mimica:host-session",
              JSON.stringify({
                code: message.room.code,
                token: message.sessionToken,
              }),
            );
          }
        }
        if (message.type === "error") {
          const text = message.message || "Algo deu errado.";
          setError(text);
          if (text.includes("Sessão")) {
            sessionStorage.removeItem("mimica:host-session");
            setRoom(null);
          }
        }
      };
    };

    connect();
    const heartbeat = setInterval(() => {
      if (!hosted || socket.current?.readyState !== WebSocket.OPEN) return;
      const stored = sessionStorage.getItem("mimica:host-session");
      if (!stored) return;
      const session = JSON.parse(stored);
      socket.current.send(
        JSON.stringify({ type: "heartbeat", code: session.code }),
      );
    }, 5_000);

    return () => {
      cancelled = true;
      clearInterval(heartbeat);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      socket.current?.close();
    };
  }, []);

  const joinUrl = useMemo(() => {
    if (!room) return "";
    return joinUrls[0] || `${window.location.origin}/jogar?codigo=${room.code}`;
  }, [joinUrls, room]);

  const createRoom = () => {
    setError("");
    socket.current?.send(
      JSON.stringify({
        type: "create_room",
        mode,
        players,
        roundSeconds: Math.round(roundMinutes * 60),
        totalRounds: rounds,
      }),
    );
  };

  const current = room?.players.find((player) => player.id === room.currentPlayerId);

  if (!room) {
    return (
      <main className="shell setup-shell">
        <header className="topbar">
          <div className="brand">
            <span className="brand-potato">Q</span>
            <div><strong>Mímica Quente</strong><small>Painel do notebook</small></div>
          </div>
          <ConnectionBadge connected={connected} />
        </header>

        <section className="setup-grid">
          <div className="hero-copy">
            <span className="eyebrow">BATATA QUENTE + MÍMICA</span>
            <h1>Imite rápido.<br />Passe mais rápido ainda.</h1>
            <p>Crie a sala, conecte os celulares e deixe a batata decidir quem perde pontos.</p>
            <div className="rule-chips">
              <span>Acertou <b>+1</b></span>
              <span>Desistiu <b>−1</b></span>
              <span>Explodiu <b>−3</b></span>
            </div>
          </div>

          <section className="card setup-card">
            <div className="section-title"><span>Nova partida</span><small>leva menos de 1 minuto</small></div>
            <label>Como vocês vão jogar?</label>
            <div className="mode-tabs">
              <button className={mode === "single" ? "selected" : ""} onClick={() => setMode("single")}>
                <strong>1 celular</strong><small>Passem o aparelho</small>
              </button>
              <button className={mode === "multi" ? "selected" : ""} onClick={() => setMode("multi")}>
                <strong>Vários celulares</strong><small>Um para cada pessoa</small>
              </button>
            </div>

            <label>Jogadores</label>
            <div className="player-inputs">
              {players.map((name, index) => (
                <div className="player-input" key={index}>
                  <span>{index + 1}</span>
                  <input
                    aria-label={`Nome do jogador ${index + 1}`}
                    value={name}
                    onChange={(event) =>
                      setPlayers(players.map((item, i) => i === index ? event.target.value : item))
                    }
                  />
                  {players.length > 2 && (
                    <button aria-label="Remover jogador" onClick={() => setPlayers(players.filter((_, i) => i !== index))}>×</button>
                  )}
                </div>
              ))}
            </div>
            {players.length < 12 && (
              <button className="add-player" onClick={() => setPlayers([...players, ""])}>+ Adicionar jogador</button>
            )}

            <div className="settings-row">
              <label>Minutos por rodada<input type="number" min="1" max="60" value={roundMinutes} onChange={(e) => setRoundMinutes(Number(e.target.value))} /></label>
              <label>Número de rodadas<input type="number" min="1" max="10" value={rounds} onChange={(e) => setRounds(Number(e.target.value))} /></label>
            </div>
            {error && <p className="error">{error}</p>}
            <button className="primary big" onClick={createRoom} disabled={!connected}>Criar sala</button>
          </section>
        </section>
      </main>
    );
  }

  if (room.status === "finished") {
    const winner = [...room.players].sort((a, b) => b.score - a.score)[0];
    return (
      <main className="shell center-screen">
        <section className="card winner-card">
          <span className="eyebrow">FIM DE JOGO</span>
          <div className="trophy">★</div>
          <h1>{winner.name} venceu!</h1>
          <p>com {winner.score} pontos</p>
          <Scoreboard room={room} />
          <button className="primary big" onClick={() => {
            sessionStorage.removeItem("mimica:host-session");
            window.location.reload();
          }}>Jogar novamente</button>
        </section>
      </main>
    );
  }

  return (
    <main className="shell game-shell">
      <header className="topbar">
        <div className="brand"><span className="brand-potato">Q</span><div><strong>Mímica Quente</strong><small>Sala {room.code}</small></div></div>
        <ConnectionBadge connected={connected} />
      </header>

      <div className="host-grid">
        <section className="game-main">
          {room.status === "lobby" ? (
            <section className="card connect-card">
              <div>
                <span className="eyebrow">SALA CRIADA</span>
                <h1>Conecte {room.mode === "single" ? "o celular" : "os celulares"}</h1>
                <p>Todos precisam estar na mesma rede Wi‑Fi deste notebook.</p>
              </div>
              <div className="connect-content">
                <div className="qr"><QRCodeSVG value={joinUrl} size={188} /></div>
                <div className="join-info">
                  <small>Código da sala</small>
                  <strong>{room.code}</strong>
                  <span>{joinUrl.replace("http://", "")}</span>
                </div>
              </div>
              <div className="ready-list">
                {room.mode === "single" ? (
                  <div className={room.controllerConnected ? "ready" : ""}>
                    <i /> Celular compartilhado {room.controllerConnected ? "pronto" : "aguardando"}
                  </div>
                ) : room.players.map((player) => (
                  <div className={player.connected ? "ready" : ""} key={player.id}>
                    <i /> {player.name} {player.connected ? "pronto" : "aguardando"}
                  </div>
                ))}
              </div>
              {error && <p className="error">{error}</p>}
              <button className="primary big" onClick={() => socket.current?.send(JSON.stringify({ type: "start_game", code: room.code }))}>
                Começar partida
              </button>
            </section>
          ) : room.status === "round_end" ? (
            <section className="card boom-card">
              <div className="boom">BOOM!</div>
              <h1>A rodada acabou</h1>
              <p>{room.lastEvent?.text}</p>
              <button className="primary big" onClick={() => socket.current?.send(JSON.stringify({ type: "next_round", code: room.code }))}>
                Começar rodada {room.round + 1}
              </button>
            </section>
          ) : (
            <section className="play-stage">
              <Timer endsAt={room.endsAt} />
              <div className="turn-card card">
                <span className="eyebrow">AGORA É A VEZ DE</span>
                <h1>{current?.name}</h1>
                <p>{room.mode === "single" ? "Passe o celular para essa pessoa" : "Olhe o seu celular"}</p>
                {room.currentTheme ? (
                  <div className="theme-reveal">
                    <small>TEMA DA MÍMICA</small>
                    <strong>{room.currentTheme}</strong>
                  </div>
                ) : (
                  <div className="theme-pending">O tema aparece quando a palavra for revelada</div>
                )}
                <div className="heat-bar"><i /></div>
              </div>
              {room.lastEvent && <div className={`event ${room.lastEvent.kind}`}>{room.lastEvent.text}</div>}
            </section>
          )}
        </section>
        <Scoreboard room={room} />
      </div>
    </main>
  );
}
