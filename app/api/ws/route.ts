import {
  experimental_upgradeWebSocket,
  type WebSocketData,
} from "@vercel/functions";
import {
  handleClientMessage,
  register,
  unregister,
} from "@/lib/hosted-game";

export const maxDuration = 300;

export function GET() {
  return experimental_upgradeWebSocket((ws) => {
    register(ws);
    ws.on("message", (data: WebSocketData) => {
      void handleClientMessage(ws, data);
    });
    ws.on("close", () => unregister(ws));
    ws.on("error", () => unregister(ws));
  });
}
