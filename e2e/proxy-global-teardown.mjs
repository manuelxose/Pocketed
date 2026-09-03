import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '.');
const COMPOSE_FILE = path.join(ROOT, '..', 'infra', 'reverse-proxy', 'docker-compose.yml');

export default async function globalTeardown() {
  execFileSync('docker', ['compose', '-f', COMPOSE_FILE, 'down', '-v'], { stdio: 'inherit' });
}
