"use client";

import { useEffect, useState } from "react";
import { formatTime } from "../lib/game";

export function Timer({ endsAt }: { endsAt: number | null }) {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const update = () =>
      setSeconds(endsAt ? Math.max(0, Math.ceil((endsAt - Date.now()) / 1000)) : 0);
    update();
    const interval = setInterval(update, 250);
    return () => clearInterval(interval);
  }, [endsAt]);

  return (
    <div className={`timer ${seconds <= 30 ? "danger" : ""}`}>
      <span>BATATA ESQUENTANDO</span>
      <strong>{formatTime(seconds)}</strong>
    </div>
  );
}
