// Roda todas as suítes: sobe o servidor estático, executa cada *.test.js em
// sequência e resume. Uso: npm test   (VERBOSE=1 npm test mostra cada verificação)
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.TEST_PORT || '4310';
const URL = `http://localhost:${PORT}`;
const VERBOSE = !!process.env.VERBOSE;
const only = process.argv.slice(2);

function waitForServer(tries = 50) {
  return new Promise((resolve, reject) => {
    const attempt = (n) => {
      http.get(URL + '/index.html', (res) => { res.resume(); resolve(); })
        .on('error', () => (n <= 0 ? reject(new Error('servidor não subiu')) : setTimeout(() => attempt(n - 1), 200)));
    };
    attempt(tries);
  });
}

function runSuite(file) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(__dirname, file)], {
      env: { ...process.env, TEST_URL: URL }, stdio: ['ignore', 'pipe', 'pipe']
    });
    let out = '';
    child.stdout.on('data', (d) => { out += d; if (VERBOSE) process.stdout.write(d); });
    child.stderr.on('data', (d) => { out += d; if (VERBOSE) process.stderr.write(d); });
    child.on('close', (code) => resolve({ file, code, out }));
  });
}

(async () => {
  const server = spawn(process.execPath, [path.join(__dirname, '..', 'serve.js')], {
    env: { ...process.env, PORT }, stdio: 'ignore'
  });
  let failed = 0;
  try {
    await waitForServer();
    const suites = fs.readdirSync(__dirname).filter((f) => f.endsWith('.test.js')).sort()
      .filter((f) => !only.length || only.some((o) => f.includes(o)));
    for (const f of suites) {
      const started = Date.now();
      const r = await runSuite(f);
      const secs = ((Date.now() - started) / 1000).toFixed(0);
      const summary = (r.out.match(/(\d+) ok, (\d+) falhas?/) || [])[0] || 'sem resumo';
      console.log(`${r.code === 0 ? 'ok  ' : 'FALHOU'} ${f}  (${summary}, ${secs}s)`);
      if (r.code !== 0) {
        failed++;
        // mostra as linhas FAIL e o final da saída (a mensagem do erro, com o seletor que travou)
        if (!VERBOSE) {
          const lines = r.out.split('\n');
          const fails = lines.filter((l) => /FAIL|✗/.test(l));
          console.log(fails.concat(['    ...'], lines.slice(-14)).map((l) => '    ' + l).join('\n'));
        }
      }
    }
  } finally {
    server.kill();
  }
  console.log(failed ? `\n${failed} suíte(s) com falha` : '\nTodas as suítes passaram');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
