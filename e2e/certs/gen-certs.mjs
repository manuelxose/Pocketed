// e2e/certs/gen-certs.mjs
//
// Generates a throwaway CA + leaf certificate for localhost/127.0.0.1, used
// only by the TLS/WSS E2E project (playwright.tls.config.ts) and the
// dockerized reverse-proxy project (playwright.proxy.config.ts) — never a
// real deployment cert. The browser trusts this leaf cert specifically via
// its SPKI hash (--ignore-certificate-errors-spki-list), never via a
// blanket --ignore-certificate-errors flag and never by mutating the
// system trust store (no mkcert). Idempotent: skips regeneration if a
// non-expired cert already exists. e2e/certs/.gen/ is gitignored.
import { execFileSync } from 'node:child_process';
import { X509Certificate } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const OUT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '.gen');
const CA_KEY = path.join(OUT_DIR, 'ca-key.pem');
const CA_CERT = path.join(OUT_DIR, 'ca-cert.pem');
const LEAF_KEY = path.join(OUT_DIR, 'leaf-key.pem');
const LEAF_CERT = path.join(OUT_DIR, 'leaf-cert.pem');
const LEAF_CSR = path.join(OUT_DIR, 'leaf.csr');
const SAN_CONFIG = path.join(OUT_DIR, 'san.cnf');

function isFresh(certPath) {
  if (!existsSync(certPath)) return false;
  const cert = new X509Certificate(readFileSync(certPath));
  return new Date(cert.validTo).getTime() > Date.now() + 60_000; // 1 min safety margin
}

function computeSpkiHash(certPath) {
  const cmd =
    `openssl x509 -in "${certPath}" -pubkey -noout ` +
    `| openssl pkey -pubin -outform der ` +
    `| openssl dgst -sha256 -binary ` +
    `| openssl enc -base64`;
  return execFileSync(cmd, { shell: true }).toString().trim();
}

export function ensureCerts() {
  if (isFresh(LEAF_CERT) && isFresh(CA_CERT)) {
    return { caCert: CA_CERT, leafCert: LEAF_CERT, leafKey: LEAF_KEY, spkiHash: computeSpkiHash(LEAF_CERT) };
  }
  mkdirSync(OUT_DIR, { recursive: true });

  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '7',
    '-keyout', CA_KEY, '-out', CA_CERT,
    '-subj', '/CN=Pocketed E2E Test CA',
  ]);

  writeFileSync(
    SAN_CONFIG,
    '[req]\ndistinguished_name=req\n[req_ext]\nsubjectAltName=DNS:localhost,IP:127.0.0.1\n',
  );

  execFileSync('openssl', [
    'req', '-newkey', 'rsa:2048', '-nodes',
    '-keyout', LEAF_KEY, '-out', LEAF_CSR,
    '-subj', '/CN=localhost',
    '-config', SAN_CONFIG, '-extensions', 'req_ext',
  ]);

  execFileSync('openssl', [
    'x509', '-req', '-in', LEAF_CSR,
    '-CA', CA_CERT, '-CAkey', CA_KEY, '-CAcreateserial',
    '-out', LEAF_CERT, '-days', '7',
    '-extfile', SAN_CONFIG, '-extensions', 'req_ext',
  ]);

  return { caCert: CA_CERT, leafCert: LEAF_CERT, leafKey: LEAF_KEY, spkiHash: computeSpkiHash(LEAF_CERT) };
}

// NOTE: the brief's original entrypoint check (`import.meta.url ===
// 'file://${process.argv[1]}'`) does not detect direct invocation on
// Windows — process.argv[1] is a Windows-style path (backslashes, no
// leading slash before the drive letter) while import.meta.url is a
// properly encoded file:// URL, so the strings never match and the
// script silently prints nothing. pathToFileURL() normalizes both sides
// consistently on every platform.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log('TLS test certs ready:', ensureCerts());
}
