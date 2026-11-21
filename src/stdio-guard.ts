// Import this module before anything else. MCP's stdio transport reserves
// stdout for JSON-RPC, but launcher dependencies print download progress and
// notices with console.log and process.stdout.write. One stray line corrupts
// the protocol stream for the client.
import { Writable } from "node:stream";

const writeToRealStdout = process.stdout.write.bind(process.stdout);

// The transport writes through this private stream. Nothing else holds a
// reference to the real descriptor once the redirect below is installed.
export const protocolStdout = new Writable({
  decodeStrings: false,
  write(chunk: string | Uint8Array, encoding, callback) {
    if (typeof chunk === "string") {
      writeToRealStdout(chunk, encoding, callback);
    } else {
      writeToRealStdout(chunk, callback);
    }
  },
});

// console.log/info/debug resolve process.stdout at call time, so redirecting
// the stream's write covers them along with direct process.stdout.write calls.
process.stdout.write = ((
  chunk: string | Uint8Array,
  encodingOrCallback?: BufferEncoding | ((error?: Error | null) => void),
  callback?: (error?: Error | null) => void,
): boolean => {
  if (typeof encodingOrCallback === "function") {
    return process.stderr.write(chunk, encodingOrCallback);
  }
  return process.stderr.write(chunk, encodingOrCallback, callback);
}) as typeof process.stdout.write;

// camoufox-js reads this Playwright variable at launch: when set it prints a
// notice and returns before registering the installed uBlock Origin addon, so
// every launch silently loses the addon. The server never downloads a browser
// (see browser-preflight.ts), so the variable has no legitimate effect here.
// It stays in effect for the separate fetch command, which is where it belongs.
delete process.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD;
