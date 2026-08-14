import type { Socket } from "node:net";

/** Newline-delimited JSON framing over a Unix domain socket stream. */

/** Sends a JSON message over the socket, framed with a newline.
 * @param socket The socket to send the message on.
 * @param message The message to send.
 */
export function sendLine(socket: Socket, message: unknown): void {
  socket.write(`${JSON.stringify(message)}\n`);
}

/** Registers a handler for newline-delimited JSON messages on the socket.
 * @param socket The socket to listen on.
 * @param handler The function to call when a line is received.
 */
export function onLines(socket: Socket, handler: (line: string) => void): void {
  let buffer = "";
  socket.on("data", (chunk: Buffer) => {
    buffer += chunk.toString("utf8");
    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex !== -1) {
      const line = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);
      if (line.length > 0) handler(line);
      newlineIndex = buffer.indexOf("\n");
    }
  });
}
