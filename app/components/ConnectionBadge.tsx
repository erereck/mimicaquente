"use client";

export function ConnectionBadge({ connected }: { connected: boolean }) {
  return (
    <span className={`connection ${connected ? "online" : "offline"}`}>
      <i />
      {connected ? "Conectado" : "Reconectando"}
    </span>
  );
}
