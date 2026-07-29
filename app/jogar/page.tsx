"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ConnectionBadge } from "../components/ConnectionBadge";
import type { GameRoom, ServerMessage } from "../lib/game";
import { socketUrl } from "../lib/game";

export default function MobilePage() {
  const socket = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [code, setCode] = useState("");
  const [room, setRoom] = useState<GameRoom | null>(null);
  const [you, setYou] = useState<string | null>(null);
  const [joined, setJoined] = useState(false);
  const [word, setWord] = useState<string | null>(null);
  const [wordTheme, setWordTheme] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const queryCode = new URLSearchParams(window.location.search).get("codigo");
    if (queryCode) setCode(queryCode.toUpperCase());
    const ws = new WebSocket(socketUrl());
    socket.current = ws;
    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);
    ws.onmessage = (event) => {
      const message: ServerMessage = JSON.parse(event.data);
      if (message.type === "joined") setJoined(true);
      if ((message.type === "joined" || message.type === "state" || message.type === "room_preview") && message.room) {
        setRoom(message.room);
        if (message.you) setYou(message.you);
      }
      if (message.type === "word" && message.word) {
        setWord(message.word);
        setWordTheme(message.theme || null);
      }
      if (message.type === "state") {
        setWord(null);
        setWordTheme(null);
        setChoosing(false);
      }
      if (message.type === "error") setError(message.message || "Algo deu errado.");
      if (message.type === "room_closed") {
        setError("O notebook encerrou a sala.");
        setRoom(null);
      }
    };
    return () => ws.close();
  }, []);

  const current = room?.players.find((player) => player.id === room.currentPlayerId);
  const isTurn = room?.mode === "single" || current?.id === you;
  const availableGuessers = useMemo(
    () => room?.players.filter((player) => player.id !== current?.id) || [],
    [room, current],
  );

  const enter = () => {
    setError("");
    socket.current?.send(JSON.stringify({
      type: room ? "join_controller" : "inspect_room",
      code: code.toUpperCase(),
    }));
  };

  const choosePlayer = (playerId: string) => {
    setError("");
    socket.current?.send(JSON.stringify({ type: "join_player", code: code.toUpperCase(), playerId }));
  };

  const action = (type: string, extra = {}) =>
    socket.current?.send(JSON.stringify({ type, code: room?.code, ...extra }));

  return (
    <main className="mobile-shell">
      <header className="mobile-header">
        <div className="brand"><span className="brand-potato">Q</span><strong>Mímica Quente</strong></div>
        <ConnectionBadge connected={connected} />
      </header>

      {!joined ? (
        <section className="mobile-content join-screen">
          <span className="eyebrow">ENTRAR NA PARTIDA</span>
          <h1>Qual é o código?</h1>
          <input
            className="code-input"
            maxLength={4}
            placeholder="ABCD"
            value={code}
            onChange={(event) => setCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
          />
          {room?.mode === "multi" ? (
            <>
              <p>Agora escolha quem é você:</p>
              <div className="player-choices">
                {room.players.map((player) => (
                  <button disabled={player.connected} onClick={() => choosePlayer(player.id)} key={player.id}>
                    {player.name}<small>{player.connected ? "já conectado" : "sou eu"}</small>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <button className="primary big" disabled={code.length !== 4 || !connected} onClick={enter}>
              Entrar na sala
            </button>
          )}
          {!room && code.length === 4 && (
            <button className="text-button" onClick={enter}>Continuar</button>
          )}
          {error && <p className="error">{error}</p>}
        </section>
      ) : room?.status === "lobby" ? (
        <section className="mobile-content waiting">
          <div className="pulse-potato">Q</div>
          <span className="eyebrow">VOCÊ ESTÁ NA SALA {room.code}</span>
          <h1>Tudo pronto!</h1>
          <p>A partida começa no notebook.</p>
        </section>
      ) : room?.status === "round_end" ? (
        <section className="mobile-content waiting">
          <div className="boom small">BOOM!</div>
          <h1>Fim da rodada</h1>
          <p>{room.lastEvent?.text}</p>
        </section>
      ) : room?.status === "finished" ? (
        <section className="mobile-content waiting">
          <div className="trophy">★</div>
          <h1>Fim de jogo!</h1>
          <p>Veja o resultado no notebook.</p>
        </section>
      ) : !isTurn ? (
        <section className="mobile-content waiting">
          <div className="pulse-potato">Q</div>
          <span className="eyebrow">AGORA É A VEZ DE</span>
          <h1>{current?.name}</h1>
          {room.currentTheme && (
            <div className="theme-reveal compact">
              <small>TEMA DA MÍMICA</small>
              <strong>{room.currentTheme}</strong>
            </div>
          )}
          <p>Guarde o celular. A sua vez já chega.</p>
        </section>
      ) : (
        <section className="mobile-content turn-screen">
          <span className="eyebrow">VEZ DE {current?.name?.toUpperCase()}</span>
          {!word ? (
            <div className="reveal-box">
              <div className="hidden-word">?</div>
              <h1>Sua palavra está pronta</h1>
              <p>Não deixe ninguém olhar para a tela.</p>
              <button className="primary huge" onClick={() => action("reveal")}>Mostrar palavra</button>
            </div>
          ) : (
            <>
              <div className="word-card">
                <div className="word-theme">{wordTheme || room.currentTheme}</div>
                <small>FAÇA A MÍMICA DE</small>
                <strong>{word}</strong>
                <span>Sem falar ou apontar letras</span>
              </div>
              {!choosing ? (
                <div className="action-grid">
                  <button className="danger-button" onClick={() => action("give_up")}>Desistir<small>−1 ponto</small></button>
                  <button className="success-button" onClick={() => setChoosing(true)}>Acertaram!<small>+1 para cada</small></button>
                </div>
              ) : (
                <div className="guesser-box">
                  <h2>Quem acertou?</h2>
                  <div className="player-choices">
                    {availableGuessers.map((player) => (
                      <button onClick={() => action("success", { guesserId: player.id })} key={player.id}>{player.name}</button>
                    ))}
                  </div>
                  <button className="text-button" onClick={() => setChoosing(false)}>Voltar</button>
                </div>
              )}
            </>
          )}
          {error && <p className="error">{error}</p>}
        </section>
      )}
    </main>
  );
}
