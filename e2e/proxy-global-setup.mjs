import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureCerts } from './certs/gen-certs.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '.');
const COMPOSE_FILE = path.join(ROOT, '..', 'infra', 'reverse-proxy', 'docker-compose.yml');

export default async function globalSetup() {
  ensureCerts(); // must exist before docker-compose mounts e2e/certs/.gen into nginx
  execFileSync('docker', ['compose', '-f', COMPOSE_FILE, 'up', '-d', '--build', '--wait'], {
    stdio: 'inherit',
  });
}
