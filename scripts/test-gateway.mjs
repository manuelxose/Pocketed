import { ensureWebserverVenv, ROOT, run, WEBSERVER_VENV_PY } from './python-utils.mjs';

ensureWebserverVenv();

// Run from the repo root, not webserver/ — `import webserver.main` (done by
// webserver/tests/conftest.py) needs the `webserver` package resolvable,
// same requirement the gateway's own uvicorn invocation has (see README).
const extra = process.argv.slice(2);
run(WEBSERVER_VENV_PY, ['-m', 'pytest', 'webserver/tests', ...extra], { cwd: ROOT });
