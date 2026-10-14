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

## Contas e compartilhamento

Ao abrir o app dá pra criar uma conta (usuário + senha) ou continuar sem conta. Também dá pra entrar/criar conta com login do Google, ou vincular o Google a uma conta usuário+senha já existente (em Ajustes → "Vincular login com Google"). Com conta, as listas sincronizam entre aparelhos (Cloudflare D1, mesmo Worker dos lembretes) a cada ~5s e podem ser compartilhadas: no menu da lista, "Compartilhar com pessoas" gera um convite (link ou código, vale 7 dias) com papel **editor** (mexe nos itens) ou **leitor** (só vê). O dono também renomeia, exclui e gerencia membros. As permissões são aplicadas pelo servidor. Conflitos são resolvidos por item. Cada lista aceita no máximo 20 membros além do dono. Quando alguém aceita um convite, o dono recebe um aviso na hora (na próxima sincronização do aparelho dele).

Em Ajustes também dá pra trocar o nome de usuário e excluir a própria conta (apaga o login e as listas que você é dono; elas somem pra quem mais usa também, mas ficam como cópia local em quem já tinha sincronizado). Não há recuperação de senha (não existe e-mail): anote a sua. No primeiro login o app oferece enviar as listas do aparelho pra conta. Quem já usava o antigo código de sincronização continua podendo usá-lo enquanto não entrar numa conta (esses backups não são migrados automaticamente).

O lembrete diário de cada lista é por pessoa: numa lista compartilhada, cada um escolhe o próprio horário no menu da lista, mesmo quem não é dono — isso nunca sincroniza entre contas.

## Outros recursos

- **Desfazer**: ao excluir um item ou uma lista (sem compartilhamento), limpar concluídos ou marcar/desmarcar todos, aparece um aviso "Desfazer" por 6 segundos que devolve tudo no lugar de origem. Listas compartilhadas continuam pedindo confirmação, porque a exclusão no servidor não volta.
- **Primeira abertura guiada**: só em instalação nova (3 passos: boas-vindas, perfil de uso e modelos). Os perfis ("preciso de ajuda para focar", "ritmo mais tranquilo", "só o básico") apenas ligam ou desligam opções que já existem em Ajustes; dá pra trocar depois em Ajustes → Perfil de uso.
- **Modelos de lista** (manhã, noite, casa em 15 minutos, mercado, mala de viagem, contas) na tela Nova lista, e **Duplicar lista** no menu da lista.
- **Recompensa pessoal** (menu da lista → Recompensa ao concluir): ao terminar a lista aparece o combinado ("☕ Um café"), uma vez por dia por lista. Fica só neste aparelho.
- **Passos dentro da tarefa**: toque no texto de um item para abrir o painel. Dá para adicionar passos (colar várias linhas cria vários), marcar cada um e ver o progresso "2/4". Fechar o último passo conclui a tarefa; reabrir um passo reabre. Os passos também aparecem no modo foco e "Dividir em passos" cria passos dentro da tarefa (ou tarefas separadas, se preferir). No reinício diário das rotinas os passos desmarcam junto.
- **Adiar** (painel da tarefa ou modo foco): amanhã, em 3 dias ou semana que vem. A tarefa sai das contagens, do "Para agora" e do foco e volta sozinha na data; dá para trazer de volta antes. Tem "Desfazer".
- **Rotina por dias da semana** (menu da rotina → Dias da semana): fora desses dias o cartão fica tracejado ("hoje não · volta qua"), a rotina não entra em "Para agora" nem na saudação. O lembrete push só respeita os dias depois de publicar o Worker atualizado (`push-server/`); sem isso ele continua avisando todo dia, como antes.
- **Prioridades do dia** (⭐ no painel da tarefa): escolha até 3; "Para agora" passa a mostrar só as escolhidas até o fim do dia ("Limpar escolhas" volta ao automático). Ficam só neste aparelho.
- **Som relaxante no "Respirar um pouco"** (home e modo foco): chuva suave, ondas ou tom calmo, gerados no próprio aparelho (sem arquivos, funciona offline), que sobem ao inspirar e descem ao soltar o ar. Desligado por padrão, só toca depois de um toque seu, tem volume, entra e sai com fade e para sozinho ao fechar a pausa ou ao ir para segundo plano. No iPhone o botão lateral de silêncio pode calar o som; o app pede reprodução ao sistema (Audio Session) e usa um áudio mudo de apoio, mas se ainda assim ficar mudo, confira esse botão e o volume.

