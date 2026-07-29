import type { GameRoom } from "../lib/game";

export function Scoreboard({ room }: { room: GameRoom }) {
  const sorted = [...room.players].sort((a, b) => b.score - a.score);
  return (
    <section className="card scoreboard">
      <div className="section-title">
        <span>Placar</span>
        <small>Rodada {room.round}/{room.totalRounds}</small>
      </div>
      <div className="score-list">
        {sorted.map((player, index) => (
          <div
            className={`score-row ${player.id === room.currentPlayerId ? "active" : ""}`}
            key={player.id}
          >
            <span className="position">{index + 1}</span>
            <span className="player-name">
              {player.name}
              {room.mode === "multi" && (
                <i className={player.connected ? "dot online" : "dot"} />
              )}
            </span>
            <strong>{player.score}</strong>
          </div>
        ))}
      </div>
    </section>
  );
}
