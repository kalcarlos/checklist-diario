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

Abre `http://localhost:4205` no navegador (sobe também no IP da rede local, pra acessar do
celular). Também é acessível pelo [painel central](../painel-central/README.md), que sobe este
servidor sob demanda como qualquer outro produto do workspace.

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

## Backup na nuvem (não perder os dados)

Em Ajustes → "Criar backup na nuvem" gera um código de sincronização e passa a fazer backup automático (Cloudflare KV, mesmo Worker dos lembretes) toda vez que você mexe numa lista. Em outro aparelho, use "Restaurar de um código" com esse mesmo código pra recuperar tudo.

Limitação: não tem senha/criptografia nesse backup, só o código como trava (evite guardar algo sensível nas listas). Também não é sincronização em tempo real entre aparelhos — é "o último que salvou, vale" com checagem a cada ~5s enquanto o app está aberto: se editar em dois aparelhos ao mesmo tempo sem sincronizar entre as edições, o último backup sobrescreve o outro.

## Outros recursos

- **Busca** (🔍 na home): procura um texto em todos os itens de todas as listas.
- **Ordenar por** (menu ⋯ da lista): manual (arrastar), alfabética, ou pendentes primeiro. Arrastar só funciona no modo manual.
- **Vários horários de lembrete** por lista, e o lembrete não dispara se a lista já estiver toda feita.
- **Bloqueio do app** (Ajustes): pede Face ID/Touch ID/senha do aparelho pra abrir, usando WebAuthn — a chave fica só no aparelho, não sincroniza.
- **Lixeira** (🗑️ na home): listas e itens excluídos ficam recuperáveis por 7 dias.