- **Busca** (🔍 na home): procura um texto em todos os itens de todas as listas.
- **Ordenar por** (menu ⋯ da lista): manual (arrastar), alfabética, ou pendentes primeiro. Arrastar só funciona no modo manual.
- **Vários horários de lembrete** por lista, e o lembrete não dispara se a lista já estiver toda feita.
- **Bloqueio do app** (Ajustes): pede Face ID/Touch ID/senha do aparelho pra abrir, usando WebAuthn — a chave fica só no aparelho, não sincroniza.
- **Lixeira** (🗑️ na home): listas e itens excluídos ficam recuperáveis por 7 dias.
- **Progresso e feedback** (pensado também para quem tem TDAH): ao marcar um item há uma animação curta, vibração leve (onde o aparelho suporta) e, ao concluir uma lista, uma mensagem de comemoração que varia. Dentro da lista aparece "Faltam N" com barra de progresso; na home, um resumo de dias ativos nos últimos 7 dias, que abre um calendário das últimas 12 semanas. Não há punição: a sequência tem um "perdão" a cada 7 dias e o contador nunca zera por um dia perdido. Respeita "reduzir movimento" do aparelho e dá pra desligar tudo em Ajustes. Há também conquistas suaves (primeiro item, lista completa, dias ativos na semana, sequência de 7, 50/200 itens), que nunca se perdem e aparecem no histórico. Dentro da lista, o **Modo foco** mostra uma tarefa por vez (Feito / Pular por agora), com letra ajustável (toque no texto) e "Dividir em passos menores" (a tarefa original vai pra lixeira). Na primeira abertura do dia, um convite gentil lembra quantas tarefas de rotina há hoje. O histórico fica só no aparelho (não sincroniza nem entra no backup).
- **Para ansiedade e TDAH** (tudo opcional em Ajustes): na home, o bloco **Para agora** mostra só as 3 próximas tarefas (rotinas primeiro) e dá pra marcar ali mesmo; o **cronômetro suave** do modo foco (5/10/25 min, só uma barra, sem alarme alto) e a **pausa para respirar** de 1 minuto (inspira 4s, solta 6s; dentro do foco e na home); e o **modo tranquilo**, que esconde contagens e números ("Faltam N", dias ativos, relógio do timer) e deixa só frases de incentivo e as barras.

## Design

O visual segue um design system próprio, todo em `styles.css`: tokens de cor (claro/escuro automático), espaçamento em múltiplos de 4px, escala de raios e de tipografia, elevação e movimento. Ícones são SVG de traço (`currentColor`), alvos de toque têm 44px (o círculo de marcar tem área estendida), modais são folhas que sobem de baixo e fecham arrastando a alça, e as telas têm transições curtas. Tudo respeita "reduzir movimento". Em telas largas o app fica centralizado em até 720px. Ao mexer em cores ou medidas, altere os tokens em `:root` em vez de valores soltos.

### Cores e ícone

A paleta foi pensada para ser calma (útil para ansiedade e TDAH): fundo "papel" quente no claro e azul-noite no escuro (sem branco nem preto puros, para cansar menos a vista), **índigo** como cor de ação, **verde-sálvia** só para "feito" (sempre acompanhado do ✓ e do texto riscado, nunca só a cor), **coral fechado** apenas em ações destrutivas e **âmbar suave** para incentivo. Nada pisca nem usa vermelho de alerta para "atraso". Cada lista ganha um tom próprio no ícone, derivado do id, para ser reconhecida de relance. A barra de progresso é índigo enquanto avança e vira verde ao concluir. Todos os pares de texto e fundo passam no contraste WCAG AA (4,5:1).

O ícone (`icons/`) é gerado por `node gen-icons.js`, sem dependências: círculo claro com check sobre degradê índigo, o mesmo símbolo de "feito" da interface. Há versões normal (cantos arredondados), opaca para o iPhone (`apple-touch-icon`, o iOS arredonda sozinho) e *maskable* para Android. As URLs levam `?v=2`; ao trocar o desenho, aumente esse número em `index.html` e `manifest.json`. **No iPhone o ícone da Tela de Início só muda se o app for removido e adicionado de novo** (exporte um backup antes ou entre numa conta, porque os dados locais ficam no app instalado).

## Testes

Testes de ponta a ponta com Playwright (Chromium), cobrindo fluxos, layout em várias larguras, temas, contraste WCAG e o caso do `index.html` antigo em cache. O runner sobe o servidor sozinho.

```
npm ci
npx playwright install chromium    # uma vez
npm test                           # resume por suíte (VERBOSE=1 mostra cada verificação)
npm test -- lote1                  # só as suítes cujo nome contém "lote1"
```

Com um Chromium já instalado, use `PW_CHROMIUM=/caminho/do/chromium npm test`. O GitHub Actions (`.github/workflows/tests.yml`) roda tudo em cada pull request e push na `main`.
