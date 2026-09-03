// e2e/fixtures/malicious-origin-server.mjs
//
// A trivial second origin (different port from the app) whose only page
// attempts `new WebSocket(...)` against the real Pocketed gateway origin.
// Chromium generates the real, un-forgeable Origin header for requests this
// page makes on its own — nothing here sets an Origin manually. Supports
// both the plain-HTTP project (playwright.config.ts) and the TLS project
// (playwright.tls.config.ts, via --tls/--cert/--key).
import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { readFileSync } from 'node:fs';

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    args[argv[i].replace(/^--/, '')] = argv[i + 1];
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const port = Number(args.port || 5902);
const wsTarget = args.target || 'ws://localhost:5901/ws';
const useTls = Boolean(args.tls);

const page = `<!doctype html>
<html><body>
<div id="result">pending</div>
<script>
  const ws = new WebSocket(${JSON.stringify(wsTarget)});
  ws.onclose = (e) => { document.getElementById('result').textContent = String(e.code); };
</script>
</body></html>`;

const handler = (_req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(page);
};

const server = useTls
  ? createHttpsServer({ cert: readFileSync(args.cert), key: readFileSync(args.key) }, handler)
  : createHttpServer(handler);

server.listen(port, () => {
  console.log(`malicious-origin test server listening on ${useTls ? 'https' : 'http'}://localhost:${port}`);
});
