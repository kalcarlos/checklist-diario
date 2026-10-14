// Utilidades compartilhadas pelos testes (Playwright + Chromium).
//
// Variáveis de ambiente:
//   TEST_URL     endereço do app (padrão http://localhost:4205); o runner define sozinho
//   PW_CHROMIUM  caminho de um Chromium já instalado (opcional; no CI o Playwright baixa o dele)
const { chromium } = require('playwright');

const URL = process.env.TEST_URL || 'http://localhost:4205';

function launchBrowser() {
  const opts = {};
  if (process.env.PW_CHROMIUM) opts.executablePath = process.env.PW_CHROMIUM;
  return chromium.launch(opts);
}

module.exports = { URL, launchBrowser };
