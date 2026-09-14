# Checklist Diário

App simples de checklist. Roda no navegador. Instala na tela inicial do iPhone. Funciona offline. Sem custo de hospedagem.

## O que ele faz

- Você cria listas: Casa, Mercado, Farmácia, Ligar/Agendar, etc.
- Cada lista tem um tipo:
  - **Rotina diária**: os itens desmarcam sozinhos todo dia à meia-noite. Bom pra tarefas domésticas repetidas.
  - **Lista simples**: os itens ficam marcados até você excluir ou limpar. Bom pra compras e afins.
- Os dados ficam salvos só no navegador do seu iPhone (localStorage). Não precisa de servidor, conta, nem internet pra usar no dia a dia.
- Tem exportar/importar backup em JSON, pra levar os dados pra outro aparelho se precisar.

## Testar no computador

```
node serve.js
```

Abre `http://localhost:8080` no navegador.

## Colocar no ar de graça (GitHub Pages)

1. Suba esta pasta pra um repositório no GitHub (pode ser privado).
2. No repositório: Settings → Pages → Source → escolha a branch (ex: `main`) e a pasta raiz.
3. O GitHub te dá uma URL tipo `https://seuusuario.github.io/checklist-diario/`.
4. Pronto, hospedagem grátis e com HTTPS (necessário pro app instalar como PWA).

Alternativas igualmente grátis: Cloudflare Pages, Netlify, Vercel. O processo é parecido: conectar o repositório e publicar.

## Instalar no iPhone

1. Abra a URL no Safari (tem que ser Safari, não Chrome).
2. Toque no ícone de compartilhar (quadrado com seta pra cima).
3. Toque em "Adicionar à Tela de Início".
4. Um ícone do app aparece na tela inicial, abre em tela cheia, funciona offline depois da primeira abertura.

## Lembretes (notificação push de verdade)

Cada lista pode ter um horário de lembrete diário (configurar no menu ⋯ da lista). Pra receber a notificação mesmo com o app fechado, é preciso:

1. Instalar o app na Tela de Início (obrigatório no iPhone — notificação push só funciona em app instalado, não numa aba do Safari).
2. Abrir pelo ícone da Tela de Início e ativar em Ajustes → Notificações.

Isso funciona graças a um servidor gratuito (Cloudflare Workers) na pasta `push-server/`, que guarda as inscrições e dispara a notificação no horário configurado. Detalhes de deploy em `push-server/README.md` (ou peça pra eu reconfigurar se precisar mudar de conta).

## Regenerar os ícones

Os ícones ficam em `icons/`. Se quiser mudar a cor ou o desenho, edite `gen-icons.js` e rode:

```
node gen-icons.js
```

## Limitação importante

Os dados **não sincronizam sozinhos entre aparelhos** (não tem servidor por trás, é assim que fica de graça). Se quiser usar no iPhone e no computador com os mesmos dados, use o exportar/importar em Ajustes. Se no futuro quiser sincronização automática, dá pra evoluir isso com um backend gratuito (ex: Firebase free tier) — mas aí some a simplicidade de "zero infraestrutura".
