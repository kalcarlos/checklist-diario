(function () {
  'use strict';

  // Funções puras ficam em pure.js. Um index.html antigo em cache não carrega esse arquivo:
  // nesse caso (raro) ele é lido aqui, de forma síncrona, antes de seguir.
  if (!window.CDPure) {
    try {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', 'pure.js', false);
      xhr.send();
      (0, eval)(xhr.responseText); // eslint-disable-line no-eval
    } catch (e) {}
  }
  var P = window.CDPure;
  var dayKey = P.dayKey, rhythm = P.rhythm, plain = P.plain, parseWhen = P.parseWhen, findLinks = P.findLinks;

  var STORAGE_KEY = 'checklist-diario:v1';
  var SYNC_CODE_KEY = 'checklist-diario:syncCode';
  var LAST_SYNC_KEY = 'checklist-diario:lastSyncedAt';
  var CLOUD_POLL_INTERVAL_MS = 5000;
  var SESSION_KEY = 'checklist-diario:session';
  var SKIP_LOGIN_KEY = 'checklist-diario:skipLogin';
  var PENDING_INVITE_KEY = 'checklist-diario:pendingInvite';
  var API_URL_KEY = 'checklist-diario:apiUrl'; // só pra testar contra um Worker local
  var TRASH_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

  // Ícone de "alça" pra arrastar (SVG em vez de emoji/texto, pra ficar
  // certinho alinhado com os outros botões). É a forma confiável de
  // arrastar no toque: "segurar em qualquer lugar" esbarra no gesto
  // nativo de rolar a tela e o navegador às vezes cancela o toque.
  var DRAG_ICON =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' +
    '<circle cx="8" cy="5" r="2"/><circle cx="8" cy="12" r="2"/><circle cx="8" cy="19" r="2"/>' +
    '<circle cx="16" cy="5" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="16" cy="19" r="2"/>' +
    '</svg>';
  // Ícones de traço (SVG) — mesmos do index.html, para o que o JS desenha.
  function icon(body, cls) {
    return '<svg class="i' + (cls ? ' ' + cls : '') + '" viewBox="0 0 24 24" aria-hidden="true">' + body + '</svg>';
  }
  var ICONS = {
    edit: icon('<path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17z"/><path d="m14 7 3 3"/>', 'sm'),
    trash: icon('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>', 'sm'),
    exit: icon('<path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4M10 8l-4 4 4 4M6 12h10"/>', 'sm'),
    check: icon('<path d="m5 12.5 4.5 4.5L19 7.5"/>'),
    x: icon('<path d="M6 6l12 12M18 6 6 18"/>', 'sm'),
    plus: icon('<path d="M12 5v14M5 12h14"/>', 'sm'),
    wind: icon('<path d="M3 8h10a2.5 2.5 0 1 0-2.5-2.5M3 12h15a3 3 0 1 1-3 3M3 16h7"/>', 'sm')
  };

  var EMOJI_CHOICES = [
    '🏠', '🛒', '💊', '📞', '🧺', '🐶', '🐱', '💼', '🧹', '🚗', '💰', '🏋️',
    '📚', '🍽️', '🧴', '🪴', '👶', '🎂', '🎁', '✈️', '🏥', '🦷', '👓', '💇',
    '💅', '🧾', '📦', '🔧', '🔌', '🧑‍💻', '📅', '🐾', '🍎', '🧽', '🛠️', '🎓',
    '⚽', '🎮', '🎵', '🌱', '🧻', '📮', '🏦', '⛪', '🚲', '🧵', '🐦', '🧯',
    '🌅', '🌙', '🧳'
  ];

  // Preencher com a URL do Worker depois de "wrangler deploy" (ex: https://checklist-diario-push.SEU-SUBDOMINIO.workers.dev)
  // Client ID OAuth do Google (público, pode ficar no código). Vazio = botão do Google escondido.
  var GOOGLE_CLIENT_ID = '848411907261-lj6tec41plj1cflfgbrtiselhi3vljtu.apps.googleusercontent.com';
  var PUSH_SERVER_URL = 'https://checklist-diario-push.kalcarlos.workers.dev';
  try { PUSH_SERVER_URL = localStorage.getItem(API_URL_KEY) || PUSH_SERVER_URL; } catch (e) {}
  var VAPID_PUBLIC_KEY = 'BGxLxsYdfeBxWWcN37VXpQrfOF5ME3a23FxJSwsayVup0N0ub6OVpDFi8-U6RwvAKLOu1f_BfqsdAaBbIb2Zmsg';

  // Dicionário inicial pra sugerir lista com base no texto do item. Além
  // disso o app aprende sozinho com o que você realmente adiciona em cada
  // lista (ver "sugestão de lista" mais abaixo).
  var CATEGORY_SEED = {
    mercado: {
      name: 'Mercado', emoji: '🛒',
      hints: ['merc', 'compra', 'supermerc'],
      words: ['leite', 'pao', 'arroz', 'feijao', 'acucar', 'cafe', 'detergente', 'sabao',
        'fruta', 'verdura', 'legume', 'carne', 'frango', 'ovo', 'manteiga', 'queijo',
        'iogurte', 'agua', 'refrigerante', 'cerveja', 'macarrao', 'molho', 'tempero',
        'sal', 'oleo', 'biscoito', 'bolacha', 'salgadinho', 'chocolate', 'shampoo',
        'condicionador', 'esponja', 'fosforo', 'pilha', 'racao', 'papel']
    },
    farmacia: {
      name: 'Farmácia', emoji: '💊',
      hints: ['farm'],
      words: ['dipirona', 'paracetamol', 'ibuprofeno', 'remedio', 'vitamina', 'curativo',
        'alcool', 'soro', 'pomada', 'xarope', 'protetor', 'absorvente', 'termometro',
        'mascara', 'gaze', 'receita', 'antialergico', 'colirio', 'fralda', 'band']
    },
    casa: {
      name: 'Casa', emoji: '🏠',
      hints: ['casa', 'domestic', 'limpeza'],
      words: ['lavar', 'louca', 'roupa', 'passar', 'aspirar', 'varrer', 'limpar',
        'banheiro', 'cozinha', 'lixo', 'regar', 'planta', 'cachorro', 'gato', 'passear',
        'arrumar', 'cama', 'poeira', 'organizar', 'lencol', 'tapete', 'janela',
        'geladeira', 'fogao']
    },
    contato: {
      name: 'Ligar / Agendar', emoji: '📞',
      hints: ['ligar', 'agend', 'contat', 'telefon'],
      words: ['ligar', 'agendar', 'marcar', 'consulta', 'dentista', 'medico', 'mecanico',
        'cabeleireiro', 'banco', 'agencia', 'cobranca', 'reuniao', 'entrevista', 'email',
        'whatsapp', 'encanador', 'eletricista', 'plano', 'seguro']
    }
  };
  var STOPWORDS = ['de', 'da', 'do', 'das', 'dos', 'para', 'pra', 'um', 'uma', 'uns', 'umas',
    'e', 'o', 'a', 'os', 'as', 'com', 'no', 'na', 'nos', 'nas', 'em', 'ao', 'aos', 'ou', 'que', 'se'];

  var state = null;
  var currentListId = null;

  var session = null; // { token, username } quando logado
  try { session = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch (e) { session = null; }

  function canEditItems(list) { return !list.role || list.role === 'owner' || list.role === 'editor'; }
  function canEditMeta(list) { return !list.role || list.role === 'owner'; }
  var ROLE_LABELS = { owner: 'dono', editor: 'editor', viewer: 'leitor' };
  var itemFilter = 'all'; // 'all' | 'done' | 'pending'
  var recentDragEndAt = 0; // evita abrir/clicar em algo por engano logo após soltar um arrasto

  // ---------- persistência ----------

  function todayStr() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  // ---------- sugestão de lista pelo texto do item ----------

  function normalizeAccents(s) {
    return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
  }

  function autoGrow(textarea) {
    textarea.style.height = 'auto';
    textarea.style.height = textarea.scrollHeight + 'px';
  }

  // ---------- arrastar pra reordenar (funciona com mouse e toque) ----------

  var LONG_PRESS_MS = 380;
  var LONG_PRESS_MOVE_TOLERANCE = 8;

  function setupDragReorder(container, row, handle, arr, item, onDone) {
    row.__item = item;
    var dragging = false, startY = 0, suppressNextClick = false;

    function clearHighlights() {
      Array.prototype.forEach.call(container.children, function (r) {
        r.classList.remove('drag-over-top', 'drag-over-bottom');
      });
    }

    function siblingsOf() {
      return Array.prototype.slice.call(container.children).filter(function (r) { return r !== row; });
    }

    function onMove(e) {
      if (!dragging) return;
      e.preventDefault(); // segura o scroll da lista enquanto arrasta
      row.style.transform = 'translateY(' + (e.clientY - startY) + 'px)';
      clearHighlights();
      siblingsOf().forEach(function (r) {
        var rect = r.getBoundingClientRect();
        if (e.clientY >= rect.top && e.clientY <= rect.bottom) {
          r.classList.add(e.clientY < rect.top + rect.height / 2 ? 'drag-over-top' : 'drag-over-bottom');
        }
      });
    }

    function computeDropIndex(clientY) {
      var siblings = siblingsOf();
      for (var i = 0; i < siblings.length; i++) {
        var rect = siblings[i].getBoundingClientRect();
        if (clientY < rect.top + rect.height / 2) return arr.indexOf(siblings[i].__item);
      }
      return arr.length - 1;
    }

    function endDrag(e) {
      if (!dragging) return;
      dragging = false;
      suppressNextClick = true;
      recentDragEndAt = Date.now();
      row.classList.remove('dragging');
      row.style.transform = '';
      row.style.position = '';
      row.style.zIndex = '';
      clearHighlights();
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', endDrag);
      window.removeEventListener('pointercancel', endDrag);

      var dropIndex = computeDropIndex(e.clientY);
      var currentIndex = arr.indexOf(item);
      if (dropIndex !== currentIndex && dropIndex >= 0) {
        arr.splice(currentIndex, 1);
        if (dropIndex > currentIndex) dropIndex--;
        arr.splice(dropIndex, 0, item);
        onDone();
      }
    }

    function beginDrag(clientY) {
      dragging = true;
      startY = clientY;
      row.classList.add('dragging');
      row.style.position = 'relative';
      row.style.zIndex = '5';
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', endDrag);
      window.addEventListener('pointercancel', endDrag);
    }

    // Evita que o clique de "soltar depois de arrastar" também dispare a
    // navegação/edição por baixo (ex: abrir a lista na home).
    row.addEventListener('click', function (e) {
      if (!suppressNextClick) return;
      suppressNextClick = false;
      e.stopImmediatePropagation();
      e.preventDefault();
    }, true);

    // Alça: arrasta na hora, sem precisar segurar. É o jeito confiável
    // no toque, porque o "touch-action: none" fica só nela — assim ela
    // nunca compete com o gesto de rolar a lista.
    handle.addEventListener('click', function (e) { e.stopPropagation(); });
    handle.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      e.stopPropagation();
      beginDrag(e.clientY);
    });

    // Bônus: segurar em qualquer outro lugar da linha (fora dos botões)
    // também arrasta, depois de um toque e segure curto. Funciona bem
    // com mouse; no toque pode falhar às vezes porque compete com o
    // gesto nativo de rolar a lista — por isso a alça acima existe.
    row.addEventListener('pointerdown', function (e) {
      if (e.target.closest('.drag-handle, .edit-btn, .delete, .check')) return;

      var startX = e.clientX, startYDown = e.clientY;
      var timer = setTimeout(function () {
        timer = null;
        cleanup();
        beginDrag(startYDown);
      }, LONG_PRESS_MS);

      function onMoveDuringWait(ev) {
        if (Math.abs(ev.clientX - startX) > LONG_PRESS_MOVE_TOLERANCE ||
            Math.abs(ev.clientY - startYDown) > LONG_PRESS_MOVE_TOLERANCE) {
          clearTimeout(timer);
          timer = null;
          cleanup();
        }
      }
      function onUpDuringWait() {
        clearTimeout(timer);
        timer = null;
        cleanup();
      }
      function cleanup() {
        window.removeEventListener('pointermove', onMoveDuringWait);
        window.removeEventListener('pointerup', onUpDuringWait);
        window.removeEventListener('pointercancel', onUpDuringWait);
      }
      window.addEventListener('pointermove', onMoveDuringWait);
      window.addEventListener('pointerup', onUpDuringWait);
      window.addEventListener('pointercancel', onUpDuringWait);
    });
  }

  function stem(word) {
    // simplificação bem básica: tira plural terminado em "s" pra casar
    // "plantas" com "planta", "frutas" com "fruta", etc.
    if (word.length > 4 && word.charAt(word.length - 1) === 's') return word.slice(0, -1);
    return word;
  }

  function tokenize(text) {
    var norm = normalizeAccents(text.toLowerCase());
    return norm.split(/[^a-z0-9]+/).filter(function (w) {
      return w.length >= 3 && STOPWORDS.indexOf(w) === -1;
    }).map(stem);
  }

  function learnWord(word, listId, weight) {
    if (!state.wordListStats[word]) state.wordListStats[word] = {};
    state.wordListStats[word][listId] = (state.wordListStats[word][listId] || 0) + (weight || 1);
  }

  function learnFromText(text, listId) {
    tokenize(text).forEach(function (w) { learnWord(w, listId, 1); });
  }

  function seedListHints(list) {
    var normName = normalizeAccents(list.name.toLowerCase());
    Object.keys(CATEGORY_SEED).forEach(function (cat) {
      var def = CATEGORY_SEED[cat];
      var matches = def.hints.some(function (h) { return normName.indexOf(h) !== -1; });
      if (!matches) return;
      def.words.forEach(function (w) { learnWord(w, list.id, 2); });
    });
  }

  function categoryMatchesListName(catKey, list) {
    var normName = normalizeAccents(list.name.toLowerCase());
    return CATEGORY_SEED[catKey].hints.some(function (h) { return normName.indexOf(h) !== -1; });
  }

  function hasListForCategory(catKey) {
    return state.lists.some(function (l) { return categoryMatchesListName(catKey, l); });
  }

  function bestNewCategorySuggestion(words) {
    var bestKey = null, bestCount = 0;
    Object.keys(CATEGORY_SEED).forEach(function (catKey) {
      if (hasListForCategory(catKey)) return; // já existe lista pra essa categoria
      var count = words.filter(function (w) { return CATEGORY_SEED[catKey].words.indexOf(w) !== -1; }).length;
      if (count > bestCount) { bestCount = count; bestKey = catKey; }
    });
    return bestKey ? { key: bestKey, def: CATEGORY_SEED[bestKey] } : null;
  }

  function bestSuggestion(text, excludeListId) {
    var words = tokenize(text);
    if (words.length === 0) return null;
    var scores = {};
    words.forEach(function (w) {
      var stats = state.wordListStats[w];
      if (!stats) return;
      Object.keys(stats).forEach(function (id) {
        scores[id] = (scores[id] || 0) + stats[id];
      });
    });
    var currentScore = scores[excludeListId] || 0;
    var bestId = null, bestScore = 0;
    Object.keys(scores).forEach(function (id) {
      if (id === excludeListId) return;
      if (scores[id] > bestScore) { bestScore = scores[id]; bestId = id; }
    });
    if (bestId && bestScore > currentScore && bestScore >= 2) return { listId: bestId, score: bestScore };
    return null;
  }

  function createList(name, emoji, type) {
    var list = {
      id: uid(), name: name, emoji: emoji, type: type,
      reminder: { enabled: false, times: ['08:00'] }, sortOrder: 'manual', items: [],
      lastResetDate: todayStr()
    };
    if (session) { list.role = 'owner'; list.rev = 0; list.base = null; list.ownerName = session.username; }
    seedListHints(list);
    return list;
  }

  function seedData() {
    // createList() usa state.wordListStats pra semear as dicas, então o
    // state precisa existir (mesmo que vazio) antes de criar as listas.
    state = { lastResetDate: todayStr(), wordListStats: {}, trash: [], lists: [] };
    var casa = createList('Casa', '🏠', 'rotina');
    casa.items = [
      { id: uid(), text: 'Lavar a louça', done: false },
      { id: uid(), text: 'Passear com o cachorro', done: false },
      { id: uid(), text: 'Regar as plantas', done: false }
    ];
    state.lists = [
      casa,
      createList('Mercado', '🛒', 'lista'),
      createList('Farmácia', '💊', 'lista'),
      createList('Ligar / Agendar', '📞', 'lista')
    ];
    return state;
  }

  var isNewInstall = false;

  function load() {
    var raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      isNewInstall = true;
      state = seedData();
      save();
      return;
    }
    try {
      state = JSON.parse(raw);
    } catch (e) {
      state = seedData();
    }
    ensureReminderDefaults();
    ensureWordStatsDefaults();
    ensureTrashDefaults();
    applyDailyReset();
    purgeOldTrash();
  }

  function ensureReminderDefaults() {
    state.lists.forEach(function (list) {
      if (!list.reminder) list.reminder = { enabled: false, times: ['08:00'] };
      if (!list.reminder.times) {
        list.reminder.times = [list.reminder.time || '08:00'];
        delete list.reminder.time;
      }
      if (!list.sortOrder) list.sortOrder = 'manual';
      if (!list.lastResetDate) list.lastResetDate = state.lastResetDate || todayStr();
    });
  }

  function ensureWordStatsDefaults() {
    if (!state.wordListStats) state.wordListStats = {};
  }

  function ensureTrashDefaults() {
    if (!state.trash) state.trash = [];
  }

  function purgeOldTrash() {
    var cutoff = Date.now() - TRASH_RETENTION_MS;
    var before = state.trash.length;
    state.trash = state.trash.filter(function (t) { return t.deletedAt >= cutoff; });
    if (state.trash.length !== before) save();
  }

  function moveListToTrash(list) {
    state.lists = state.lists.filter(function (l) { return l.id !== list.id; });
    Object.keys(state.wordListStats).forEach(function (word) {
      delete state.wordListStats[word][list.id];
    });
    var entry = { id: uid(), type: 'list', deletedAt: Date.now(), list: list };
    state.trash.push(entry);
    save();
    return entry;
  }

  function moveItemToTrash(list, item) {
    list.items = list.items.filter(function (i) { return i.id !== item.id; });
    var entry = {
      id: uid(), type: 'item', deletedAt: Date.now(),
      listId: list.id, listName: list.name, listEmoji: list.emoji, item: item
    };
    state.trash.push(entry);
    save();
    return entry;
  }

  // ---------- desfazer ----------
  // Aviso com botão "Desfazer" (6s) depois de ações que apagam ou mudam muita
  // coisa de uma vez. Tira o medo de errar o toque.

  var undoTimer = null;

  function hideUndo() {
    clearTimeout(undoTimer);
    var el = document.getElementById('undo-toast');
    if (el) el.classList.remove('show');
  }

  function showUndo(message, undoFn, label) {
    var el = document.getElementById('undo-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'undo-toast';
      el.className = 'undo-toast';
      el.setAttribute('role', 'status');
      el.setAttribute('aria-live', 'polite');
      document.body.appendChild(el);
    }
    el.innerHTML = '<span class="undo-msg"></span><button type="button" class="undo-btn"></button>';
    el.querySelector('.undo-btn').textContent = label || 'Desfazer';
    el.querySelector('.undo-msg').textContent = message;
    el.querySelector('.undo-btn').addEventListener('click', function () {
      hideUndo();
      undoFn();
    });
    void el.offsetWidth;
    el.classList.add('show');
    clearTimeout(undoTimer);
    undoTimer = setTimeout(hideUndo, 6000);
  }

  function dropTrashEntry(entryId) {
    state.trash = state.trash.filter(function (t) { return t.id !== entryId; });
  }

  // Volta um ou mais itens pra lista, nas posições originais.
  function undoItemsTrash(list, removed) {
    removed.slice().sort(function (a, b) { return a.idx - b.idx; }).forEach(function (r) {
      dropTrashEntry(r.entryId);
      if (!list.items.some(function (i) { return i.id === r.item.id; })) {
        list.items.splice(Math.min(r.idx, list.items.length), 0, r.item);
      }
    });
    save();
    if (currentListId === list.id) renderDetail();
  }

  function trashItemWithUndo(list, item) {
    var idx = list.items.indexOf(item);
    var entry = moveItemToTrash(list, item);
    renderDetail();
    showUndo('Item excluído', function () {
      undoItemsTrash(list, [{ item: item, idx: idx, entryId: entry.id }]);
    });
  }

  function trashListWithUndo(list, done) {
    var idx = state.lists.indexOf(list);
    var entry = moveListToTrash(list);
    done();
    showUndo('Lista "' + list.name + '" excluída', function () {
      restoreTrashEntry(entry.id);
      var cur = state.lists.indexOf(list);
      if (cur > -1 && idx > -1 && cur !== idx) {
        state.lists.splice(cur, 1);
        state.lists.splice(Math.min(idx, state.lists.length), 0, list);
        save();
      }
      if (currentListId) renderDetail(); else renderHome();
    });
  }

  function restoreTrashEntry(entryId) {
    var idx = state.trash.findIndex(function (t) { return t.id === entryId; });
    if (idx === -1) return;
    var entry = state.trash[idx];
    if (entry.type === 'list') {
      // Na nuvem a lista foi apagada de vez: ao restaurar, ela sobe como nova.
      delete entry.list.members;
      if (session) enrollList(entry.list);
      else { delete entry.list.role; delete entry.list.rev; delete entry.list.base; delete entry.list.ownerName; }
      state.lists.push(entry.list);
    } else {
      var list = getList(entry.listId);
      if (!list) {
        alert('A lista "' + entry.listName + '" desse item não existe mais. Restaure a lista primeiro, se ela também estiver na lixeira.');
        return;
      }
      if (!canEditItems(list)) {
        alert('Você não pode mais editar essa lista.');
        return;
      }
      list.items.push(entry.item);
    }
    state.trash.splice(idx, 1);
    save();
  }

  function purgeTrashEntry(entryId) {
    state.trash = state.trash.filter(function (t) { return t.id !== entryId; });
    save();
  }

  function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    scheduleCloudBackup();
    scheduleAccountSync();
    scheduleReminderSync();
  }

  var reminderSyncTimer = null;

  function scheduleReminderSync() {
    clearTimeout(reminderSyncTimer);
    reminderSyncTimer = setTimeout(function () { syncPushSubscription(); }, 3000);
  }

  // O reset é por lista (lista compartilhada não pode depender do relógio de
  // um aparelho só). Leitor não mexe: vê o que o servidor mandar.
  function applyDailyReset() {
    var today = todayStr();
    var changed = false;
    state.lists.forEach(function (list) {
      if (list.type !== 'rotina' || list.role === 'viewer') return;
      if ((list.lastResetDate || state.lastResetDate) === today) return;
      list.items.forEach(function (item) {
        item.done = false;
        delete item.doneBy;
        if (item.steps) item.steps.forEach(function (st) { st.done = false; });
      });
      list.lastResetDate = today;
      changed = true;
    });
    state.lastResetDate = today;
    if (changed) save();
    else localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  // ---------- progresso e feedback (gamificação leve) ----------
  // Guardado à parte do estado das listas (não sincroniza nem entra no
  // backup): é só um histórico pessoal por aparelho. Sem punição: nunca
  // há contador que "zera" por um dia perdido.

  var GAME_KEY = 'checklist-diario:game';
  var GAME_KEEP_DAYS = 120;
  var CELEBRATIONS = [
    'Lista completa! 🎉', 'Mandou bem! ✨', 'Tudo feito, parabéns! 🙌', 'Missão cumprida! 🚀',
    'Que capricho! 🌟', 'Uma a menos na cabeça! 😌', 'Arrasou! 💪', 'Feito é melhor que perfeito! 👏'
  ];
  // Conquistas: permanentes (nunca se perdem) e só aparecem como celebração.
  var BADGES = [
    { id: 'first', icon: '🌱', name: 'Primeiro passo', hint: 'Marque um item', test: function (g) { return g.total >= 1; } },
    { id: 'list1', icon: '🎯', name: 'Lista completa', hint: 'Termine uma lista inteira', test: function (g) { return g.listsDone >= 1; } },
    { id: 'week3', icon: '📅', name: '3 dias na semana', hint: '3 dias ativos em 7 dias', test: function () { return activeDaysLast7() >= 3; } },
    { id: 'week5', icon: '🔥', name: '5 dias na semana', hint: '5 dias ativos em 7 dias', test: function () { return activeDaysLast7() >= 5; } },
    { id: 'streak7', icon: '🏆', name: 'Sequência de 7', hint: '7 dias seguidos (com perdão)', test: function () { return currentStreak() >= 7; } },
    { id: 'total50', icon: '⭐', name: '50 itens feitos', hint: 'Faça 50 itens', test: function (g) { return g.total >= 50; } },
    { id: 'total200', icon: '💎', name: '200 itens feitos', hint: 'Faça 200 itens', test: function (g) { return g.total >= 200; } }
  ];
  var justCheckedItemId = null;
  var game = loadGame();

  function loadGame() {
    var g = null;
    try { g = JSON.parse(localStorage.getItem(GAME_KEY) || 'null'); } catch (e) { g = null; }
    if (!g || typeof g !== 'object') g = {};
    if (!g.days || typeof g.days !== 'object') g.days = {};
    if (g.enabled === undefined) g.enabled = true;
    if (!g.badges || typeof g.badges !== 'object') g.badges = {};
    g.total = g.total || 0;
    g.listsDone = g.listsDone || 0;
    if (!g.rewards || typeof g.rewards !== 'object') g.rewards = {};
    if (!g.rewardShown || typeof g.rewardShown !== 'object') g.rewardShown = {};
    if (!g.sound || typeof g.sound !== 'object') g.sound = { on: false, kind: 'chuva', vol: 50 };
    if (!g.doneLists || typeof g.doneLists !== 'object') g.doneLists = {};
    if (!g.reviews || typeof g.reviews !== 'object') g.reviews = {};
    if (!g.taskReminders || typeof g.taskReminders !== 'object') g.taskReminders = {};
    return g;
  }

  function saveGame() {
    var cutoff = dayKey(daysAgo(GAME_KEEP_DAYS));
    Object.keys(game.days).forEach(function (k) { if (k < cutoff) delete game.days[k]; });
    Object.keys(game.doneLists || {}).forEach(function (k) { if (k < cutoff) delete game.doneLists[k]; });
    try { localStorage.setItem(GAME_KEY, JSON.stringify(game)); } catch (e) {}
    scheduleProgressSync();
  }

  function daysAgo(n) {
    var d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() - n);
  }

  function recordCheck(delta) {
    var k = todayStr();
    var n = Math.max(0, (game.days[k] || 0) + delta);
    if (n) game.days[k] = n; else delete game.days[k];
    saveGame();
  }

  function activeDaysLast7() {
    var n = 0;
    for (var i = 0; i < 7; i++) if (game.days[dayKey(daysAgo(i))]) n++;
    return n;
  }

  // Sequência com perdão: um dia sem atividade não quebra a sequência, desde
  // que não tenha havido outro perdão nos 6 dias anteriores. Hoje ainda não
  // acabou, então não conta contra você.
  function currentStreak() { return P.streak(game.days, daysAgo(0), GAME_KEEP_DAYS); }

  function vibrate(pattern) {
    try { if (navigator.vibrate) navigator.vibrate(pattern); } catch (e) {}
  }

  var toastTimer = null;
  function hideToast() {
    var el = document.getElementById('game-toast');
    if (el) el.classList.remove('show');
    clearTimeout(toastTimer);
  }

  function showToast(text) {
    var el = document.getElementById('game-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'game-toast';
      el.className = 'game-toast';
      el.setAttribute('role', 'status');
      el.setAttribute('aria-live', 'polite');
      document.body.appendChild(el);
    }
    el.textContent = text;
    // se o "Desfazer" está na tela, este aviso sobe pra não ficar em cima dele
    var undoEl = document.getElementById('undo-toast');
    el.classList.toggle('above', !!(undoEl && undoEl.classList.contains('show')));
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, 2200);
  }

  // Chamado depois que um item é marcado ou desmarcado numa lista.
  function onItemToggled(list, item) {
    if (!game.enabled) return;
    if (!item.done) { game.total = Math.max(0, game.total - 1); recordCheck(-1); return; }
    var firstOfDay = !game.days[todayStr()];
    game.total++;
    recordCheck(1);
    justCheckedItemId = item.id;
    var actv = activeItems(list);
    var complete = actv.length > 0 && actv.every(function (i) { return i.done; });
    if (complete) { game.listsDone++; game.doneLists[todayStr()] = (game.doneLists[todayStr()] || 0) + 1; }
    if (complete && game.rewards[list.id] && game.rewardShown[list.id] !== todayStr()) {
      setTimeout(function () { showReward(list, 0); }, 700);
    }
    var badge = unlockBadges();
    if (badge) {
      vibrate([20, 40, 20]);
      showToast(badge.icon + ' Conquista: ' + badge.name);
    } else if (complete) {
      vibrate([20, 40, 20]);
      showToast(isSharedList(list) && contributions(list).length >= 2
        ? 'Vocês completaram a lista juntos! 🎉'
        : CELEBRATIONS[Math.floor(Math.random() * CELEBRATIONS.length)]);
    } else {
      vibrate(12);
      if (firstOfDay) showToast('Primeiro do dia! 🌱');
    }
  }

  // Devolve a primeira conquista nova (ou null) e grava todas as desbloqueadas.
  function unlockBadges() {
    var first = null;
    BADGES.forEach(function (b) {
      if (game.badges[b.id] || !b.test(game)) return;
      game.badges[b.id] = todayStr();
      if (!first) first = b;
    });
    saveGame();
    return first;
  }

  // Se o index.html em cache for de uma versão anterior (sem esses
  // elementos), cria o container em vez de quebrar a tela inteira.
  function ensureBox(id, className, beforeId) {
    var el = document.getElementById(id);
    if (el) return el;
    el = document.createElement('div');
    el.id = id;
    el.className = className + ' hidden';
    var ref = document.getElementById(beforeId);
    if (ref && ref.parentNode) ref.parentNode.insertBefore(el, ref); else document.body.appendChild(el);
    return el;
  }

  function renderDetailProgress(list) {
    var box = ensureBox('detail-progress', 'detail-progress', 'item-filter');
    var act = activeItems(list);
    var total = act.length;
    var done = act.filter(function (i) { return i.done; }).length;
    var left = total - done;
    var html = '';
    if (game.enabled && total > 0) {
      var label = left === 0 ? 'Tudo feito! 🎉'
        : (game.calm ? 'Um passo de cada vez 🌱' : (left === 1 ? 'Falta só 1' : 'Faltam ' + left));
      html +=
        '<div class="detail-progress-label"><span>' + label + '</span>' + (game.calm ? '' : '<span>' + done + '/' + total + '</span>') + '</div>' +
        '<div class="progress-bar big"><div style="width:' + Math.round((done / total) * 100) + '%"></div></div>';
    }
    var contrib = isSharedList(list) ? contributions(list) : [];
    if (contrib.length && total > 0) {
      html += '<div class="coop-line">👥 ' + (game.calm
        ? 'Vocês estão fazendo isso juntos'
        : 'Juntos: ' + contrib.map(function (c) { return escapeHtml(doerName(c.name)) + ' ' + c.count; }).join(' · ')) + '</div>';
    }
    box.classList.toggle('is-done', total > 0 && left === 0);
    var canFocus = canEditItems(list) && left > 0;
    if (canFocus) html += '<button id="btn-focus" class="btn focus-btn">🎯 Modo foco · uma tarefa por vez</button>';
    if (!html) { box.classList.add('hidden'); box.innerHTML = ''; return; }
    box.classList.remove('hidden');
    box.innerHTML = html;
    if (canFocus) document.getElementById('btn-focus').addEventListener('click', function () { openFocusMode(list); });
  }

  // Modo foco: mostra só a próxima tarefa pendente, grande, com "Feito" e
  // "Pular" (pular só muda a ordem de hoje, não mexe na lista).
  function openFocusMode(list) {
    var skipped = [];
    function render() {
      var pending = list.items.filter(function (i) { return !i.done && !isSnoozed(i); });
      if (pending.length === 0) { closeModal(); renderDetail(); return; }
      var candidates = pending.filter(function (i) { return skipped.indexOf(i.id) === -1; });
      if (candidates.length === 0) { skipped = []; candidates = pending; }
      var item = candidates[0];
      openModal(
        '<p class="hint" style="margin:0;">' + (game.calm ? 'Só esta, por agora' : (pending.length === 1 ? 'Falta só 1' : 'Faltam ' + pending.length)) +
          ' · toque no texto para aumentar/diminuir a letra</p>' +
        '<div id="focus-text" class="focus-text' + (game.focusLarge ? ' large' : '') + '"></div>' +
        ((item.steps && item.steps.length)
          ? '<ul class="focus-steps">' + item.steps.map(function (st, k) {
              return '<li class="focus-step' + (st.done ? ' done' : '') + '" data-idx="' + k + '"><span class="step-check">' + (st.done ? ICONS.check : '') + '</span><span class="step-text"></span></li>';
            }).join('') + '</ul>'
          : '') +
        (item.note ? '<div class="focus-note"><div class="focus-note-text"></div><div class="note-links"></div></div>' : '') +
        '<div id="focus-timer" class="focus-timer"></div>' +
        '<button id="m-focus-done" class="btn btn-primary">Feito ✓</button>' +
        '<div class="focus-actions">' +
          '<button id="m-focus-split" class="btn btn-secondary">Dividir em passos</button>' +
          '<button id="m-focus-breathe" class="btn btn-secondary">🌬️ Respirar</button>' +
          (pending.length > 1 ? '<button id="m-focus-skip" class="btn btn-secondary">Pular por agora</button>' : '') +
          '<button id="m-focus-snooze" class="btn btn-secondary">⏰ Adiar</button>' +
          '<button id="m-cancel" class="btn btn-secondary">Sair do foco</button>' +
        '</div>'
      );
      document.getElementById('focus-text').textContent = item.text;
      var fnote = modal.querySelector('.focus-note');
      if (fnote) {
        fnote.querySelector('.focus-note-text').textContent = item.note;
        renderLinkChips(fnote.querySelector('.note-links'), findLinks(item.note));
      }
      modal.querySelectorAll('.focus-step').forEach(function (li) {
        var st = item.steps[parseInt(li.getAttribute('data-idx'), 10)];
        li.querySelector('.step-text').textContent = st.text;
        li.addEventListener('click', function () {
          toggleStep(list, item, st);
          renderDetail();
          render();
        });
      });
      document.getElementById('m-focus-snooze').addEventListener('click', function () {
        openSnoozeSheet(list, item, function () { renderDetail(); render(); });
      });
      document.getElementById('m-focus-done').addEventListener('click', function () {
        setDone(list, item, true);
        save();
        onItemToggled(list, item);
        renderDetail();
        justCheckedItemId = null;
        render();
      });
      document.getElementById('m-focus-breathe').addEventListener('click', function () {
        openBreathing(render);
      });
      paintFocusTimer();
      document.getElementById('m-focus-split').addEventListener('click', function () {
        openSplitItem(list, item, render);
      });
      document.getElementById('focus-text').addEventListener('click', function () {
        game.focusLarge = !game.focusLarge;
        saveGame();
        this.classList.toggle('large', game.focusLarge);
      });
      var skipBtn = document.getElementById('m-focus-skip');
      if (skipBtn) skipBtn.addEventListener('click', function () { skipped.push(item.id); render(); });
      document.getElementById('m-cancel').addEventListener('click', closeModal);
    }
    render();
  }

  // Cronômetro suave do modo foco: tempo curto e opcional, sem alarme alto.
  var focusTimer = null; // { end, total, id }

  function stopFocusTimer() {
    if (focusTimer) { clearInterval(focusTimer.id); focusTimer = null; }
  }

  function startFocusTimer(minutes) {
    stopFocusTimer();
    var total = minutes * 60 * 1000;
    focusTimer = { end: Date.now() + total, total: total, id: setInterval(tickFocusTimer, 1000) };
    paintFocusTimer();
  }

  function fmtClock(ms) {
    var sec = Math.max(0, Math.ceil(ms / 1000));
    return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
  }

  function paintFocusTimer() {
    var box = document.getElementById('focus-timer');
    if (!box) { stopFocusTimer(); return; }
    if (!focusTimer) {
      box.innerHTML = '<span class="hint">Quer tentar por um tempinho?</span>' +
        [5, 10, 25].map(function (m) {
          return '<button class="btn btn-secondary small-btn" data-min="' + m + '">⏱️ ' + m + ' min</button>';
        }).join('');
      box.querySelectorAll('[data-min]').forEach(function (b) {
        b.addEventListener('click', function () { startFocusTimer(parseInt(b.getAttribute('data-min'), 10)); });
      });
      return;
    }
    box.innerHTML = '<div class="timer-track"><div id="focus-timer-bar"></div></div>' +
      (game.calm ? '' : '<span id="focus-timer-digits" class="hint"></span>') +
      '<button id="m-timer-stop" class="btn btn-secondary small-btn">Parar</button>';
    document.getElementById('m-timer-stop').addEventListener('click', function () { stopFocusTimer(); paintFocusTimer(); });
    tickFocusTimer();
  }

  function tickFocusTimer() {
    if (!focusTimer) return;
    if (!document.getElementById('focus-timer')) { stopFocusTimer(); return; }
    var left = focusTimer.end - Date.now();
    if (left <= 0) {
      stopFocusTimer();
      vibrate([20, 40, 20]);
      showToast('⏱️ Tempo! Terminou ou quer mais um pouco? 🌱');
      paintFocusTimer();
      return;
    }
    var bar = document.getElementById('focus-timer-bar');
    if (bar) bar.style.width = Math.round((1 - left / focusTimer.total) * 100) + '%';
    var digits = document.getElementById('focus-timer-digits');
    if (digits) digits.textContent = fmtClock(left);
  }

  // Pausa guiada de ~1 minuto: inspira 4s, solta 6s, 6 vezes. Respeita
  // "reduzir movimento" (o texto continua guiando, só some a animação).
  // ---------- som relaxante (gerado no aparelho com a Web Audio API) ----------
  // Sem arquivos de áudio: funciona offline e não pesa. Desligado por padrão, só
  // toca depois de um toque da pessoa, acompanha a respiração (sobe ao inspirar,
  // desce ao soltar o ar) e para sozinho ao fechar a pausa.

  var SOUND_KINDS = [
    { key: 'chuva', label: '🌧️ Chuva suave' },
    { key: 'ondas', label: '🌊 Ondas' },
    { key: 'tom', label: '🎵 Tom calmo' }
  ];
  var ambient = { ctx: null, master: null, node: null, silent: null, watch: null };

  function soundSupported() { return !!(window.AudioContext || window.webkitAudioContext); }

  function soundPrefs() {
    if (!game.sound) game.sound = { on: false, kind: 'chuva', vol: 50 };
    return game.sound;
  }

  // volume 0-100 -> ganho (curva quadrática: mais fino nos volumes baixos)
  function volumeGain() {
    var v = Math.max(0, Math.min(100, soundPrefs().vol)) / 100;
    return v * v * 0.9;
  }

  function audioCtx() {
    if (!ambient.ctx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      try { ambient.ctx = new AC(); } catch (e) { return null; }
      ambient.master = ambient.ctx.createGain();
      ambient.master.gain.value = 0;
      ambient.master.connect(ambient.ctx.destination);
    }
    return ambient.ctx;
  }

  // Ruído em laço sem "clique" na emenda (crossfade nas pontas). brown = mais grave.
  function makeNoiseBuffer(ctx, brown) {
    var len = Math.floor(ctx.sampleRate * 4);
    var fade = Math.floor(ctx.sampleRate * 0.15);
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var out = buf.getChannelData(0);
    var x = new Float32Array(len + fade);
    var last = 0, peak = 0, i;
    for (i = 0; i < x.length; i++) {
      var w = Math.random() * 2 - 1;
      if (brown) { last = (last + 0.02 * w) / 1.02; x[i] = last; } else { x[i] = w; }
      if (Math.abs(x[i]) > peak) peak = Math.abs(x[i]);
    }
    for (i = 0; i < len; i++) {
      var v = x[i];
      if (i < fade) { var t = i / fade; v = x[i] * t + x[len + i] * (1 - t); }
      out[i] = (v / (peak || 1)) * 0.9;
    }
    return buf;
  }

  function buildSound(ctx, kind) {
    var bus = ctx.createGain();     // fade na troca de som e no fim
    bus.gain.value = 0;
    var swell = ctx.createGain();   // acompanha a respiração
    swell.gain.value = 0.55;
    swell.connect(bus);
    var sources = [];

    function noise(brown) {
      var src = ctx.createBufferSource();
      src.buffer = makeNoiseBuffer(ctx, brown);
      src.loop = true;
      src.start();
      sources.push(src);
      return src;
    }

    if (kind === 'chuva') {
      var hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 500;
      var lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 5000;
      var lvl = ctx.createGain(); lvl.gain.value = 0.22; // ruído branco é áspero: fica baixo
      noise(false).connect(hp); hp.connect(lp); lp.connect(lvl); lvl.connect(swell);
    } else if (kind === 'ondas') {
      var lpw = ctx.createBiquadFilter(); lpw.type = 'lowpass'; lpw.frequency.value = 1100;
      var wave = ctx.createGain(); wave.gain.value = 0.8;
      var lfo = ctx.createOscillator(); lfo.frequency.value = 0.11; // marola de ~9s
      var amt = ctx.createGain(); amt.gain.value = 0.3;
      lfo.connect(amt); amt.connect(wave.gain); lfo.start(); sources.push(lfo);
      noise(true).connect(lpw); lpw.connect(wave); wave.connect(swell);
    } else {
      var lpt = ctx.createBiquadFilter(); lpt.type = 'lowpass'; lpt.frequency.value = 1400;
      [220, 329.63, 440].forEach(function (f, k) { // lá, mi, lá: quinta aberta, sem tensão
        var o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f; o.detune.value = (k - 1) * 5;
        var g = ctx.createGain(); g.gain.value = k === 0 ? 0.4 : 0.25;
        o.connect(g); g.connect(lpt); o.start(); sources.push(o);
      });
      lpt.connect(swell);
    }

    return {
      bus: bus,
      breathe: function (inhale, ms) {
        var t = ctx.currentTime;
        swell.gain.cancelScheduledValues(t);
        swell.gain.setValueAtTime(swell.gain.value, t);
        swell.gain.linearRampToValueAtTime(inhale ? 1 : 0.4, t + ms / 1000);
      },
      fadeIn: function (sec) {
        var t = ctx.currentTime;
        bus.gain.cancelScheduledValues(t);
        bus.gain.setValueAtTime(bus.gain.value, t);
        bus.gain.linearRampToValueAtTime(1, t + sec);
      },
      fadeOut: function (sec) {
        var t = ctx.currentTime;
        bus.gain.cancelScheduledValues(t);
        bus.gain.setValueAtTime(bus.gain.value, t);
        bus.gain.linearRampToValueAtTime(0, t + sec);
      },
      stop: function () {
        sources.forEach(function (src) { try { src.stop(); } catch (e) {} });
        try { bus.disconnect(); } catch (e) {}
      }
    };
  }

  // iOS: o botão lateral de silêncio costuma mudo a Web Audio. Dois jeitos de
  // pedir "reprodução": a Audio Session API (Safari 16.4+) e um áudio mudo em laço.
  function silentWavUrl() {
    var rate = 8000, n = 8000, buf = new Uint8Array(44 + n), dv = new DataView(buf.buffer), i;
    function str(off, t) { for (i = 0; i < t.length; i++) buf[off + i] = t.charCodeAt(i); }
    str(0, 'RIFF'); dv.setUint32(4, 36 + n, true); str(8, 'WAVE'); str(12, 'fmt ');
    dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
    dv.setUint32(24, rate, true); dv.setUint32(28, rate, true); dv.setUint16(32, 1, true); dv.setUint16(34, 8, true);
    str(36, 'data'); dv.setUint32(40, n, true);
    for (i = 0; i < n; i++) buf[44 + i] = 128;
    return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
  }

  function keepAudioSession() {
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) {}
    try {
      if (!ambient.silent) {
        ambient.silent = new Audio(silentWavUrl());
        ambient.silent.loop = true;
      }
      var pr = ambient.silent.play();
      if (pr && pr.catch) pr.catch(function () {});
    } catch (e) {}
  }

  function applyVolume(fast) {
    if (!ambient.ctx || !ambient.master) return;
    var t = ambient.ctx.currentTime;
    ambient.master.gain.cancelScheduledValues(t);
    ambient.master.gain.setTargetAtTime(volumeGain(), t, fast ? 0.05 : 0.4);
  }

  function startAmbient(kind) {
    var ctx = audioCtx();
    if (!ctx) return false;
    keepAudioSession();
    try { if (ctx.state === 'suspended' && ctx.resume) ctx.resume(); } catch (e) {}
    var old = ambient.node;
    if (old) { old.fadeOut(0.5); setTimeout(function () { old.stop(); }, 700); }
    ambient.node = buildSound(ctx, kind);
    ambient.node.bus.connect(ambient.master);
    ambient.node.fadeIn(old ? 0.6 : 1.5);
    applyVolume(false);
    if (!ambient.watch) {
      // some sozinho quando a pausa de respirar fecha (por qualquer caminho)
      ambient.watch = setInterval(function () {
        if (!document.getElementById('breath-circle') || document.hidden) stopAmbient(0.6);
      }, 250);
    }
    return true;
  }

  function stopAmbient(fadeSec) {
    if (ambient.watch) { clearInterval(ambient.watch); ambient.watch = null; }
    var node = ambient.node;
    ambient.node = null;
    if (node) {
      node.fadeOut(fadeSec);
      setTimeout(function () { node.stop(); }, fadeSec * 1000 + 150);
    }
    setTimeout(function () {
      if (!ambient.node && ambient.silent) { try { ambient.silent.pause(); } catch (e) {} }
    }, fadeSec * 1000 + 200);
  }

  document.addEventListener('visibilitychange', function () { if (document.hidden && ambient.node) stopAmbient(0.2); });

  function soundBoxHtml() {
    if (!soundSupported()) return '';
    var pr = soundPrefs();
    return '<div class="settings-group sound-box">' +
      '<div class="settings-row"><span>🔈 Som relaxante</span>' +
        '<button id="m-sound-toggle" class="switch" role="switch" aria-label="Som relaxante" aria-checked="' + (pr.on ? 'true' : 'false') + '"><span></span></button></div>' +
      '<div id="m-sound-more" class="' + (pr.on ? '' : 'hidden') + '">' +
        '<div class="chip-row">' + SOUND_KINDS.map(function (k) {
          return '<button type="button" class="chip' + (pr.kind === k.key ? ' selected' : '') + '" data-kind="' + k.key + '">' + k.label + '</button>';
        }).join('') + '</div>' +
        '<label class="vol-row"><span>Volume</span><input id="m-sound-vol" type="range" min="0" max="100" step="5" value="' + pr.vol + '" aria-label="Volume do som"></label>' +
        '<p class="hint">Começa baixinho e some sozinho quando você fecha. Com fones fica melhor.</p>' +
      '</div></div>';
  }

  function bindSoundBox() {
    var toggle = document.getElementById('m-sound-toggle');
    if (!toggle) return;
    var pr = soundPrefs();
    var more = document.getElementById('m-sound-more');
    toggle.addEventListener('click', function () {
      pr.on = !pr.on;
      saveGame();
      toggle.setAttribute('aria-checked', pr.on ? 'true' : 'false');
      more.classList.toggle('hidden', !pr.on);
      if (pr.on) startAmbient(pr.kind); else stopAmbient(0.8);
    });
    modal.querySelectorAll('[data-kind]').forEach(function (el) {
      el.addEventListener('click', function () {
        pr.kind = el.getAttribute('data-kind');
        saveGame();
        modal.querySelectorAll('[data-kind]').forEach(function (o) { o.classList.toggle('selected', o === el); });
        if (pr.on) startAmbient(pr.kind);
      });
    });
    var vol = document.getElementById('m-sound-vol');
    vol.addEventListener('input', function () { pr.vol = parseInt(vol.value, 10); applyVolume(true); });
    vol.addEventListener('change', function () { saveGame(); });
  }

  function openBreathing(back) {
    openModal(
      '<h2>Respirar um pouco</h2>' +
      '<div id="breath-circle" class="breath-circle"></div>' +
      '<p id="breath-text" class="focus-text" style="padding:8px;">Fique confortável…</p>' +
      soundBoxHtml() +
      '<button id="m-cancel" class="btn btn-secondary">Fechar</button>'
    );
    document.getElementById('m-cancel').addEventListener('click', function () {
      stopAmbient(0.6);
      (back || closeModal)();
    });
    bindSoundBox();
    // este código roda dentro do toque que abriu a pausa: o navegador deixa tocar
    if (soundSupported() && soundPrefs().on) startAmbient(soundPrefs().kind);
    var CYCLES = 6;
    function step(i) {
      var circle = document.getElementById('breath-circle');
      var text = document.getElementById('breath-text');
      if (!circle || !text) return; // modal fechado
      if (i >= CYCLES * 2) {
        circle.className = 'breath-circle';
        text.textContent = 'Pronto. Volte quando quiser 🌱';
        stopAmbient(3);
        return;
      }
      var inhale = i % 2 === 0;
      var ms = inhale ? 4000 : 6000;
      circle.style.transitionDuration = ms + 'ms';
      circle.className = 'breath-circle' + (inhale ? ' in' : '');
      text.textContent = inhale ? 'Inspire pelo nariz…' : 'Solte o ar devagar…';
      if (ambient.node) ambient.node.breathe(inhale, ms);
      setTimeout(function () { step(i + 1); }, ms);
    }
    setTimeout(function () { step(0); }, 1200);
  }

  // Próximas tarefas na home: só 3 por vez, para não sobrecarregar. Se a pessoa
  // escolheu prioridades para hoje (⭐), mostra só elas.
  function nextTasks() {
    var picks = pickedTasks();
    if (picks.length) return { tasks: picks, picked: true };
    var all = [];
    state.lists.forEach(function (l) {
      if (!canEditItems(l) || !scheduledToday(l)) return;
      l.items.forEach(function (i) { if (!i.done && !isSnoozed(i)) all.push({ list: l, item: i }); });
    });
    // rotinas primeiro (são o "hoje" de verdade); a ordem original se mantém dentro de cada grupo
    var rotinas = all.filter(function (t) { return t.list.type === 'rotina'; });
    var outras = all.filter(function (t) { return t.list.type !== 'rotina'; });
    return { tasks: rotinas.concat(outras).slice(0, 3), picked: false };
  }

  function renderTodayBox() {
    var box = ensureBox('today-box', 'today-box', 'lists-container');
    box.innerHTML = '';
    var nt = game.today === false ? { tasks: [], picked: false } : nextTasks();
    var tasks = nt.tasks;
    var html = '';
    if (tasks.length) {
      html += '<div class="today-title">' + (nt.picked ? '⭐ Suas prioridades de hoje' : 'Para agora') +
        (nt.picked ? '<button id="btn-clear-picks" class="link-btn" type="button">Limpar escolhas</button>' : '') + '</div>';
      tasks.forEach(function (t, idx) {
        html += '<div class="today-row" data-idx="' + idx + '"><div class="check"></div>' +
          '<span class="today-text"></span><span class="today-emoji">' + t.list.emoji + '</span></div>';
      });
    }
    html += '<button id="btn-breathe" class="breathe-btn">' + ICONS.wind + 'Respirar um pouco</button>';
    box.classList.remove('hidden');
    box.innerHTML = html;
    box.querySelectorAll('.today-row').forEach(function (row) {
      var t = tasks[parseInt(row.getAttribute('data-idx'), 10)];
      row.querySelector('.today-text').textContent = t.item.text;
      row.querySelector('.check').addEventListener('click', function () {
        setDone(t.list, t.item, true);
        save();
        onItemToggled(t.list, t.item);
        justCheckedItemId = null;
        renderHome();
      });
    });
    document.getElementById('btn-breathe').addEventListener('click', function () { openBreathing(closeModal); });
    var clr = document.getElementById('btn-clear-picks');
    if (clr) clr.addEventListener('click', function () { game.picks = null; saveGame(); renderHome(); });
  }

  // ---------- itens: passos, adiar, dias da semana e prioridades ----------

  var WEEKDAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  var expandedItemId = null;      // item com o painel (passos/adiar) aberto
  var focusStepInputFor = null;   // depois de adicionar um passo, devolve o foco ao campo

  function addDaysStr(n) { return dayKey(daysAgo(-n)); }

  // Adiado = some das contagens, do "Para agora" e do foco até a data chegar.
  function isSnoozed(item) { return P.isSnoozedOn(item, todayStr()); }
  function activeItems(list) { return list.items.filter(function (i) { return !isSnoozed(i); }); }

  function snoozeWhen(dateStr) { return P.snoozeLabel(dateStr, addDaysStr(1)); }

  // Rotina só nos dias escolhidos (sem escolha = todo dia).
  function scheduledToday(list) { return P.isScheduledOn(list, new Date().getDay()); }

  function daysLabel(list) { return P.daysLabelOf(list.days, WEEKDAYS); }

  function nextScheduledLabel(list) {
    for (var i = 1; i <= 7; i++) {
      var n = (new Date().getDay() + i) % 7;
      if (list.days.indexOf(n) !== -1) return WEEKDAYS[n];
    }
    return '';
  }

  // ---------- cooperativo: quem concluiu cada item (listas compartilhadas) ----------
  // Cada item concluído guarda `doneBy` (nome de quem marcou). Vai junto com o item
  // na sincronização, então não precisa de nada novo no servidor.

  function isSharedList(list) {
    return !!(list.role && (list.role !== 'owner' || (list.members && list.members.length > 0)));
  }

  function setDone(list, item, value) {
    item.done = value;
    if (value && session && isSharedList(list)) item.doneBy = session.username; else delete item.doneBy;
  }

  function doerName(name) {
    return session && name === session.username ? 'Você' : name;
  }

  // [{name, count}] dos itens concluídos (não adiados) por pessoa, do maior para o menor
  function contributions(list) { return P.contributionsOf(activeItems(list), session ? session.username : null); }

  // passos (subtarefas) do item
  function stepsDoneCount(item) {
    return (item.steps || []).filter(function (st) { return st.done; }).length;
  }

  // Marca/desmarca um passo. Fechar o último passo conclui a tarefa; reabrir um
  // passo de uma tarefa concluída a reabre. Cada passo conta como atividade do dia.
  function toggleStep(list, item, step) {
    step.done = !step.done;
    if (game.enabled) recordCheck(step.done ? 1 : -1);
    var all = item.steps.length > 0 && item.steps.every(function (st) { return st.done; });
    if (all && !item.done) {
      setDone(list, item, true);
      save();
      onItemToggled(list, item);
    } else if (!step.done && item.done) {
      setDone(list, item, false);
      save();
      onItemToggled(list, item);
    } else {
      save();
    }
  }

  function addSteps(item, text) {
    var lines = String(text).split(/\r?\n/).map(function (t) { return t.trim(); }).filter(Boolean);
    if (!item.steps) item.steps = [];
    lines.forEach(function (t) {
      if (item.steps.length < 20) item.steps.push({ id: uid(), text: t.slice(0, 100), done: false });
    });
    return lines.length;
  }

  function snoozeItem(list, item, days, after) {
    var prev = item.snoozeUntil;
    item.snoozeUntil = addDaysStr(days);
    expandedItemId = null;
    save();
    if (after) after();
    showUndo('Adiado: volta ' + snoozeWhen(item.snoozeUntil), function () {
      if (prev) item.snoozeUntil = prev; else delete item.snoozeUntil;
      save();
      rerender();
    });
  }

  function openSnoozeSheet(list, item, back) {
    openModal(
      '<h2>Adiar para quando?</h2>' +
      '<p class="hint">A tarefa some do "Para agora" e das contagens e volta sozinha na data. Sem culpa.</p>' +
      '<div class="choice-list">' +
        '<button type="button" class="choice-card" data-days="1"><span class="choice-emoji">🌅</span><span><strong>Amanhã</strong></span></button>' +
        '<button type="button" class="choice-card" data-days="3"><span class="choice-emoji">📅</span><span><strong>Em 3 dias</strong></span></button>' +
        '<button type="button" class="choice-card" data-days="7"><span class="choice-emoji">🗓️</span><span><strong>Semana que vem</strong></span></button>' +
      '</div>' +
      '<button id="m-cancel" class="btn btn-secondary">Voltar</button>'
    );
    modal.querySelectorAll('[data-days]').forEach(function (el) {
      el.addEventListener('click', function () {
        snoozeItem(list, item, parseInt(el.getAttribute('data-days'), 10), back);
      });
    });
    document.getElementById('m-cancel').addEventListener('click', back);
  }

  // prioridades do dia (até 3, só neste aparelho)
  function pickedTasks() {
    if (!game.picks || game.picks.date !== todayStr()) return [];
    var out = [];
    game.picks.ids.forEach(function (p) {
      var l = getList(p.l);
      if (!l || !canEditItems(l)) return;
      var it = l.items.filter(function (i) { return i.id === p.i; })[0];
      if (it && !it.done && !isSnoozed(it)) out.push({ list: l, item: it });
    });
    return out.slice(0, 3);
  }

  function isPicked(list, item) {
    return !!(game.picks && game.picks.date === todayStr() &&
      game.picks.ids.some(function (p) { return p.l === list.id && p.i === item.id; }));
  }

  function togglePick(list, item) {
    if (!game.picks || game.picks.date !== todayStr()) game.picks = { date: todayStr(), ids: [] };
    var at = -1;
    game.picks.ids.forEach(function (p, k) { if (p.l === list.id && p.i === item.id) at = k; });
    if (at > -1) {
      game.picks.ids.splice(at, 1);
    } else {
      if (pickedTasks().length >= 3) { showToast('Até 3 prioridades por dia. Tire uma para escolher outra.'); return false; }
      game.picks.ids.push({ l: list.id, i: item.id });
    }
    saveGame();
    return true;
  }

  function openDaysPicker(list) {
    var chosen = (list.days || []).slice();
    function paint() {
      modal.querySelectorAll('[data-day]').forEach(function (el) {
        el.classList.toggle('selected', chosen.indexOf(parseInt(el.getAttribute('data-day'), 10)) !== -1);
      });
    }
    openModal(
      '<h2>Dias da semana</h2>' +
      '<p class="hint">Fora desses dias a rotina não aparece em "Para agora" e não manda lembrete. Sem nenhum dia marcado, vale todo dia.</p>' +
      '<div class="chip-row">' + [1, 2, 3, 4, 5, 6, 0].map(function (n) {
        return '<button type="button" class="chip" data-day="' + n + '">' + WEEKDAYS[n] + '</button>';
      }).join('') + '</div>' +
      '<div class="chip-row">' +
        '<button type="button" class="chip" data-preset="all">Todos os dias</button>' +
        '<button type="button" class="chip" data-preset="weekdays">Dias úteis</button>' +
        '<button type="button" class="chip" data-preset="weekend">Fim de semana</button>' +
      '</div>' +
      '<div class="modal-actions">' +
        '<button id="m-days-back" class="btn btn-secondary">Voltar</button>' +
        '<button id="m-days-save" class="btn btn-primary">Salvar</button>' +
      '</div>'
    );
    paint();
    modal.querySelectorAll('[data-day]').forEach(function (el) {
      el.addEventListener('click', function () {
        var n = parseInt(el.getAttribute('data-day'), 10);
        var i = chosen.indexOf(n);
        if (i > -1) chosen.splice(i, 1); else chosen.push(n);
        paint();
      });
    });
    modal.querySelectorAll('[data-preset]').forEach(function (el) {
      el.addEventListener('click', function () {
        var k = el.getAttribute('data-preset');
        chosen = k === 'all' ? [] : (k === 'weekdays' ? [1, 2, 3, 4, 5] : [0, 6]);
        paint();
      });
    });
    document.getElementById('m-days-back').addEventListener('click', function () { openListMenu(list); });
    document.getElementById('m-days-save').addEventListener('click', function () {
      chosen.sort();
      if (!chosen.length || chosen.length === 7) delete list.days; else list.days = chosen;
      save();
      openListMenu(list);
      if (currentListId) renderDetail(); else renderHome();
    });
  }

  // ---------- notas e links por item ----------

  var LINK_ICONS = { url: '🔗', mail: '✉️', tel: '📞' };

  function renderLinkChips(box, links) {
    box.innerHTML = '';
    links.forEach(function (l) {
      var a = document.createElement('a');
      a.className = 'link-chip';
      a.href = l.href;
      if (l.type === 'url') { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
      a.textContent = LINK_ICONS[l.type] + ' ' + l.label;
      box.appendChild(a);
    });
  }

  function setNote(item, value) {
    var v = String(value || '').trim().slice(0, 500);
    if (v) item.note = v; else delete item.note;
    save();
  }

  // ---------- revisão semanal gentil ----------

  var DOW_LETTER = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
  var DOW_LONG = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

  // Semana de segunda a domingo. Na segunda-feira mostra a semana anterior inteira
  // (a nova mal começou); nos outros dias, a semana em andamento.
  function reviewWeek() { return P.reviewWeekDays(game.days, game.doneLists, daysAgo(0)); }

  function weekStats(w) { return P.weekTotals(w, game.badges, BADGES); }

  function weeklyCardWanted() {
    if (!game.enabled) return null;
    var dow = new Date().getDay();
    if (dow !== 0 && dow !== 1) return null; // domingo e segunda
    if (game.reviewHideDay === todayStr()) return null;
    var w = reviewWeek();
    var r = game.reviews[w.key];
    if (r && r.seen) return null;
    var st = weekStats(w);
    if (st.total === 0 && st.lists === 0) return null; // sem nada a mostrar, sem cobrança
    return w;
  }

  function renderWeeklyCard() {
    var box = ensureBox('weekly-card', 'weekly-card', 'today-box');
    var w = weeklyCardWanted();
    if (!w) { box.classList.add('hidden'); box.innerHTML = ''; return; }
    box.classList.remove('hidden');
    box.innerHTML =
      '<div class="weekly-text"><strong>📋 Sua semana está pronta</strong><span>Um olhar gentil sobre o que você fez.</span></div>' +
      '<button id="btn-weekly-open" class="btn btn-primary small-btn" type="button">Ver</button>' +
      '<button id="btn-weekly-hide" class="weekly-x" type="button" aria-label="Agora não">×</button>';
    document.getElementById('btn-weekly-open').addEventListener('click', openWeeklyReview);
    document.getElementById('btn-weekly-hide').addEventListener('click', function () {
      game.reviewHideDay = todayStr();
      saveGame();
      renderWeeklyCard();
    });
  }

  function fmtDay(d) { return d.getDate() + '/' + String(d.getMonth() + 1).padStart(2, '0'); }

  function openWeeklyReview() {
    var w = reviewWeek();
    var st = weekStats(w);
    var mine = game.reviews[w.key] || {};
    game.reviews[w.key] = { helped: mine.helped || '', next: mine.next || '', at: mine.at || todayStr(), seen: true };
    saveGame();
    renderWeeklyCard();

    var max = Math.max.apply(null, w.days.map(function (d) { return d.count; }).concat([1]));
    var cols = w.days.map(function (d) {
      var h = d.count > 0 ? Math.max(12, Math.round((d.count / max) * 100)) : 0;
      return '<div class="wk-col' + (d.today ? ' today' : '') + (d.future ? ' future' : '') + '">' +
        (game.calm || d.count === 0 ? '<span class="wk-val">&nbsp;</span>' : '<span class="wk-val">' + d.count + '</span>') +
        '<div class="wk-track">' + (h ? '<div class="wk-bar" style="height:' + h + '%"></div>' : '<div class="wk-dot"></div>') + '</div>' +
        '<span class="wk-label">' + DOW_LETTER[d.dow] + '</span></div>';
    }).join('');

    var sentence;
    if (st.total === 0 && st.lists === 0) {
      sentence = 'Foi uma semana mais quieta. Tudo bem: recomeçar também faz parte do caminho.';
    } else if (game.calm) {
      sentence = 'Você apareceu por aqui e fez o que deu. Isso conta.';
    } else {
      sentence = 'Você marcou ' + st.total + (st.total === 1 ? ' coisa' : ' coisas') + ' em ' + st.active + (st.active === 1 ? ' dia' : ' dias') + '.' +
        (st.best && st.active > 1 ? ' Seu dia mais forte foi ' + DOW_LONG[st.best.dow] + '.' : '');
    }
    var stats = '';
    if (!game.calm && (st.total || st.lists)) {
      stats = '<div class="chip-row">' +
        '<span class="chip-mini">✅ ' + st.total + ' marcadas</span>' +
        (st.lists ? '<span class="chip-mini">🎯 ' + st.lists + (st.lists === 1 ? ' lista concluída' : ' listas concluídas') + '</span>' : '') +
        '<span class="chip-mini">📅 ' + st.active + (st.active === 1 ? ' dia ativo' : ' dias ativos') + '</span></div>';
    }
    var badges = st.badges.length
      ? '<div class="chip-row">' + st.badges.map(function (b) { return '<span class="chip-mini star">' + b.icon + ' ' + escapeHtml(b.name) + '</span>'; }).join('') + '</div>'
      : '';

    var past = Object.keys(game.reviews).filter(function (k) {
      var r = game.reviews[k]; return k !== w.key && (r.helped || r.next);
    }).sort().reverse().slice(0, 4).map(function (k) {
      var r = game.reviews[k];
      return '<li><strong>Semana de ' + k.split('-').reverse().slice(0, 2).join('/') + '</strong>' +
        (r.helped ? '<br><small>Ajudou: ' + escapeHtml(r.helped) + '</small>' : '') +
        (r.next ? '<br><small>Intenção: ' + escapeHtml(r.next) + '</small>' : '') + '</li>';
    }).join('');

    openModal(
      '<h2>Sua semana</h2>' +
      '<p class="hint">' + fmtDay(w.from) + ' a ' + fmtDay(w.to) + (new Date().getDay() !== 0 && new Date().getDay() !== 1 ? ' · semana em andamento' : '') + '</p>' +
      '<div class="wk-chart" aria-label="Itens marcados em cada dia da semana">' + cols + '</div>' +
      '<p class="wk-sentence">' + sentence + '</p>' + stats + badges +
      '<label>O que ajudou nesta semana?<input id="m-wk-helped" type="text" maxlength="120" placeholder="Opcional"></label>' +
      '<label>Uma coisa pequena para a próxima semana<input id="m-wk-next" type="text" maxlength="120" placeholder="Opcional"></label>' +
      (past ? '<details class="wk-past"><summary>Revisões anteriores</summary><ul>' + past + '</ul></details>' : '') +
      '<div class="modal-actions">' +
        '<button id="m-cancel" class="btn btn-secondary">Fechar</button>' +
        '<button id="m-wk-save" class="btn btn-primary">Guardar</button>' +
      '</div>'
    );
    document.getElementById('m-wk-helped').value = mine.helped || '';
    document.getElementById('m-wk-next').value = mine.next || '';
    document.getElementById('m-cancel').addEventListener('click', closeModal);
    document.getElementById('m-wk-save').addEventListener('click', function () {
      game.reviews[w.key] = {
        helped: document.getElementById('m-wk-helped').value.trim(),
        next: document.getElementById('m-wk-next').value.trim(),
        at: todayStr(), seen: true
      };
      var keys = Object.keys(game.reviews).sort();
      while (keys.length > 12) delete game.reviews[keys.shift()];
      saveGame();
      closeModal();
      showToast('Guardado 💛');
    });
  }

  // ---------- modelos de lista, perfis de uso e recompensa ----------

  // Passos pequenos e concretos: começar costuma ser a parte mais difícil.
  var TEMPLATES = [
    { key: 'manha', name: 'Rotina da manhã', emoji: '🌅', type: 'rotina',
      items: ['Beber um copo de água', 'Tomar café da manhã', 'Escovar os dentes', 'Trocar de roupa', 'Arrumar a cama', 'Olhar o que tem pra hoje'] },
    { key: 'noite', name: 'Rotina da noite', emoji: '🌙', type: 'rotina',
      items: ['Guardar o que ficou fora do lugar', 'Separar a roupa de amanhã', 'Deixar o que preciso levar perto da porta', 'Tomar os remédios, se houver', 'Colocar o celular pra carregar', 'Escovar os dentes'] },
    { key: 'casa15', name: 'Casa em 15 minutos', emoji: '🧹', type: 'rotina',
      items: ['Juntar a louça e lavar', 'Recolher a roupa suja', 'Passar um pano na bancada', 'Tirar o lixo', 'Arrumar a mesa ou o sofá'] },
    { key: 'mercado', name: 'Mercado básico', emoji: '🛒', type: 'lista',
      items: ['Frutas', 'Verduras e legumes', 'Arroz e feijão', 'Leite e ovos', 'Pão', 'Café', 'Produtos de limpeza'] },
    { key: 'mala', name: 'Mala de viagem', emoji: '🧳', type: 'lista',
      items: ['Documentos e carteira', 'Carregador e fone', 'Remédios', 'Roupas (uma por dia)', 'Itens de higiene', 'Chaves de casa'] },
    { key: 'contas', name: 'Contas e burocracias', emoji: '🧾', type: 'lista',
      items: ['Pagar as contas do mês', 'Responder os e-mails pendentes', 'Marcar consultas', 'Conferir a agenda da semana'] }
  ];

  function templateByKey(key) {
    return TEMPLATES.filter(function (t) { return t.key === key; })[0];
  }

  function newListFromTemplate(tpl, nameOverride) {
    var list = createList(nameOverride || tpl.name, tpl.emoji, tpl.type);
    list.items = tpl.items.map(function (text) { return { id: uid(), text: text, done: false }; });
    return list;
  }

  function duplicateList(list) {
    var copy = createList(list.name + ' (cópia)', list.emoji, list.type);
    copy.sortOrder = list.sortOrder || 'manual';
    if (list.days && list.days.length) copy.days = list.days.slice();
    copy.items = list.items.map(function (i) {
      var c = { id: uid(), text: i.text, done: false };
      if (i.note) c.note = i.note;
      if (i.steps && i.steps.length) c.steps = i.steps.map(function (st) { return { id: uid(), text: st.text, done: false }; });
      return c;
    });
    state.lists.push(copy);
    save();
    return copy;
  }

  // Perfis: só ajustam interruptores que já existem em Ajustes.
  var PROFILES = [
    { key: 'foco', emoji: '🎯', title: 'Preciso de ajuda para focar',
      desc: 'Uma tarefa por vez, "Para agora", incentivos e cronômetro suave.',
      apply: { enabled: true, today: true, calm: false } },
    { key: 'calmo', emoji: '🌿', title: 'Quero um ritmo mais tranquilo',
      desc: 'Sem contagens nem números que pressionam; só frases de incentivo.',
      apply: { enabled: true, today: true, calm: true } },
    { key: 'basico', emoji: '✅', title: 'Só o básico',
      desc: 'Listas e rotinas, sem incentivos nem "Para agora".',
      apply: { enabled: false, today: false, calm: false } }
  ];

  function applyProfile(key) {
    var prof = PROFILES.filter(function (p) { return p.key === key; })[0];
    if (!prof) return;
    game.enabled = prof.apply.enabled;
    game.today = prof.apply.today;
    game.calm = prof.apply.calm;
    game.profile = key;
    saveGame();
  }

  function profileCardsHtml(selected) {
    return '<div class="choice-list">' + PROFILES.map(function (p) {
      return '<button type="button" class="choice-card' + (p.key === selected ? ' selected' : '') + '" data-profile="' + p.key + '">' +
        '<span class="choice-emoji">' + p.emoji + '</span>' +
        '<span><strong>' + p.title + '</strong><small>' + p.desc + '</small></span></button>';
    }).join('') + '</div>';
  }

  function bindChoiceCards(onPick) {
    modal.querySelectorAll('.choice-card').forEach(function (el) {
      el.addEventListener('click', function () {
        modal.querySelectorAll('.choice-card').forEach(function (o) { o.classList.remove('selected'); });
        el.classList.add('selected');
        onPick(el.getAttribute('data-profile'));
      });
    });
  }

  // Escolha de perfil fora do onboarding (Ajustes).
  function openProfilePicker() {
    var chosen = game.profile || 'foco';
    openModal(
      '<h2>Como você prefere usar o app?</h2>' +
      '<p class="hint">Isso só liga ou desliga opções que também estão em Ajustes. Dá pra mudar quando quiser.</p>' +
      profileCardsHtml(chosen) +
      '<div class="modal-actions">' +
        '<button id="m-cancel" class="btn btn-secondary">Cancelar</button>' +
        '<button id="m-profile-save" class="btn btn-primary">Aplicar</button>' +
      '</div>'
    );
    bindChoiceCards(function (k) { chosen = k; });
    document.getElementById('m-cancel').addEventListener('click', closeModal);
    document.getElementById('m-profile-save').addEventListener('click', function () {
      applyProfile(chosen);
      closeModal();
      if (currentListId) renderDetail(); else renderHome();
    });
  }

  // Primeira abertura: boas-vindas, perfil e modelos. Só em instalação nova.
  function startOnboarding(done) {
    var step = 0;
    var profile = 'foco';
    var picked = [];
    var finished = false;

    function dots() {
      return '<div class="steps" aria-hidden="true">' + [0, 1, 2].map(function (i) {
        return '<span class="' + (i === step ? 'on' : '') + '"></span>';
      }).join('') + '</div>';
    }

    function finish() {
      if (finished) return;
      finished = true;
      applyProfile(profile);
      picked.forEach(function (key) {
        var tpl = templateByKey(key);
        if (tpl) state.lists.push(newListFromTemplate(tpl));
      });
      if (picked.length) save();
      game.onboarded = true;
      saveGame();
      closeModal();
      renderHome();
    }

    function render() {
      if (step === 0) {
        openModal(
          dots() +
          '<h2>Bem-vindo(a) 👋</h2>' +
          '<p class="hint">Um checklist que respeita o seu ritmo. Listas, rotinas que recomeçam todo dia e pequenos incentivos, tudo opcional.</p>' +
          '<div class="feature-list">' +
            '<div><span>🎯</span><div><strong>Uma tarefa por vez</strong><small>O modo foco mostra só o próximo passo.</small></div></div>' +
            '<div><span>🌬️</span><div><strong>Pausas para respirar</strong><small>Um minuto guiado quando a cabeça pesa.</small></div></div>' +
            '<div><span>🌱</span><div><strong>Progresso sem cobrança</strong><small>Nada zera por um dia difícil.</small></div></div>' +
          '</div>' +
          '<button id="m-ob-next" class="btn btn-primary">Começar</button>' +
          '<button id="m-ob-skip" class="btn btn-secondary">Pular apresentação</button>'
        );
        document.getElementById('m-ob-next').addEventListener('click', function () { step = 1; render(); });
        document.getElementById('m-ob-skip').addEventListener('click', finish);
      } else if (step === 1) {
        openModal(
          dots() +
          '<h2>Como você prefere usar o app?</h2>' +
          '<p class="hint">Isso só liga ou desliga opções que também ficam em Ajustes.</p>' +
          profileCardsHtml(profile) +
          '<div class="modal-actions">' +
            '<button id="m-ob-back" class="btn btn-secondary">Voltar</button>' +
            '<button id="m-ob-next" class="btn btn-primary">Continuar</button>' +
          '</div>'
        );
        bindChoiceCards(function (k) { profile = k; });
        document.getElementById('m-ob-back').addEventListener('click', function () { step = 0; render(); });
        document.getElementById('m-ob-next').addEventListener('click', function () { step = 2; render(); });
      } else {
        openModal(
          dots() +
          '<h2>Quer começar com um modelo?</h2>' +
          '<p class="hint">Escolha quantos quiser. Você pode editar tudo depois.</p>' +
          '<div class="chip-row">' + TEMPLATES.map(function (t) {
            return '<button type="button" class="chip' + (picked.indexOf(t.key) > -1 ? ' selected' : '') + '" data-key="' + t.key + '">' + t.emoji + ' ' + t.name + '</button>';
          }).join('') + '</div>' +
          '<div class="modal-actions">' +
            '<button id="m-ob-back" class="btn btn-secondary">Voltar</button>' +
            '<button id="m-ob-done" class="btn btn-primary">Concluir</button>' +
          '</div>'
        );
        modal.querySelectorAll('.chip').forEach(function (el) {
          el.addEventListener('click', function () {
            var k = el.getAttribute('data-key');
            var i = picked.indexOf(k);
            if (i > -1) picked.splice(i, 1); else picked.push(k);
            el.classList.toggle('selected');
          });
        });
        document.getElementById('m-ob-back').addEventListener('click', function () { step = 1; render(); });
        document.getElementById('m-ob-done').addEventListener('click', finish);
      }
    }

    // fechar de qualquer jeito (fora da folha, arrastando) conta como "pular"
    onModalCloseOnce = function () { if (!finished) { finished = true; game.onboarded = true; saveGame(); } done(); };
    render();
  }

  // Recompensa pessoal ao concluir uma lista (fica só neste aparelho).
  var REWARD_IDEAS = ['☕ Um café', '🎵 Uma música favorita', '🚶 Uma caminhada curta', '🍫 Um docinho', '📺 Um episódio', '🛁 Um banho demorado'];

  function openRewardEditor(list) {
    var current = game.rewards[list.id] || '';
    openModal(
      '<h2>Recompensa ao concluir</h2>' +
      '<p class="hint">Quando você terminar "' + escapeHtml(list.name) + '", o app lembra do seu combinado. Algo pequeno e seu funciona melhor do que pontos.</p>' +
      '<input id="m-reward-text" type="text" maxlength="60" placeholder="Ex: ☕ Um café sem pressa">' +
      '<div class="chip-row">' + REWARD_IDEAS.map(function (r) { return '<button type="button" class="chip" data-idea="' + r + '">' + r + '</button>'; }).join('') + '</div>' +
      '<div class="modal-actions">' +
        '<button id="m-reward-back" class="btn btn-secondary">Voltar</button>' +
        '<button id="m-reward-save" class="btn btn-primary">Salvar</button>' +
      '</div>' +
      (current ? '<button id="m-reward-remove" class="btn btn-danger">Remover recompensa</button>' : '')
    );
    var input = document.getElementById('m-reward-text');
    input.value = current;
    modal.querySelectorAll('[data-idea]').forEach(function (el) {
      el.addEventListener('click', function () { input.value = el.getAttribute('data-idea'); });
    });
    document.getElementById('m-reward-back').addEventListener('click', function () { openListMenu(list); });
    document.getElementById('m-reward-save').addEventListener('click', function () {
      var v = input.value.trim();
      if (v) game.rewards[list.id] = v; else delete game.rewards[list.id];
      saveGame();
      openListMenu(list);
    });
    var rm = document.getElementById('m-reward-remove');
    if (rm) rm.addEventListener('click', function () {
      delete game.rewards[list.id];
      saveGame();
      openListMenu(list);
    });
  }

  function showReward(list, tries) {
    var text = game.rewards[list.id];
    if (!text) return;
    if (!backdrop.classList.contains('hidden')) {
      if ((tries || 0) < 4) setTimeout(function () { showReward(list, (tries || 0) + 1); }, 500);
      return;
    }
    game.rewardShown[list.id] = todayStr();
    saveGame();
    hideToast(); // o aviso de conquista não pode cobrir a recompensa
    openModal(
      '<div class="reward-card">' +
        '<div class="reward-big">🎉</div>' +
        '<h2>Lista concluída!</h2>' +
        '<p class="hint">Sua recompensa combinada:</p>' +
        '<div id="reward-text" class="reward-text"></div>' +
      '</div>' +
      '<button id="m-reward-ok" class="btn btn-primary">Vou aproveitar ✓</button>'
    );
    document.getElementById('reward-text').textContent = text;
    document.getElementById('m-reward-ok').addEventListener('click', closeModal);
  }

  // Convite gentil na primeira abertura do dia (nunca cobra nem conta o que faltou ontem).
  function maybeGreet() {
    if (isNewInstall || !game.enabled || game.greetedOn === todayStr()) return;
    var pending = 0;
    state.lists.forEach(function (l) {
      if (l.type === 'rotina' && scheduledToday(l)) pending += activeItems(l).filter(function (i) { return !i.done; }).length;
    });
    game.greetedOn = todayStr();
    saveGame();
    if (pending === 0) return;
    var h = new Date().getHours();
    var hi = h < 12 ? 'Bom dia!' : (h < 18 ? 'Boa tarde!' : 'Boa noite!');
    showToast(hi + ' ' + (game.calm ? 'Sem pressa: que tal escolher uma coisa pequena? 🌱'
      : (pending === 1 ? 'Tem 1 tarefa hoje.' : 'Tem ' + pending + ' tarefas hoje.') + ' Que tal começar por uma? 🌱'));
  }

  // Troca uma tarefa grande por passos menores (um por linha), na mesma posição.
  // O item original vai pra lixeira, então dá pra recuperar.
  function openSplitItem(list, item, back) {
    var mode = 'steps'; // 'steps' (dentro da tarefa) | 'items' (tarefas separadas)
    openModal(
      '<h2>Dividir em passos</h2>' +
      '<p class="hint" style="margin:0;">Escreva um passo por linha. Passos pequenos e concretos são mais fáceis de começar.</p>' +
      '<div class="chip-row">' +
        '<button type="button" class="chip selected" data-mode="steps">Passos desta tarefa</button>' +
        '<button type="button" class="chip" data-mode="items">Tarefas separadas</button>' +
      '</div>' +
      '<textarea id="m-split-text" rows="5" placeholder="Ex.:&#10;Juntar a louça&#10;Lavar os copos&#10;Lavar as panelas"></textarea>' +
      '<div class="modal-actions"><button id="m-split-cancel" class="btn btn-secondary">Voltar</button>' +
      '<button id="m-split-save" class="btn btn-primary">Dividir</button></div>'
    );
    modal.querySelectorAll('[data-mode]').forEach(function (el) {
      el.addEventListener('click', function () {
        mode = el.getAttribute('data-mode');
        modal.querySelectorAll('[data-mode]').forEach(function (o) { o.classList.toggle('selected', o === el); });
      });
    });
    document.getElementById('m-split-cancel').addEventListener('click', back);
    document.getElementById('m-split-save').addEventListener('click', function () {
      var steps = document.getElementById('m-split-text').value.split('\n')
        .map(function (t) { return t.trim(); }).filter(Boolean).slice(0, 15);
      if (steps.length < 2) { alert('Escreva pelo menos 2 passos, um por linha.'); return; }
      if (mode === 'steps') {
        addSteps(item, steps.join('\n'));
        save();
        renderDetail();
        back();
        return;
      }
      var idx = list.items.findIndex(function (i) { return i.id === item.id; });
      var newItems = steps.map(function (t) { return { id: uid(), text: t, done: false }; });
      moveItemToTrash(list, item);
      Array.prototype.splice.apply(list.items, [Math.max(0, idx), 0].concat(newItems));
      save();
      renderDetail();
      back();
    });
  }

  function renderGameSummary() {
    var box = ensureBox('game-summary', 'game-summary', 'lists-container');
    if (!game.enabled || state.lists.length === 0) { box.classList.add('hidden'); box.innerHTML = ''; return; }
    var week = activeDaysLast7();
    var streak = currentStreak();
    var text = week === 0
      ? '🌱 Marque um item para começar'
      : (game.calm
        ? '🌱 Você tem aparecido por aqui, isso conta'
        : '🌱 ' + week + (week === 1 ? ' dia ativo' : ' dias ativos') + ' nos últimos 7' +
          (streak >= 2 ? ' · sequência de ' + streak : ''));
    box.classList.remove('hidden');
    box.innerHTML = '<button id="btn-game-history" class="game-summary-btn">' + text + '<span aria-hidden="true">›</span></button>';
    document.getElementById('btn-game-history').addEventListener('click', openGameHistory);
  }

  var DOW_PLURAL = ['domingos', 'segundas', 'terças', 'quartas', 'quintas', 'sextas', 'sábados'];

  // "Seu ritmo": só no aparelho, sem comparar com ninguém; no modo tranquilo, sem números.
  function rhythmHtml() {
    var r = rhythm(game.days, daysAgo(0));
    var lines = [];
    if (!r.active30) {
      lines.push('Sem registros nos últimos 30 dias. Tudo bem: dá para recomeçar com uma tarefa pequena.');
    } else {
      if (r.bestDow !== null) lines.push('Você costuma render mais nas ' + DOW_PLURAL[r.bestDow] + '.');
      if (!game.calm) lines.push('Nos últimos 30 dias: ' + r.active30 + (r.active30 === 1 ? ' dia ativo' : ' dias ativos') + ', média de ' + String(r.avgPerActive).replace('.', ',') + (r.avgPerActive === 1 ? ' item' : ' itens') + ' por dia ativo.');
      if (r.returns) lines.push(game.calm ? 'Você já retomou depois de pausas. Recomeçar também é progresso.' : 'Você retomou ' + r.returns + (r.returns === 1 ? ' vez' : ' vezes') + ' depois de uma pausa. Recomeçar também é progresso.');
    }
    var max = Math.max.apply(null, r.byDow) || 1;
    var bars = r.byDow.map(function (v, i) {
      return '<span class="rt-col' + (i === r.bestDow ? ' best' : '') + '"><span class="rt-bar" style="height:' + Math.round((v / max) * 100) + '%"></span><span class="rt-lbl">' + DOW_LETTER[i] + '</span></span>';
    }).join('');
    return '<h3 style="margin:4px 0 0;font-size:15px;">Seu ritmo</h3>' +
      (r.active30 ? '<div class="rt-chart" role="img" aria-label="Itens feitos por dia da semana nos últimos 90 dias">' + bars + '</div>' : '') +
      '<p class="hint rt-text" style="margin:0;">' + lines.map(escapeHtml).join(' ') + '</p>';
  }

  function openGameHistory() {
    var WEEKS = 12;
    var today = daysAgo(0);
    var start = daysAgo(WEEKS * 7 - 7 + today.getDay()); // começa num domingo
    var cells = '';
    for (var i = 0; i < WEEKS * 7; i++) {
      var d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      if (d > today) { cells += '<span class="heat-cell future"></span>'; continue; }
      var c = game.days[dayKey(d)] || 0;
      var lvl = c === 0 ? 0 : (c <= 2 ? 1 : (c <= 5 ? 2 : 3));
      cells += '<span class="heat-cell l' + lvl + '" title="' + dayKey(d) + ': ' + c + '"></span>';
    }
    var total = Object.keys(game.days).length;
    var badgesHtml = BADGES.map(function (b) {
      var got = !!game.badges[b.id];
      return '<div class="badge' + (got ? '' : ' locked') + '"><span class="badge-icon">' + (got ? b.icon : '🔒') + '</span>' +
        '<span><strong>' + b.name + '</strong><br><small>' + (got ? 'Conquistada!' : b.hint) + '</small></span></div>';
    }).join('');
    openModal(
      '<h2>Seu histórico</h2>' +
      '<div class="heatmap" aria-label="Dias com atividade nas últimas 12 semanas">' + cells + '</div>' +
      '<p class="hint" style="margin:0;">' + total + (total === 1 ? ' dia ativo' : ' dias ativos') +
        ' · sequência atual: ' + currentStreak() + '</p>' +
      '<p class="hint" style="margin:0;">Um dia sem marcar nada não zera a sequência (você tem um perdão a cada 7 dias). ' +
        'Cada quadradinho é um dia; quanto mais escuro, mais itens feitos.</p>' +
      rhythmHtml() +
      '<h3 style="margin:4px 0 0;font-size:15px;">Conquistas</h3>' +
      '<div class="badges">' + badgesHtml + '</div>' +
      '<button id="m-open-review" class="btn btn-secondary">📋 Revisão da semana</button>' +
      '<button id="m-cancel" class="btn btn-secondary">Fechar</button>'
    );
    document.getElementById('m-open-review').addEventListener('click', openWeeklyReview);
    document.getElementById('m-cancel').addEventListener('click', closeModal);
  }

  // ---------- navegação ----------

  var screenHome = document.getElementById('screen-home');
  var screenDetail = document.getElementById('screen-detail');

  function animateIn(screen, cls) {
    screen.classList.remove('enter-left', 'enter-right');
    void screen.offsetWidth; // reinicia a animação
    screen.classList.add(cls);
    setTimeout(function () { screen.classList.remove(cls); }, 420);
  }

  function showHome() {
    var fromDetail = !screenDetail.classList.contains('hidden');
    currentListId = null;
    screenDetail.classList.add('hidden');
    screenHome.classList.remove('hidden');
    renderHome();
    if (fromDetail) animateIn(screenHome, 'enter-left');
  }

  function showDetail(listId) {
    currentListId = listId;
    itemFilter = 'all';
    screenHome.classList.add('hidden');
    screenDetail.classList.remove('hidden');
    animateIn(screenDetail, 'enter-right');
    var input = document.getElementById('add-item-input');
    input.value = '';
    autoGrow(input);
    hideAddSuggestion();
    renderDetail();
  }

  function getList(id) {
    return state.lists.find(function (l) { return l.id === id; });
  }

  // ---------- render: home ----------

  function roleMeta(list) {
    if (list.role === 'editor' || list.role === 'viewer') {
      return ' · 👥 de ' + escapeHtml(list.ownerName || '?') + ' (' + ROLE_LABELS[list.role] + ')';
    }
    if (list.role === 'owner' && list.members && list.members.length) return ' · 👥 compartilhada';
    return '';
  }

  // Dono exclui (vai pra lixeira); editor/leitor só saem da lista.
  function removeListWithConfirm(list, done) {
    if (list.role && list.role !== 'owner') {
      if (!confirm('Sair da lista "' + list.name + '"? Você perde o acesso a ela.')) return;
      apiFetch('DELETE', '/lists/' + list.id + '/members/' + session.userId).then(function (res) {
        if (!res.ok && res.status !== 404) { alert('Não foi possível sair agora. Verifique a conexão.'); return; }
        state.lists = state.lists.filter(function (l) { return l.id !== list.id; });
        save();
        done();
      }).catch(function () { alert('Não foi possível sair agora. Verifique a conexão.'); });
      return;
    }
    if (list.role === 'owner' && list.rev > 0) {
      var extra = list.members && list.members.length ? ' Ela some também para os ' + list.members.length + ' membro(s).' : '';
      if (!confirm('Excluir a lista "' + list.name + '"?' + extra + ' Fica na lixeira por 7 dias neste aparelho.')) return;
      apiFetch('DELETE', '/lists/' + list.id).then(function (res) {
        if (!res.ok && res.status !== 404) { alert('Não foi possível excluir agora. Verifique a conexão.'); return; }
        moveListToTrash(list);
        done();
      }).catch(function () { alert('Não foi possível excluir agora. Verifique a conexão.'); });
      return;
    }
    trashListWithUndo(list, done);
  }

  // Cada lista ganha um tom próprio (derivado do id, sem guardar nada): ajuda a
  // reconhecer a lista de relance sem depender de ler o nome.
  var LIST_HUES = [214, 262, 330, 12, 38, 150, 176, 196];
  function listHue(id) {
    id = String(id);
    var h = 0;
    for (var i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
    return LIST_HUES[h % LIST_HUES.length];
  }

  function renderHome() {
    var dateEl = document.getElementById('home-date');
    if (dateEl) {
      try {
        dateEl.textContent = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
      } catch (e) { dateEl.textContent = ''; }
    }
    renderGameSummary();
    renderTodayBox();
    renderWeeklyCard();
    var container = document.getElementById('lists-container');
    container.innerHTML = '';

    if (state.lists.length === 0) {
      var empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.innerHTML = '<div class="big">🌱</div><strong>Vamos começar?</strong>' +
        '<span>Crie sua primeira lista. Pode ser pequena: uma coisa de cada vez já conta.</span>' +
        '<button id="btn-empty-new" class="btn btn-primary">Criar minha primeira lista</button>';
      container.appendChild(empty);
      document.getElementById('btn-empty-new').addEventListener('click', function () {
        document.getElementById('btn-new-list').click();
      });
      return;
    }

    state.lists.forEach(function (list) {
      var act = activeItems(list);
      var total = act.length;
      var done = act.filter(function (i) { return i.done; }).length;
      var snoozedN = list.items.length - total;
      var offToday = !scheduledToday(list);
      var pct = total === 0 ? 0 : Math.round((done / total) * 100);

      var card = document.createElement('div');
      card.className = 'list-card' + (total > 0 && done === total ? ' complete' : '') + (offToday ? ' off-today' : '');
      card.style.setProperty('--hue', listHue(list.id));
      card.innerHTML =
        '<div class="emoji">' + list.emoji + '</div>' +
        '<div class="info">' +
          '<textarea class="name" rows="1" readonly></textarea>' +
          '<div class="meta">' + (list.items.length === 0 ? 'Sem itens' : (total === 0 ? 'Tudo adiado' : (done === total ? 'Tudo feito 🎉' : done + ' de ' + total + ' feitos'))) +
            (snoozedN ? ' · ' + snoozedN + (snoozedN > 1 ? ' adiados' : ' adiado') : '') +
            (offToday
              ? ' · hoje não · volta ' + nextScheduledLabel(list)
              : (list.type === 'rotina' && !snoozedN ? ' · ' + (list.days && list.days.length && list.days.length < 7 ? daysLabel(list).toLowerCase() : 'diária') : '')) +
            roleMeta(list) + '</div>' +
          '<div class="progress-bar"><div style="width:' + pct + '%"></div></div>' +
        '</div>' +
        (canEditMeta(list) ? '<button class="edit-btn" aria-label="Renomear">' + ICONS.edit + '</button>' : '') +
        '<button class="drag-handle" aria-label="Arrastar para reordenar">' + DRAG_ICON + '</button>' +
        '<button class="delete" aria-label="' + (canEditMeta(list) ? 'Excluir lista' : 'Sair da lista') + '">' +
          (canEditMeta(list) ? ICONS.trash : ICONS.exit) + '</button>';

      var nameEl = card.querySelector('.name');
      nameEl.value = list.name;

      nameEl.addEventListener('click', function (e) {
        if (!nameEl.readOnly) e.stopPropagation();
      });
      nameEl.addEventListener('input', function () { autoGrow(nameEl); });
      nameEl.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); nameEl.blur(); }
      });
      nameEl.addEventListener('blur', function () {
        nameEl.readOnly = true;
        var val = nameEl.value.trim();
        if (!val) { nameEl.value = list.name; return; }
        if (val !== list.name) { list.name = val; save(); }
      });

      var editBtn = card.querySelector('.edit-btn');
      if (editBtn) {
        editBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          nameEl.readOnly = false;
          nameEl.focus();
          nameEl.setSelectionRange(nameEl.value.length, nameEl.value.length);
        });
      }

      setupDragReorder(container, card, card.querySelector('.drag-handle'), state.lists, list, function () {
        save();
        renderHome();
      });

      card.querySelector('.delete').addEventListener('click', function (e) {
        e.stopPropagation();
        removeListWithConfirm(list, renderHome);
      });

      card.addEventListener('click', function () {
        if (Date.now() - recentDragEndAt < 300) return;
        showDetail(list.id);
      });
      container.appendChild(card);
      autoGrow(nameEl);
    });
  }

  // ---------- render: detalhe ----------

  function renderDetail() {
    var list = getList(currentListId);
    if (!list) { showHome(); return; }

    document.getElementById('detail-title').textContent = list.emoji + ' ' + list.name;
    var editable = canEditItems(list);
    var hint = list.type === 'rotina'
      ? (list.days && list.days.length && list.days.length < 7
          ? 'Rotina de ' + daysLabel(list).toLowerCase() + ': os itens desmarcam sozinhos à meia-noite.'
          : 'Lista diária: os itens desmarcam sozinhos todo dia à meia-noite.')
      : 'Lista simples: marque os itens e use "Limpar concluídos" quando quiser.';
    if (list.role === 'viewer') hint = 'Você só pode ver esta lista (dono: ' + (list.ownerName || '?') + ').';
    else if (list.role === 'editor') hint = 'Você é editor: pode mexer nos itens. Dono: ' + (list.ownerName || '?') + '.';
    document.getElementById('detail-hint').textContent = hint;
    renderDetailProgress(list);
    document.getElementById('add-item-form').classList.toggle('hidden', !editable);
    if (!editable) hideAddSuggestion();

    document.querySelectorAll('#item-filter .filter-choice').forEach(function (btn) {
      btn.classList.toggle('selected', btn.dataset.filter === itemFilter);
    });

    var container = document.getElementById('items-container');
    container.innerHTML = '';

    if (list.items.length === 0) {
      var li = document.createElement('li');
      li.className = 'empty-state';
      li.innerHTML = '<div class="big">✨</div><strong>Lista vazia</strong>' +
        '<span>' + (editable ? 'Escreva o primeiro item no campo abaixo. Coisas pequenas e concretas ajudam a começar.' : 'Ainda não há itens aqui.') + '</span>';
      container.appendChild(li);
      return;
    }

    var visibleItems = list.items.filter(function (item) {
      if (itemFilter === 'done') return item.done;
      if (itemFilter === 'pending') return !item.done;
      return true;
    });

    if (list.sortOrder === 'alpha') {
      visibleItems.sort(function (a, b) { return a.text.localeCompare(b.text, 'pt-BR', { sensitivity: 'base' }); });
    } else if (list.sortOrder === 'pending-first') {
      visibleItems.sort(function (a, b) { return (a.done === b.done) ? 0 : (a.done ? 1 : -1); });
    }

    var canReorder = editable && itemFilter === 'all' && list.sortOrder === 'manual';

    if (visibleItems.length === 0) {
      var liEmpty = document.createElement('li');
      liEmpty.className = 'empty-state';
      liEmpty.innerHTML = itemFilter === 'done'
        ? '<div class="big">🌤️</div><strong>Nada marcado ainda</strong><span>Quando você marcar um item, ele aparece aqui.</span>'
        : '<div class="big">🎉</div><strong>Nada pendente</strong><span>Tudo feito por aqui. Merece uma pausa.</span>';
      container.appendChild(liEmpty);
      return;
    }

    visibleItems.forEach(function (item) {
      var steps = item.steps || [];
      var snoozed = isSnoozed(item);
      var expanded = expandedItemId === item.id && (editable || steps.length > 0 || !!item.note);
      var row = document.createElement('li');
      row.className = 'item-row' + (item.done ? ' done' : '') + (snoozed ? ' snoozed' : '') +
        (expanded ? ' expanded' : '') + (item.id === justCheckedItemId ? ' just-done' : '');

      var chips = [];
      if (steps.length) chips.push('<span class="chip-mini">' + (game.calm ? 'com passos' : stepsDoneCount(item) + '/' + steps.length + ' passos') + '</span>');
      if (item.done && item.doneBy && isSharedList(list)) chips.push('<span class="chip-mini done-by">✓ ' + escapeHtml(doerName(item.doneBy)) + '</span>');
      if (item.note) chips.push('<span class="chip-mini">📝 nota' + (findLinks(item.note).length ? ' · link' : '') + '</span>');
      if (snoozed) chips.push('<span class="chip-mini warn">⏰ volta ' + snoozeWhen(item.snoozeUntil) + '</span>');
      var remind = !item.done && getTaskReminder(list, item);
      if (remind) chips.push('<span class="chip-mini">🔔 ' + remindWhen(remind) + '</span>');
      if (isPicked(list, item)) chips.push('<span class="chip-mini star">⭐ prioridade de hoje</span>');

      row.innerHTML =
        '<div class="item-main">' +
          '<div class="check" role="checkbox" aria-checked="' + (item.done ? 'true' : 'false') + '">' + (item.done ? ICONS.check : '') + '</div>' +
          '<div class="item-body" role="button" aria-expanded="' + (expanded ? 'true' : 'false') + '" aria-label="Mostrar passos e opções da tarefa">' +
            '<textarea class="text" rows="1" readonly></textarea>' +
            (chips.length ? '<div class="item-meta">' + chips.join('') + '</div>' : '') +
          '</div>' +
          (editable ? '<button class="edit-btn" aria-label="Editar texto">' + ICONS.edit + '</button>' : '') +
          (canReorder ? '<button class="drag-handle" aria-label="Arrastar para reordenar">' + DRAG_ICON + '</button>' : '') +
          (editable ? '<button class="delete" aria-label="Excluir">' + ICONS.trash + '</button>' : '') +
        '</div>';

      var textEl = row.querySelector('.text');
      textEl.value = item.text;

      // tocar no texto abre/fecha o painel (passos, adiar, prioridade)
      row.querySelector('.item-body').addEventListener('click', function () {
        if (!textEl.readOnly) return;
        if (Date.now() - recentDragEndAt < 300) return;
        if (!editable && !steps.length && !item.note) return;
        expandedItemId = expanded ? null : item.id;
        renderDetail();
      });

      if (expanded) row.appendChild(buildItemPanel(list, item, editable));

      if (!editable) {
        container.appendChild(row);
        autoGrow(textEl);
        return;
      }

      row.querySelector('.check').addEventListener('click', function () {
        setDone(list, item, !item.done);
        save();
        justCheckedItemId = null;
        onItemToggled(list, item);
        renderDetail();
        justCheckedItemId = null;
      });

      textEl.addEventListener('input', function () { autoGrow(textEl); });
      textEl.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); textEl.blur(); }
      });
      textEl.addEventListener('blur', function () {
        textEl.readOnly = true;
        var val = textEl.value.trim();
        if (!val) { textEl.value = item.text; return; }
        if (val !== item.text) {
          item.text = val;
          learnFromText(val, list.id);
          save();
        }
      });

      row.querySelector('.edit-btn').addEventListener('click', function (e) {
        e.stopPropagation();
        textEl.readOnly = false;
        textEl.focus();
        textEl.setSelectionRange(textEl.value.length, textEl.value.length);
      });

      if (canReorder) {
        setupDragReorder(container, row, row.querySelector('.drag-handle'), list.items, item, function () {
          save();
          renderDetail();
        });
      }

      row.querySelector('.delete').addEventListener('click', function () {
        trashItemWithUndo(list, item);
      });

      container.appendChild(row);
      autoGrow(textEl);
      if (expanded && focusStepInputFor === item.id) {
        var inp = row.querySelector('.step-input');
        if (inp) inp.focus();
        focusStepInputFor = null;
      }
    });
  }

  // Painel da tarefa: passos (subtarefas), prioridade do dia e adiar.
  function buildItemPanel(list, item, editable) {
    var panel = document.createElement('div');
    panel.className = 'item-panel';
    var steps = item.steps || [];
    var html = '';
    if (steps.length) {
      html += '<ul class="step-list">' + steps.map(function (st, idx) {
        return '<li class="step-row' + (st.done ? ' done' : '') + '" data-idx="' + idx + '">' +
          '<div class="step-check" role="checkbox" aria-checked="' + (st.done ? 'true' : 'false') + '">' + (st.done ? ICONS.check : '') + '</div>' +
          '<span class="step-text"></span>' +
          (editable ? '<button class="step-del" type="button" aria-label="Remover passo">' + ICONS.x + '</button>' : '') +
        '</li>';
      }).join('') + '</ul>';
    } else if (editable) {
      html += '<p class="panel-hint">Divida em passos pequenos: fica mais fácil começar.</p>';
    }
    if (!editable && item.note) {
      html += '<div class="note-box"><div class="note-label">📝 Anotação</div><div class="note-text"></div><div class="note-links"></div></div>';
    }
    if (editable) {
      html += '<div class="step-add">' +
        '<input class="step-input" type="text" maxlength="100" placeholder="Adicionar um passo…" enterkeyhint="done" autocomplete="off">' +
        '<button class="step-add-btn" type="button" aria-label="Adicionar passo">' + ICONS.plus + '</button></div>';
      html += '<div class="note-box"><label class="note-label" for="note-' + item.id + '">📝 Anotação</label>' +
        '<textarea id="note-' + item.id + '" class="note-input" rows="2" maxlength="500" placeholder="Endereço, telefone, link, o que não esquecer…"></textarea>' +
        '<div class="note-links"></div></div>';
      if (!item.done) {
        html += '<div class="panel-actions">' +
          '<button type="button" class="chip" data-act="pick">' + (isPicked(list, item) ? '⭐ Tirar das prioridades' : '⭐ Prioridade de hoje') + '</button>' +
          '<button type="button" class="chip" data-act="remind">' + (getTaskReminder(list, item) ? '🔔 Lembrete ' + remindWhen(getTaskReminder(list, item)) : '🔔 Lembrar') + '</button>' +
          (isSnoozed(item)
            ? '<button type="button" class="chip" data-act="unsnooze">↩︎ Trazer de volta hoje</button>'
            : '<button type="button" class="chip" data-act="snooze">⏰ Adiar</button>') +
        '</div>' +
        '<div class="remind-box hidden">' +
          '<label>Dia <input type="date" class="remind-date"></label>' +
          '<label>Hora <input type="time" class="remind-time"></label>' +
          '<div class="remind-btns"><button type="button" class="btn btn-primary remind-save">Salvar lembrete</button>' +
          (getTaskReminder(list, item) ? '<button type="button" class="btn btn-secondary remind-clear">Remover</button>' : '') + '</div>' +
          '<p class="hint remind-hint"></p>' +
        '</div>' +
        '<div class="snooze-options hidden">' +
          '<button type="button" class="chip" data-days="1">Amanhã</button>' +
          '<button type="button" class="chip" data-days="3">Em 3 dias</button>' +
          '<button type="button" class="chip" data-days="7">Semana que vem</button>' +
        '</div>';
      }
    }
    panel.innerHTML = html;

    panel.querySelectorAll('.step-row').forEach(function (r) {
      var st = steps[parseInt(r.getAttribute('data-idx'), 10)];
      r.querySelector('.step-text').textContent = st.text;
      if (!editable) return;
      r.querySelector('.step-check').addEventListener('click', function () {
        toggleStep(list, item, st);
        renderDetail();
      });
      r.querySelector('.step-del').addEventListener('click', function () {
        item.steps = item.steps.filter(function (x) { return x.id !== st.id; });
        if (!item.steps.length) delete item.steps;
        save();
        renderDetail();
      });
    });

    if (!editable) {
      var nt = panel.querySelector('.note-text');
      if (nt) { nt.textContent = item.note; renderLinkChips(panel.querySelector('.note-links'), findLinks(item.note)); }
      return panel;
    }

    var noteEl = panel.querySelector('.note-input');
    var noteLinks = panel.querySelector('.note-links');
    noteEl.value = item.note || '';
    renderLinkChips(noteLinks, findLinks(noteEl.value));
    autoGrow(noteEl);
    var noteTimer = null;
    noteEl.addEventListener('input', function () {
      autoGrow(noteEl);
      renderLinkChips(noteLinks, findLinks(noteEl.value));
      clearTimeout(noteTimer);
      noteTimer = setTimeout(function () { setNote(item, noteEl.value); }, 600);
    });
    noteEl.addEventListener('blur', function () {
      clearTimeout(noteTimer);
      if ((item.note || '') !== noteEl.value.trim().slice(0, 500)) setNote(item, noteEl.value);
    });

    function submitSteps() {
      var inp = panel.querySelector('.step-input');
      if (!inp.value.trim()) return;
      addSteps(item, inp.value);
      save();
      focusStepInputFor = item.id;
      renderDetail();
    }
    panel.querySelector('.step-add-btn').addEventListener('click', submitSteps);
    panel.querySelector('.step-input').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); submitSteps(); }
    });
    panel.querySelector('.step-input').addEventListener('paste', function (e) {
      var text = (e.clipboardData && e.clipboardData.getData('text')) || '';
      if (/\n/.test(text.trim())) { e.preventDefault(); addSteps(item, text); save(); focusStepInputFor = item.id; renderDetail(); }
    });

    var pick = panel.querySelector('[data-act="pick"]');
    if (pick) pick.addEventListener('click', function () { togglePick(list, item); renderDetail(); });
    var un = panel.querySelector('[data-act="unsnooze"]');
    if (un) un.addEventListener('click', function () { delete item.snoozeUntil; save(); renderDetail(); });
    var rm = panel.querySelector('[data-act="remind"]');
    if (rm) {
      var box = panel.querySelector('.remind-box');
      rm.addEventListener('click', function () {
        box.classList.toggle('hidden');
        if (box.classList.contains('hidden')) return;
        var cur = getTaskReminder(list, item);
        var d = new Date(Date.now() + 3600000);
        box.querySelector('.remind-date').value = cur ? cur.date : dayKey(d);
        box.querySelector('.remind-time').value = cur ? cur.time : String(d.getHours()).padStart(2, '0') + ':00';
        var hint = box.querySelector('.remind-hint');
        hint.textContent = pushFeatures && pushFeatures.indexOf('task-reminders') < 0
          ? 'O servidor ainda não tem essa função; o aviso só chega depois da atualização dele.'
          : (!pushSupported() || !isStandalone()
            ? 'Para receber o aviso, ative as notificações em Ajustes (com o app na Tela de Início).'
            : 'Você recebe uma notificação nesse horário.');
      });
      box.querySelector('.remind-save').addEventListener('click', function () {
        var date = box.querySelector('.remind-date').value, time = box.querySelector('.remind-time').value;
        if (!date || !time) { showToast('Escolha o dia e a hora.'); return; }
        if (new Date(date + 'T' + time + ':00').getTime() <= Date.now()) { showToast('Esse horário já passou.'); return; }
        setTaskReminder(list, item, date, time);
        renderDetail();
      });
      var rc = box.querySelector('.remind-clear');
      if (rc) rc.addEventListener('click', function () { clearTaskReminder(list, item); renderDetail(); });
    }
    var sn = panel.querySelector('[data-act="snooze"]');
    if (sn) sn.addEventListener('click', function () { panel.querySelector('.snooze-options').classList.toggle('hidden'); });
    panel.querySelectorAll('[data-days]').forEach(function (el) {
      el.addEventListener('click', function () {
        snoozeItem(list, item, parseInt(el.getAttribute('data-days'), 10), renderDetail);
      });
    });
    return panel;
  }

  // ---------- adicionar item (com sugestão de lista) ----------

  var addSuggestionTimer = null;

  function hideAddSuggestion() {
    var box = document.getElementById('add-suggestion');
    box.classList.add('hidden');
    box.innerHTML = '';
  }

  function updateAddSuggestion(text) {
    var box = document.getElementById('add-suggestion');
    var suggestion = bestSuggestion(text, currentListId);
    var list = suggestion && getList(suggestion.listId);
    if (list && !canEditItems(list)) list = null;

    if (list) {
      box.classList.remove('hidden');
      box.innerHTML =
        '💡 Combina mais com <strong>' + list.emoji + ' ' + escapeHtml(list.name) + '</strong> ' +
        '<button id="add-suggestion-btn" class="btn btn-secondary" style="flex:none;padding:6px 10px;">Adicionar lá</button>';

      document.getElementById('add-suggestion-btn').addEventListener('click', function () {
        var input = document.getElementById('add-item-input');
        var text2 = input.value.trim();
        if (!text2) return;
        list.items.push({ id: uid(), text: text2, done: false });
        learnFromText(text2, list.id);
        save();
        input.value = '';
        autoGrow(input);
        hideAddSuggestion();
        renderHome();
        alert('Adicionado em ' + list.emoji + ' ' + list.name + '.');
      });
      return;
    }

    var words = tokenize(text);
    var newCat = words.length ? bestNewCategorySuggestion(words) : null;
    if (!newCat) { hideAddSuggestion(); return; }

    box.classList.remove('hidden');
    box.innerHTML =
      '💡 Não achei uma lista pra isso. Criar <strong>' + newCat.def.emoji + ' ' + escapeHtml(newCat.def.name) + '</strong>? ' +
      '<button id="add-suggestion-btn" class="btn btn-secondary" style="flex:none;padding:6px 10px;">Criar lista</button>';

    document.getElementById('add-suggestion-btn').addEventListener('click', function () {
      var input = document.getElementById('add-item-input');
      var text2 = input.value.trim();
      if (!text2) return;
      var newList = createList(newCat.def.name, newCat.def.emoji, 'lista');
      newList.items.push({ id: uid(), text: text2, done: false });
      learnFromText(text2, newList.id);
      state.lists.push(newList);
      save();
      input.value = '';
      autoGrow(input);
      hideAddSuggestion();
      renderHome();
      alert('Lista ' + newCat.def.emoji + ' ' + newCat.def.name + ' criada com o item.');
    });
  }

  document.getElementById('add-item-input').addEventListener('input', function () {
    autoGrow(this);
    var val = this.value;
    clearTimeout(addSuggestionTimer);
    addSuggestionTimer = setTimeout(function () { updateAddSuggestion(val); }, 250);
  });

  document.getElementById('add-item-input').addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      document.getElementById('add-item-form').requestSubmit();
    }
  });

  document.getElementById('add-item-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var input = document.getElementById('add-item-input');
    var text = input.value.trim();
    if (!text) return;
    var list = getList(currentListId);
    var newItem = { id: uid(), text: text, done: false };
    list.items.push(newItem);
    learnFromText(text, list.id);
    input.value = '';
    autoGrow(input);
    hideAddSuggestion();
    save();
    renderDetail();
    var w = parseWhen(text);
    if (w) {
      showUndo('Lembrar ' + remindWhen(w) + '?', function () {
        setTaskReminder(list, newItem, w.date, w.time);
        if (currentListId === list.id) renderDetail();
      }, 'Lembrar');
    }
  });

  document.getElementById('btn-back').addEventListener('click', showHome);

  document.querySelectorAll('#item-filter .filter-choice').forEach(function (btn) {
    btn.addEventListener('click', function () {
      itemFilter = btn.dataset.filter;
      renderDetail();
    });
  });

  // ---------- modal helper ----------

  var backdrop = document.getElementById('modal-backdrop');
  var modal = document.getElementById('modal');

  function openModal(html) {
    modal.innerHTML = html;
    backdrop.classList.remove('hidden');
  }

  var onModalCloseOnce = null;

  function closeModal() {
    backdrop.classList.add('hidden');
    modal.innerHTML = '';
    var hook = onModalCloseOnce;
    onModalCloseOnce = null;
    if (hook) hook();
  }

  backdrop.addEventListener('click', function (e) {
    if (e.target === backdrop) closeModal();
  });

  // Arrastar a "alça" no topo da folha pra baixo fecha (gesto comum no iOS).
  (function () {
    var startY = null, dy = 0;
    modal.addEventListener('pointerdown', function (e) {
      var r = modal.getBoundingClientRect();
      if (e.clientY - r.top > 36 || modal.scrollTop > 0) return;
      startY = e.clientY; dy = 0;
      modal.style.transition = 'none';
      try { modal.setPointerCapture(e.pointerId); } catch (err) {}
    });
    modal.addEventListener('pointermove', function (e) {
      if (startY === null) return;
      dy = Math.max(0, e.clientY - startY);
      modal.style.transform = 'translateY(' + dy + 'px)';
    });
    function end() {
      if (startY === null) return;
      var close = dy > 110;
      startY = null;
      modal.style.transition = '';
      modal.style.transform = '';
      if (close) closeModal();
    }
    modal.addEventListener('pointerup', end);
    modal.addEventListener('pointercancel', end);
  })();

  // ---------- anotar rápido ----------
  // Pensado para o momento em que a ideia some em segundos: abre já com o teclado,
  // guarda sem pedir lista (cai na sugestão ou na "Caixa de entrada") e continua aberto.

  var INBOX_NAME = 'Caixa de entrada';

  function findInbox() {
    return state.lists.filter(function (l) { return l.name === INBOX_NAME && !l.role; })[0] || null;
  }

  function captureTargets() {
    var lists = state.lists.filter(canEditItems);
    return lists;
  }

  function captureItems(text, listId) {
    var lines = String(text).split(/\n+/).map(function (t) { return t.trim().slice(0, 200); }).filter(Boolean).slice(0, 20);
    if (!lines.length) return null;
    var list;
    if (listId === '__inbox') {
      list = findInbox();
      if (!list) { list = createList(INBOX_NAME, '📥', 'lista'); state.lists.push(list); }
    } else {
      list = getList(listId);
    }
    if (!list || !canEditItems(list)) return null;
    var added = lines.map(function (t) {
      var it = { id: uid(), text: t, done: false };
      list.items.push(it);
      learnFromText(t, list.id);
      return it;
    });
    save();
    return { list: list, count: lines.length, items: added, lines: lines };
  }

  // index.html antigo em cache não tem o botão: cria na hora, junto do "+".
  var captureBtn = document.getElementById('btn-capture');
  if (!captureBtn) {
    captureBtn = document.createElement('button');
    captureBtn.id = 'btn-capture';
    captureBtn.className = 'fab fab-mini';
    captureBtn.setAttribute('aria-label', 'Anotar rápido');
    captureBtn.innerHTML = '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M13 3 5 13.5h6L10 21l8-10.5h-6z"/></svg>';
    var fabNew = document.getElementById('btn-new-list');
    fabNew.parentNode.insertBefore(captureBtn, fabNew);
  }
  captureBtn.addEventListener('click', function () {
    var targets = captureTargets();
    var inbox = findInbox();
    var picked = false;
    var options = targets.map(function (l) {
      return '<option value="' + l.id + '">' + l.emoji + ' ' + escapeHtml(l.name) + '</option>';
    }).join('');
    if (!inbox) options = '<option value="__inbox">📥 ' + INBOX_NAME + ' (nova)</option>' + options;
    openModal(
      '<h2>Anotar rápido</h2>' +
      '<label class="sr-only" for="m-cap-text">O que veio à cabeça?</label>' +
      '<textarea id="m-cap-text" rows="3" maxlength="600" placeholder="O que veio à cabeça? (uma ideia por linha)" enterkeyhint="done" autocomplete="off"></textarea>' +
      '<label>Guardar em<select id="m-cap-list">' + options + '</select></label>' +
      '<p id="m-cap-msg" class="hint" role="status" aria-live="polite" style="margin:0;"></p>' +
      '<div class="modal-actions"><button id="m-cap-close" class="btn btn-secondary">Fechar</button><button id="m-cap-save" class="btn btn-primary">Guardar</button></div>'
    );
    var ta = document.getElementById('m-cap-text'), sel = document.getElementById('m-cap-list'), msg = document.getElementById('m-cap-msg');
    if (inbox) sel.value = inbox.id;
    sel.addEventListener('change', function () { picked = true; });
    ta.addEventListener('input', function () {
      autoGrow(ta);
      if (picked) return;
      var sug = bestSuggestion(ta.value, null);
      var target = sug && getList(sug.listId);
      if (target && canEditItems(target)) sel.value = target.id;
      else sel.value = inbox && sel.querySelector('option[value="' + inbox.id + '"]') ? inbox.id : '__inbox';
    });
    function saveCapture() {
      var res = captureItems(ta.value, sel.value);
      if (!res) { ta.focus(); return; }
      ta.value = ''; autoGrow(ta);
      msg.textContent = (res.count > 1 ? res.count + ' anotações guardadas em ' : 'Guardado em ') + res.list.emoji + ' ' + res.list.name + '. Pode anotar mais.';
      renderHome();
      inbox = findInbox();
      var w = res.count === 1 ? parseWhen(res.lines[0]) : null;
      if (w) {
        var rb = document.createElement('button');
        rb.type = 'button'; rb.className = 'chip'; rb.id = 'm-cap-remind';
        rb.textContent = '🔔 Lembrar ' + remindWhen(w);
        rb.addEventListener('click', function () {
          setTaskReminder(res.list, res.items[0], w.date, w.time);
          rb.remove();
          msg.textContent = 'Lembrete criado para ' + remindWhen(w) + '. Pode anotar mais.';
          renderHome();
          ta.focus();
        });
        msg.appendChild(document.createTextNode(' '));
        msg.appendChild(rb);
      }
      ta.focus();
    }
    document.getElementById('m-cap-save').addEventListener('click', saveCapture);
    document.getElementById('m-cap-close').addEventListener('click', closeModal);
    ta.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveCapture(); }
    });
    setTimeout(function () { ta.focus(); }, 60);
  });

  // ---------- nova lista ----------

  document.getElementById('btn-new-list').addEventListener('click', function () {
    var chosenEmoji = EMOJI_CHOICES[0];
    var chosenType = 'lista';

    var chosenTemplate = null;

    openModal(
      '<h2>Nova lista</h2>' +
      '<div><div class="field-label">Começar de um modelo</div>' +
        '<div class="chip-row scroll" id="m-templates">' + TEMPLATES.map(function (t) {
          return '<button type="button" class="chip" data-key="' + t.key + '">' + t.emoji + ' ' + t.name + '</button>';
        }).join('') + '</div>' +
        '<p id="m-template-note" class="hint hidden" style="margin:8px 0 0;"></p></div>' +
      '<label>Nome<input id="m-name" type="text" placeholder="Ex: Academia" maxlength="40"></label>' +
      '<label>Ícone<div id="m-emojis" class="emoji-row"></div></label>' +
      '<label>Tipo' +
        '<div class="type-row">' +
          '<div class="type-choice" data-type="lista">Lista simples<small>marca e depois você limpa</small></div>' +
          '<div class="type-choice" data-type="rotina">Rotina diária<small>desmarca sozinha à meia-noite</small></div>' +
        '</div>' +
      '</label>' +
      '<div class="modal-actions">' +
        '<button id="m-cancel" class="btn btn-secondary">Cancelar</button>' +
        '<button id="m-create" class="btn btn-primary">Criar</button>' +
      '</div>'
    );

    var emojiRow = document.getElementById('m-emojis');
    EMOJI_CHOICES.forEach(function (em) {
      var span = document.createElement('span');
      span.className = 'emoji-choice' + (em === chosenEmoji ? ' selected' : '');
      span.textContent = em;
      span.addEventListener('click', function () {
        chosenEmoji = em;
        emojiRow.querySelectorAll('.emoji-choice').forEach(function (el) { el.classList.remove('selected'); });
        span.classList.add('selected');
      });
      emojiRow.appendChild(span);
    });

    modal.querySelectorAll('.type-choice').forEach(function (el) {
      if (el.dataset.type === chosenType) el.classList.add('selected');
      el.addEventListener('click', function () {
        chosenType = el.dataset.type;
        modal.querySelectorAll('.type-choice').forEach(function (o) { o.classList.remove('selected'); });
        el.classList.add('selected');
      });
    });

    function paintChoices() {
      emojiRow.querySelectorAll('.emoji-choice').forEach(function (el) { el.classList.toggle('selected', el.textContent === chosenEmoji); });
      modal.querySelectorAll('.type-choice').forEach(function (o) { o.classList.toggle('selected', o.dataset.type === chosenType); });
    }
    modal.querySelectorAll('#m-templates .chip').forEach(function (chip) {
      chip.addEventListener('click', function () {
        var key = chip.getAttribute('data-key');
        var note = document.getElementById('m-template-note');
        modal.querySelectorAll('#m-templates .chip').forEach(function (c) { c.classList.remove('selected'); });
        if (chosenTemplate && chosenTemplate.key === key) {
          chosenTemplate = null;
          note.classList.add('hidden');
          return;
        }
        chosenTemplate = templateByKey(key);
        chip.classList.add('selected');
        document.getElementById('m-name').value = chosenTemplate.name;
        chosenEmoji = chosenTemplate.emoji;
        chosenType = chosenTemplate.type;
        paintChoices();
        note.textContent = chosenTemplate.items.length + ' itens já vêm prontos; você edita depois.';
        note.classList.remove('hidden');
      });
    });

    document.getElementById('m-cancel').addEventListener('click', closeModal);
    document.getElementById('m-create').addEventListener('click', function () {
      var name = document.getElementById('m-name').value.trim();
      if (!name) return;
      var created = createList(name, chosenEmoji, chosenType);
      if (chosenTemplate) {
        created.items = chosenTemplate.items.map(function (text) { return { id: uid(), text: text, done: false }; });
      }
      state.lists.push(created);
      save();
      closeModal();
      renderHome();
    });

    document.getElementById('m-name').focus();
  });

  // ---------- menu da lista (⋯) ----------

  function buildShareText(list) {
    var lines = [];
    list.items.forEach(function (i) {
      lines.push((i.done ? '✅ ' : '⬜ ') + i.text);
      if (i.note) lines.push('    📝 ' + String(i.note).replace(/\s+/g, ' ').slice(0, 160));
      (i.steps || []).forEach(function (st) { lines.push('    ' + (st.done ? '✔ ' : '◦ ') + st.text); });
    });
    return list.emoji + ' ' + list.name + '\n' + (lines.length ? lines.join('\n') : '(sem itens)');
  }

  function shareList(list) {
    var text = buildShareText(list);
    if (navigator.share) {
      navigator.share({ title: list.name, text: text }).catch(function () {});
      return;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        alert('Lista copiada pra área de transferência.');
      }).catch(function () {
        prompt('Copie o texto abaixo:', text);
      });
      return;
    }
    prompt('Copie o texto abaixo:', text);
  }

  function openListIconPicker(list) {
    var chosenEmoji = list.emoji;
    openModal(
      '<h2>Trocar ícone</h2>' +
      '<div id="m-emojis" class="emoji-row"></div>' +
      '<div class="modal-actions">' +
        '<button id="m-back" class="btn btn-secondary">Voltar</button>' +
        '<button id="m-save" class="btn btn-primary">Salvar</button>' +
      '</div>'
    );

    var emojiRow = document.getElementById('m-emojis');
    EMOJI_CHOICES.forEach(function (em) {
      var span = document.createElement('span');
      span.className = 'emoji-choice' + (em === chosenEmoji ? ' selected' : '');
      span.textContent = em;
      span.addEventListener('click', function () {
        chosenEmoji = em;
        emojiRow.querySelectorAll('.emoji-choice').forEach(function (el) { el.classList.remove('selected'); });
        span.classList.add('selected');
      });
      emojiRow.appendChild(span);
    });

    document.getElementById('m-back').addEventListener('click', function () { openListMenu(list); });
    document.getElementById('m-save').addEventListener('click', function () {
      list.emoji = chosenEmoji;
      save();
      openListMenu(list);
    });
  }

  function on(id, fn) {
    var el = document.getElementById(id);
    if (el) el.addEventListener('click', fn);
  }

  function openListMenu(list) {
    document.getElementById('detail-title').textContent = list.emoji + ' ' + list.name;

    var SORT_LABELS = { manual: 'Manual (arrastar)', alpha: 'Alfabética', 'pending-first': 'Pendentes primeiro' };
    var SORT_NEXT = { manual: 'alpha', alpha: 'pending-first', 'pending-first': 'manual' };
    var isMeta = canEditMeta(list);
    var isItems = canEditItems(list);

    var html = '<h2>' + list.emoji + ' ' + escapeHtml(list.name) + '</h2>';
    // Lembrete é por pessoa: cada um configura o seu, mesmo numa lista compartilhada
    // onde só o dono edita nome/ícone/tipo.
    html +=
      '<div class="settings-label">Lembrete</div>' +
      '<div class="settings-group">' +
        '<label class="settings-row"><span>Lembrete diário</span>' +
          '<input id="m-reminder-enabled" type="checkbox"' + (list.reminder.enabled ? ' checked' : '') + '></label>' +
        '<div id="m-reminder-times"></div>' +
        '<div class="stack"><button id="m-add-time" class="btn btn-secondary small-btn">+ Adicionar horário</button></div>' +
        '<p class="hint">Pra receber esse aviso mesmo com o app fechado, ative "Notificações" em Ajustes. Não avisa se a lista já estiver toda feita. Esse lembrete é só seu; cada pessoa na lista escolhe o próprio horário.</p>' +
      '</div>';
    html +=
      '<div class="settings-label">Incentivo</div>' +
      '<div class="settings-group">' +
        '<div class="settings-row"><span>Recompensa ao concluir</span><button id="m-reward" class="btn btn-secondary">' +
          (game.rewards[list.id] ? escapeHtml(game.rewards[list.id].slice(0, 18)) : 'Definir') + '</button></div>' +
      '</div>';
    if (isMeta) {
      html +=
        '<div class="settings-label">Lista</div>' +
        '<div class="settings-group">' +
          '<div class="settings-row"><span>Ícone</span><button id="m-change-icon" class="btn btn-secondary">' + list.emoji + ' Trocar</button></div>' +
          '<div class="settings-row"><span>Tipo</span><button id="m-change-type" class="btn btn-secondary">' +
            (list.type === 'rotina' ? 'Rotina diária' : 'Lista simples') + '</button></div>' +
          (list.type === 'rotina'
            ? '<div class="settings-row"><span>Dias da semana</span><button id="m-days" class="btn btn-secondary">' + daysLabel(list) + '</button></div>'
            : '') +
          '<div class="settings-row"><span>Ordenar por</span><button id="m-sort-order" class="btn btn-secondary">' +
            SORT_LABELS[list.sortOrder] + '</button></div>' +
          '<div class="settings-row"><span>Nome</span><button id="m-rename" class="btn btn-secondary">Renomear</button></div>' +
        '</div>';
    }
    html += '<div class="settings-label">Compartilhar</div><div class="settings-group"><div class="stack">';
    if (list.role) {
      html += '<button id="m-members" class="btn btn-secondary">' +
        (list.role === 'owner' ? '👥 Compartilhar com pessoas' : '👥 Ver membros') + '</button>';
    } else if (isMeta) {
      html += '<button id="m-members-local" class="btn btn-secondary">👥 Compartilhar com pessoas</button>';
    }
    html += '<button id="m-share" class="btn btn-secondary">Copiar como texto</button>' +
      '<button id="m-duplicate" class="btn btn-secondary">Duplicar lista</button></div></div>';
    if (isItems) {
      html +=
        '<div class="settings-label">Itens</div>' +
        '<div class="settings-group"><div class="stack">' +
          '<button id="m-check-all" class="btn btn-secondary">Marcar todos</button>' +
          '<button id="m-uncheck-all" class="btn btn-secondary">Desmarcar todos</button>' +
          '<button id="m-clear" class="btn btn-secondary">Limpar concluídos</button>' +
        '</div></div>';
    }
    html += isMeta
      ? '<button id="m-delete" class="btn btn-danger">Excluir lista</button>'
      : '<button id="m-delete" class="btn btn-danger">Sair da lista</button>';
    html += '<button id="m-cancel" class="btn btn-secondary">Fechar</button>';
    openModal(html);

    function renderTimesList() {
      var box = document.getElementById('m-reminder-times');
      if (!box) return;
      box.innerHTML = list.reminder.times.map(function (t, idx) {
        return '<div class="settings-row">' +
          '<input type="time" class="m-time-input" data-idx="' + idx + '" value="' + t + '">' +
          (list.reminder.times.length > 1
            ? '<button class="btn btn-secondary m-time-remove" data-idx="' + idx + '">Remover</button>'
            : '') +
          '</div>';
      }).join('');
      box.querySelectorAll('.m-time-input').forEach(function (el) {
        el.addEventListener('change', function () {
          list.reminder.times[Number(el.dataset.idx)] = el.value || '08:00';
          save();
        });
      });
      box.querySelectorAll('.m-time-remove').forEach(function (el) {
        el.addEventListener('click', function () {
          list.reminder.times.splice(Number(el.dataset.idx), 1);
          save();
          renderTimesList();
        });
      });
    }
    renderTimesList();

    on('m-add-time', function () {
      list.reminder.times.push('08:00');
      save();
      renderTimesList();
    });

    var reminderToggle = document.getElementById('m-reminder-enabled');
    if (reminderToggle) {
      reminderToggle.addEventListener('change', function () {
        list.reminder.enabled = this.checked;
        save();
      });
    }

    on('m-cancel', closeModal);
    on('m-change-icon', function () { openListIconPicker(list); });

    on('m-change-type', function () {
      list.type = list.type === 'rotina' ? 'lista' : 'rotina';
      save();
      openListMenu(list);
      renderDetail();
    });

    on('m-sort-order', function () {
      list.sortOrder = SORT_NEXT[list.sortOrder];
      save();
      openListMenu(list);
      renderDetail();
    });

    on('m-rename', function () {
      var novo = prompt('Novo nome da lista:', list.name);
      if (novo && novo.trim()) {
        list.name = novo.trim();
        save();
        closeModal();
        renderDetail();
      }
    });

    on('m-members', function () { openMembersModal(list); });
    on('m-members-local', function () {
      if (!session) {
        alert('Pra compartilhar com outras pessoas, entre numa conta primeiro.');
        openAuthModal();
        return;
      }
      enrollList(list);
      openMembersModal(list);
    });

    on('m-share', function () { shareList(list); });
    on('m-reward', function () { openRewardEditor(list); });
    on('m-days', function () { openDaysPicker(list); });
    on('m-duplicate', function () {
      var copy = duplicateList(list);
      closeModal();
      showHome();
      showToast('Lista duplicada: ' + copy.name);
    });

    function setAllDone(value, label) {
      var before = {};
      list.items.forEach(function (i) { before[i.id] = { done: i.done, by: i.doneBy }; if (i.done !== value) setDone(list, i, value); });
      save();
      closeModal();
      renderDetail();
      showUndo(label, function () {
        list.items.forEach(function (i) {
          if (!(i.id in before)) return;
          i.done = before[i.id].done;
          if (before[i.id].by) i.doneBy = before[i.id].by; else delete i.doneBy;
        });
        save();
        if (currentListId === list.id) renderDetail();
      });
    }
    on('m-check-all', function () { setAllDone(true, 'Todos marcados'); });
    on('m-uncheck-all', function () { setAllDone(false, 'Todos desmarcados'); });

    on('m-clear', function () {
      var removed = [];
      list.items.forEach(function (i, idx) { if (i.done) removed.push({ item: i, idx: idx }); });
      if (!removed.length) { closeModal(); return; }
      removed.forEach(function (r) { r.entryId = moveItemToTrash(list, r.item).id; });
      closeModal();
      renderDetail();
      showUndo(removed.length === 1 ? '1 item concluído removido' : removed.length + ' itens concluídos removidos', function () {
        undoItemsTrash(list, removed);
      });
    });

    on('m-delete', function () {
      closeModal();
      removeListWithConfirm(list, showHome);
    });
  }

  document.getElementById('btn-list-menu').addEventListener('click', function () {
    var list = getList(currentListId);
    if (!list) return;
    openListMenu(list);
  });

  function escapeHtml(s) {
    var div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  // ---------- lixeira (restaurar exclusões de até 7 dias) ----------

  function renderTrashModal() {
    purgeOldTrash();

    var itemsHtml = state.trash.length === 0
      ? '<p class="hint" style="margin:0;">Lixeira vazia.</p>'
      : state.trash.slice().reverse().map(function (entry) {
          var daysLeft = Math.max(0, Math.ceil((entry.deletedAt + TRASH_RETENTION_MS - Date.now()) / 86400000));
          var label = entry.type === 'list'
            ? entry.list.emoji + ' ' + escapeHtml(entry.list.name) +
              ' <span style="color:var(--text-dim);font-size:12px;">(lista inteira)</span>'
            : escapeHtml(entry.item.text) +
              ' <span style="color:var(--text-dim);font-size:12px;">— ' + entry.listEmoji + ' ' + escapeHtml(entry.listName) + '</span>';
          return (
            '<div class="settings-row">' +
              '<span>' + label + '<br><span class="hint" style="margin:0;">expira em ' + daysLeft + ' dia' + (daysLeft === 1 ? '' : 's') + '</span></span>' +
              '<span style="display:flex;gap:6px;flex-shrink:0;">' +
                '<button class="btn btn-secondary trash-restore" data-id="' + entry.id + '" style="flex:none;padding:8px 10px;">Restaurar</button>' +
                '<button class="btn btn-danger trash-purge" data-id="' + entry.id + '" style="flex:none;padding:8px 10px;">Excluir de vez</button>' +
              '</span>' +
            '</div>'
          );
        }).join('');

    openModal(
      '<h2>🗑️ Lixeira</h2>' +
      '<p class="hint" style="margin:0;">Itens e listas excluídos ficam aqui por 7 dias antes de sumir de vez.</p>' +
      itemsHtml +
      '<button id="m-cancel" class="btn btn-secondary">Fechar</button>'
    );

    document.getElementById('m-cancel').addEventListener('click', closeModal);

    modal.querySelectorAll('.trash-restore').forEach(function (btn) {
      btn.addEventListener('click', function () {
        restoreTrashEntry(btn.dataset.id);
        renderTrashModal();
        renderHome();
        if (currentListId) renderDetail();
      });
    });
    modal.querySelectorAll('.trash-purge').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (confirm('Excluir definitivamente? Não dá pra desfazer.')) {
          purgeTrashEntry(btn.dataset.id);
          renderTrashModal();
        }
      });
    });
  }

  document.getElementById('btn-trash').addEventListener('click', renderTrashModal);

  // ---------- busca entre todas as listas ----------

  function renderSearchResults(query) {
    var box = document.getElementById('m-search-results');
    var q = normalizeAccents(query.toLowerCase()).trim();
    if (!q) { box.innerHTML = ''; return; }

    var results = [];
    state.lists.forEach(function (list) {
      list.items.forEach(function (item) {
        if (normalizeAccents((item.text + ' ' + (item.note || '')).toLowerCase()).indexOf(q) !== -1) {
          results.push({ list: list, item: item });
        }
      });
    });

    if (results.length === 0) {
      box.innerHTML = '<p class="hint" style="margin:0;">Nada encontrado.</p>';
      return;
    }

    box.innerHTML = results.map(function (r) {
      return '<div class="settings-row search-result" data-list="' + r.list.id + '">' +
        '<span>' + (r.item.done ? '✅ ' : '⬜ ') + escapeHtml(r.item.text) + '</span>' +
        '<span class="hint" style="margin:0;flex-shrink:0;">' + r.list.emoji + ' ' + escapeHtml(r.list.name) + '</span>' +
      '</div>';
    }).join('');

    box.querySelectorAll('.search-result').forEach(function (el) {
      el.style.cursor = 'pointer';
      el.addEventListener('click', function () {
        closeModal();
        showDetail(el.dataset.list);
      });
    });
  }

  document.getElementById('btn-search').addEventListener('click', function () {
    openModal(
      '<h2>🔍 Buscar</h2>' +
      '<input id="m-search-input" type="text" placeholder="Digite pra buscar…" ' +
        'style="background:var(--card-2);border:1px solid var(--border);border-radius:10px;padding:12px 14px;color:var(--text);font-size:16px;">' +
      '<div id="m-search-results" style="display:flex;flex-direction:column;gap:8px;"></div>' +
      '<button id="m-cancel" class="btn btn-secondary">Fechar</button>'
    );
    document.getElementById('m-cancel').addEventListener('click', closeModal);
    var input = document.getElementById('m-search-input');
    input.addEventListener('input', function () { renderSearchResults(input.value); });
    input.focus();
  });

  // ---------- ajustes (exportar / importar) ----------

  document.getElementById('btn-settings').addEventListener('click', function () {
    openModal(
      '<h2>Ajustes</h2>' +
      '<div class="settings-label">Foco e bem-estar</div>' +
      '<div class="settings-group">' +
      '<div class="settings-row"><span>Perfil de uso</span><button id="m-profile" class="btn btn-secondary">Escolher</button></div>' +
      '<div class="settings-row"><span>Progresso e feedback ao marcar</span><button id="m-game-toggle" class="switch" role="switch" aria-label="Progresso e feedback ao marcar" aria-checked="' + (game.enabled ? 'true' : 'false') + '"><span></span></button></div>' +
      '<div class="settings-row"><span>Modo tranquilo (sem contagens nem números)</span><button id="m-calm-toggle" class="switch" role="switch" aria-label="Modo tranquilo (sem contagens nem números)" aria-checked="' + (game.calm ? 'true' : 'false') + '"><span></span></button></div>' +
      '<div class="settings-row"><span>“Para agora” na home (3 próximas tarefas)</span><button id="m-today-toggle" class="switch" role="switch" aria-label="“Para agora” na home (3 próximas tarefas)" aria-checked="' + (game.today !== false ? 'true' : 'false') + '"><span></span></button></div>' +
      '</div>' +
      '<div class="settings-label">Lembretes</div>' +
      '<div class="settings-group">' +
      '<div class="settings-row"><span>Notificações</span><button id="m-push-toggle" class="btn btn-secondary">…</button></div>' +
      '<p id="m-push-status" class="hint"></p>' +
      '<div class="settings-row"><span>Silenciar lembretes hoje</span><button id="m-mute-toggle" class="switch" role="switch" aria-label="Silenciar lembretes hoje" aria-checked="' + (isMutedToday() ? 'true' : 'false') + '"><span></span></button></div>' +
      '</div>' +
      '<div class="settings-label">Conta e nuvem</div>' +
      '<div class="settings-group">' +
      '<div id="m-cloud-box" style="display:flex;flex-direction:column;gap:8px;"></div>' +
      '<p class="hint">As listas da conta ficam no servidor (não são criptografadas de ponta a ponta) — não guarde nada muito sensível nelas.</p>' +
      '</div>' +
      '<div class="settings-label">Segurança</div>' +
      '<div class="settings-group">' +
      '<div class="settings-row"><span>Bloqueio do app (Face ID/Touch ID)</span><button id="m-app-lock" class="btn btn-secondary">' +
        (isAppLockEnabled() ? 'Desativar' : 'Ativar') + '</button></div>' +
      '</div>' +
      '<div class="settings-label">Dados</div>' +
      '<div class="settings-group">' +
      '<div class="settings-row"><span>Exportar backup (.json)</span><button id="m-export" class="btn btn-secondary">Exportar</button></div>' +
      '<div class="settings-row"><span>Importar backup (.json)</span><button id="m-import" class="btn btn-secondary">Importar</button></div>' +
      '<input id="m-import-file" type="file" accept="application/json" class="hidden" style="display:none;">' +
      '<div class="settings-row"><span>Sugestão de categoria</span><button id="m-reset-learning" class="btn btn-secondary">Resetar aprendizado</button></div>' +
      '</div>' +
      '<div class="settings-label">Aplicativo</div>' +
      '<div class="settings-group">' +
      '<div class="settings-row"><span>Verificar atualização do app</span><button id="m-check-update" class="btn btn-secondary">Verificar</button></div>' +
      '</div>' +
      '<button id="m-cancel" class="btn btn-secondary">Fechar</button>'
    );

    refreshPushUI();
    refreshCloudUI();

    document.getElementById('m-check-update').addEventListener('click', function () {
      if (!swRegistration) { alert('Ainda carregando, tenta de novo em alguns segundos.'); return; }
      swRegistration.update().then(function () {
        alert('Verificado. Se tinha uma versão nova, o app recarrega sozinho em instantes.');
      }).catch(function () {
        alert('Não deu pra verificar agora. Tenta mais tarde.');
      });
    });
    document.getElementById('m-push-toggle').addEventListener('click', function () {
      togglePushNotifications();
    });

    document.getElementById('m-app-lock').addEventListener('click', function () {
      if (isAppLockEnabled()) {
        if (confirm('Desativar o bloqueio do app?')) { disableAppLock(); closeModal(); }
        return;
      }
      enableAppLock().then(function (ok) {
        if (ok) { alert('Bloqueio ativado.'); closeModal(); }
      });
    });

    function bindSwitch(id, flip) {
      var el = document.getElementById(id);
      el.addEventListener('click', function () {
        flip();
        saveGame();
        el.setAttribute('aria-checked', el.getAttribute('aria-checked') === 'true' ? 'false' : 'true');
        if (currentListId) renderDetail(); else renderHome();
      });
    }
    document.getElementById('m-profile').addEventListener('click', openProfilePicker);
    bindSwitch('m-game-toggle', function () { game.enabled = !game.enabled; });

    document.getElementById('m-mute-toggle').addEventListener('click', function () {
      game.muteDate = isMutedToday() ? null : todayStr();
      saveGame();
      this.setAttribute('aria-checked', isMutedToday() ? 'true' : 'false');
      clearTimeout(reminderSyncTimer);
      syncPushSubscription();
    });
    bindSwitch('m-calm-toggle', function () { game.calm = !game.calm; });
    bindSwitch('m-today-toggle', function () { game.today = game.today === false; });

    document.getElementById('m-reset-learning').addEventListener('click', function () {
      if (!confirm('Isso apaga o que o app aprendeu com seus itens (as categorias iniciais continuam). Continuar?')) return;
      state.wordListStats = {};
      state.lists.forEach(function (l) { seedListHints(l); });
      save();
      alert('Aprendizado resetado.');
    });

    document.getElementById('m-cancel').addEventListener('click', closeModal);

    document.getElementById('m-export').addEventListener('click', function () {
      exportData();
    });

    var fileInput = document.getElementById('m-import-file');
    document.getElementById('m-import').addEventListener('click', function () {
      fileInput.click();
    });
    fileInput.addEventListener('change', function () {
      var file = fileInput.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var parsed = JSON.parse(reader.result);
          if (!parsed.lists) throw new Error('formato inválido');
          if (confirm('Isso substitui todos os dados atuais pelos do arquivo. Continuar?')) {
            state = parsed;
            if (!state.lastResetDate) state.lastResetDate = todayStr();
            state.lists.forEach(function (l) {
              delete l.role; delete l.rev; delete l.base; delete l.members; delete l.ownerName;
              if (session) enrollList(l);
            });
            ensureReminderDefaults();
            ensureWordStatsDefaults();
            ensureTrashDefaults();
            save();
            closeModal();
            showHome();
            syncPushSubscription();
          }
        } catch (e) {
          alert('Arquivo inválido.');
        }
      };
      reader.readAsText(file);
    });
  });

  function exportData() {
    var json = JSON.stringify(state, null, 2);
    var blob = new Blob([json], { type: 'application/json' });
    var file = new File([blob], 'checklist-diario-backup.json', { type: 'application/json' });

    if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file], title: 'Backup do Checklist Diário' }).catch(function () {});
      return;
    }

    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'checklist-diario-backup.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
  }

  // ---------- progresso sincronizado entre aparelhos (opcional) ----------
  // Só contagens e marcas vão pra conta; nenhum texto de tarefa, anotação ou revisão.

  var progressStatus = '';
  var progressTimer = null;
  var progressBusy = false;

  function progressSnapshot() {
    var reviews = {};
    Object.keys(game.reviews).forEach(function (k) {
      if (game.reviews[k] && game.reviews[k].seen) reviews[k] = { seen: true, at: game.reviews[k].at || k };
    });
    return { days: game.days, doneLists: game.doneLists, badges: game.badges, total: game.total, listsDone: game.listsDone, reviews: reviews };
  }

  function mergeProgressLocal(r) { return P.mergeProgressInto(game, r); }

  function setProgressStatus(text) {
    progressStatus = text;
    var el = document.getElementById('m-progress-status');
    if (el) el.textContent = text;
  }

  function scheduleProgressSync() {
    if (!game.syncProgress || !session) return;
    clearTimeout(progressTimer);
    progressTimer = setTimeout(syncProgress, 8000);
  }

  function syncProgress() {
    if (!game.syncProgress || !session || progressBusy) return Promise.resolve();
    progressBusy = true;
    return apiFetch('GET', '/progress').then(function (res) {
      if (res.status === 404 || res.status === 501) { setProgressStatus('O servidor ainda não tem essa função. Seu progresso segue só neste aparelho.'); return; }
      if (!res.ok) { setProgressStatus('Não deu pra sincronizar agora. Tento de novo depois.'); return; }
      var changed = mergeProgressLocal(res.data && res.data.data);
      if (changed) { try { localStorage.setItem(GAME_KEY, JSON.stringify(game)); } catch (e) {} }
      return apiFetch('PUT', '/progress', progressSnapshot()).then(function (put) {
        if (!put.ok) { setProgressStatus('Não deu pra sincronizar agora. Tento de novo depois.'); return; }
        setProgressStatus('Sincronizado.');
        if (changed) { if (currentListId) renderDetail(); else renderHome(); }
      });
    }).catch(function () { setProgressStatus('Sem conexão. Tento de novo depois.'); })
      .then(function () { progressBusy = false; });
  }

  // ---------- contas e sync por lista ----------

  function saveSession(s) {
    session = s;
    try {
      if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
      else localStorage.removeItem(SESSION_KEY);
    } catch (e) {}
  }

  function apiFetch(method, path, body) {
    var headers = { 'Content-Type': 'application/json' };
    if (session) headers.Authorization = 'Bearer ' + session.token;
    return fetch(PUSH_SERVER_URL + path, {
      method: method,
      headers: headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    }).then(function (resp) {
      return resp.json().catch(function () { return null; }).then(function (data) {
        if (resp.status === 401 && session && path.indexOf('/auth/') !== 0) sessionExpired();
        return { ok: resp.ok, status: resp.status, data: data };
      });
    });
  }

  function errorText(res, fallback) {
    return (res && res.data && res.data.error) || fallback;
  }

  function clone(v) { return JSON.parse(JSON.stringify(v)); }

  // JSON com chaves ordenadas: compara dados sem depender da ordem das chaves.
  function canon(v) {
    if (v === null || typeof v !== 'object') return JSON.stringify(v);
    if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
    return '{' + Object.keys(v).sort().filter(function (k) { return v[k] !== undefined; }).map(function (k) {
      return JSON.stringify(k) + ':' + canon(v[k]);
    }).join(',') + '}';
  }

  // O que vai pro servidor de cada lista (o resto, como role/rev, é só local).
  // reminder fica de fora: é por pessoa/aparelho, nunca sincroniza.
  function listData(list) {
    return {
      name: list.name, emoji: list.emoji, type: list.type, days: list.days,
      sortOrder: list.sortOrder, items: list.items, lastResetDate: list.lastResetDate
    };
  }

  function isDirty(list) {
    return !list.base || canon(listData(list)) !== canon(list.base);
  }

  function isEditingText() {
    var el = document.activeElement;
    return !!(el && ((el.tagName === 'TEXTAREA' && !el.readOnly) || (el.tagName === 'INPUT' && el.classList.contains('step-input'))));
  }

  function rerender() {
    if (currentListId && getList(currentListId)) renderDetail(); else { currentListId = null; renderHome(); }
  }

  // Marca a lista pra subir pra conta como sua (dono).
  function enrollList(list) {
    if (!session || list.role) return;
    list.role = 'owner';
    list.rev = 0;
    list.base = null;
    list.ownerName = session.username;
    save();
  }

  function applyServerList(list, rec) {
    var d = rec.data;
    list.name = d.name;
    list.emoji = d.emoji;
    list.type = d.type;
    if (d.days && d.days.length) list.days = d.days; else delete list.days;
    // reminder não vem do servidor: é local por pessoa (ensureReminderDefaults cuida do padrão).
    list.sortOrder = d.sortOrder || 'manual';
    list.items = d.items;
    if (d.lastResetDate) list.lastResetDate = d.lastResetDate;
    list.rev = rec.rev;
    list.role = rec.role;
    list.ownerName = rec.ownerName || list.ownerName;
    if (rec.members) list.members = rec.members;
    list.base = clone(d);
  }

  function byId(items) {
    var map = {};
    items.forEach(function (i) { map[i.id] = i; });
    return map;
  }

  // Merge de 3 vias por id de item: base = última versão do servidor que este
  // aparelho viu, local = o que está aqui, server = o que está lá agora.
  function mergeItems(base, local, server) {
    var b = byId(base), l = byId(local), s = byId(server), out = [];
    server.forEach(function (sItem) {
      var lItem = l[sItem.id], bItem = b[sItem.id];
      if (lItem) out.push(bItem && canon(lItem) === canon(bItem) ? sItem : lItem);
      else if (!bItem) out.push(sItem); // adicionado por outra pessoa
      // senão: removido aqui, continua removido
    });
    local.forEach(function (lItem) {
      if (!s[lItem.id] && !b[lItem.id]) out.push(lItem); // adicionado aqui
    });
    return out;
  }

  // Aplica a versão do servidor por cima, preservando o que mudou localmente.
  function mergeConflict(list, rec) {
    var base = list.base || {};
    var local = listData(list);
    var d = rec.data;
    var merged = {};
    ['name', 'emoji', 'type', 'days', 'sortOrder', 'lastResetDate'].forEach(function (f) {
      var changedHere = list.base && canon(local[f]) !== canon(base[f]);
      merged[f] = changedHere ? local[f] : d[f];
    });
    merged.items = mergeItems(base.items || [], local.items, d.items);
    applyServerList(list, { data: merged, rev: rec.rev, role: rec.role, ownerName: rec.ownerName, members: rec.members });
    list.base = clone(d); // o que o servidor tem; a diferença vira o próximo envio
  }

  function pushList(list) {
    var sent = clone(listData(list));
    return apiFetch('PUT', '/lists/' + list.id, { data: sent, baseRev: list.rev || 0 }).then(function (res) {
      if (res.ok) {
        list.rev = res.data.rev;
        list.role = res.data.role || list.role;
        if (list.role === 'editor' && res.data.data) {
          // o servidor mantém o nome/ícone/etc. do dono
          var d = res.data.data;
          list.name = d.name; list.emoji = d.emoji; list.type = d.type;
          if (d.days && d.days.length) list.days = d.days; else delete list.days;
          list.sortOrder = d.sortOrder || list.sortOrder;
          list.base = clone(d);
        } else {
          list.base = sent;
        }
        return 'ok';
      }
      if (res.status === 409 && res.data && res.data.data) {
        if (isEditingText()) return 'fail';
        mergeConflict(list, res.data);
        return 'retry';
      }
      if (res.status === 404) {
        if (!list.rev) { // id já usado por outra lista: gera outro
          var oldId = list.id;
          list.id = uid();
          if (currentListId === oldId) currentListId = list.id;
          return 'retry';
        }
        state.lists = state.lists.filter(function (l) { return l.id !== list.id; }); // perdeu o acesso
        return 'gone';
      }
      if (res.status === 403) {
        return 'fail';
      }
      return 'fail';
    });
  }

  function pushWithRetry(list, attempt) {
    return pushList(list).then(function (r) {
      if (r === 'retry' && attempt < 3) return pushWithRetry(list, attempt + 1);
      return r;
    });
  }

  function pushDirtyLists() {
    var changedUI = false;
    var chain = Promise.resolve();
    state.lists.filter(function (l) {
      return l.role && l.role !== 'viewer' && isDirty(l);
    }).forEach(function (l) {
      chain = chain.then(function () { return pushWithRetry(l, 0); }).then(function (r) {
        if (r === 'gone' || r === 'retry') changedUI = true;
      });
    });
    return chain.then(function () { return changedUI; });
  }

  function membersChanged(a, b) { return canon(a || []) !== canon(b || []); }

  // Avisa o dono quando alguém novo entra na lista (aceitou convite).
  function notifyNewMembers(local, rec) {
    if (local.role !== 'owner') return;
    var before = {};
    (local.members || []).forEach(function (m) { before[m.userId] = true; });
    var novos = (rec.members || []).filter(function (m) { return !before[m.userId]; });
    novos.forEach(function (m) {
      alert(m.username + ' entrou na lista "' + local.name + '" como ' + (ROLE_LABELS[m.role] || m.role) + '.');
    });
  }

  function mergeServerLists(serverLists) {
    var changed = false, present = {};
    serverLists.forEach(function (rec) {
      present[rec.id] = true;
      var local = getList(rec.id);
      if (!local) {
        var fresh = { id: rec.id, reminder: { enabled: false, times: ['08:00'] } };
        applyServerList(fresh, rec);
        state.lists.push(fresh);
        changed = true;
        return;
      }
      if (!local.role) return; // cópia local que não é da conta
      if (local.role !== rec.role || local.ownerName !== rec.ownerName || membersChanged(local.members, rec.members)) {
        notifyNewMembers(local, rec);
        local.role = rec.role;
        local.ownerName = rec.ownerName;
        local.members = rec.members;
        changed = true;
      }
      if (rec.rev > (local.rev || 0)) {
        if (local.role !== 'viewer' && isDirty(local) && local.base) mergeConflict(local, rec);
        else applyServerList(local, rec);
        changed = true;
      }
    });
    var before = state.lists.length;
    state.lists = state.lists.filter(function (l) { return !(l.role && l.rev > 0 && !present[l.id]); });
    if (state.lists.length !== before) changed = true;
    return changed;
  }

  function pullLists() {
    return apiFetch('GET', '/lists').then(function (res) {
      if (!res.ok || !res.data || !res.data.lists) return false;
      if (isEditingText()) return false; // tenta de novo no próximo ciclo
      return mergeServerLists(res.data.lists);
    });
  }

  function doSync() {
    return pushDirtyLists().then(function (changedByPush) {
      return pullLists().then(function (changedByPull) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        if (changedByPush || changedByPull) {
          applyDailyReset();
          scheduleReminderSync();
          rerender();
        }
      });
    });
  }

  var syncPromise = null;
  var syncAgain = false;

  // Sobe o que mudou aqui e baixa o que mudou lá. Um ciclo por vez.
  function syncTick() {
    if (!session) return Promise.resolve();
    if (syncPromise) { syncAgain = true; return syncPromise; }
    syncPromise = doSync().catch(function () {}).then(function () {
      syncPromise = null;
      if (syncAgain) { syncAgain = false; return syncTick(); }
    });
    return syncPromise;
  }

  var accountSyncTimer = null;

  function scheduleAccountSync() {
    if (!session) return;
    clearTimeout(accountSyncTimer);
    accountSyncTimer = setTimeout(syncTick, 800);
  }

  // Ao sair (ou se a sessão vencer): listas de outras pessoas saem do aparelho;
  // as suas ficam aqui como cópia local.
  function detachAccount() {
    state.lists = state.lists.filter(function (l) { return !l.role || l.role === 'owner'; });
    state.lists.forEach(function (l) {
      delete l.role; delete l.rev; delete l.base; delete l.members; delete l.ownerName;
    });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function sessionExpired() {
    if (!session) return;
    detachAccount();
    saveSession(null);
    rerender();
    openAuthModal('Sua sessão expirou. Entre de novo.');
  }

  // ---------- legado: código de sincronização (só quem já usava, sem conta) ----------

  var cloudBackupTimer = null;

  function getSyncCode() {
    return localStorage.getItem(SYNC_CODE_KEY);
  }

  function scheduleCloudBackup() {
    if (session || !getSyncCode()) return;
    clearTimeout(cloudBackupTimer);
    cloudBackupTimer = setTimeout(uploadCloudBackup, 2000);
  }

  function getLastSyncedAt() {
    return Number(localStorage.getItem(LAST_SYNC_KEY) || 0);
  }

  function setLastSyncedAt(ts) {
    localStorage.setItem(LAST_SYNC_KEY, String(ts));
  }

  function uploadCloudBackup() {
    var code = getSyncCode();
    if (!code || session) return Promise.resolve();
    return fetch(PUSH_SERVER_URL + '/data/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: code, data: state })
    }).then(function (resp) {
      if (!resp.ok) return;
      return resp.json();
    }).then(function (result) {
      if (result && result.updatedAt) setLastSyncedAt(result.updatedAt);
    }).catch(function () {});
  }

  function checkCloudForUpdates() {
    var code = getSyncCode();
    if (!code || session) return Promise.resolve();
    return fetch(PUSH_SERVER_URL + '/data/load', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: code })
    }).then(function (resp) {
      if (!resp.ok) return null;
      return resp.json();
    }).then(function (record) {
      if (!record || !record.updatedAt) return;
      if (record.updatedAt <= getLastSyncedAt()) return;

      state = record.data;
      ensureReminderDefaults();
      ensureWordStatsDefaults();
      ensureTrashDefaults();
      if (!state.lastResetDate) state.lastResetDate = todayStr();
      applyDailyReset();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); // não usa save() pra não reenviar pra nuvem
      setLastSyncedAt(record.updatedAt);

      rerender();
    }).catch(function () {});
  }

  var cloudPollTimer = null;

  function cloudTick() {
    return session ? syncTick() : checkCloudForUpdates();
  }

  function startCloudPolling() {
    stopCloudPolling();
    cloudPollTimer = setInterval(cloudTick, CLOUD_POLL_INTERVAL_MS);
  }

  function stopCloudPolling() {
    clearInterval(cloudPollTimer);
    cloudPollTimer = null;
  }

  // ---------- login / cadastro ----------

  function openAuthModal(message) {
    openModal(
      '<h2>Conta</h2>' +
      (message ? '<p class="hint" style="margin:0;color:var(--text);">' + escapeHtml(message) + '</p>' : '') +
      '<p class="hint" style="margin:0;">Com uma conta você usa suas listas em vários aparelhos e compartilha com outras pessoas. ' +
        'Não existe recuperação de senha: anote a sua.</p>' +
      '<label>Usuário<input id="m-user" type="text" autocapitalize="none" autocorrect="off" spellcheck="false" maxlength="24" placeholder="3 a 24 letras, números, _ . -"></label>' +
      '<label>Senha<input id="m-pass" type="password" autocomplete="current-password" placeholder="mínimo 6 caracteres"></label>' +
      '<p id="m-auth-error" class="error-msg"></p>' +
      (GOOGLE_CLIENT_ID ? '<div id="m-google" style="display:flex;justify-content:center;min-height:44px;"></div>' : '') +
      '<button id="m-login" class="btn btn-primary">Entrar</button>' +
      '<button id="m-register" class="btn btn-secondary">Criar conta</button>' +
      '<button id="m-skip" class="btn btn-secondary">Agora não (usar só neste aparelho)</button>'
    );

    var errorEl = document.getElementById('m-auth-error');
    var buttons = [document.getElementById('m-login'), document.getElementById('m-register')];

    function submit(kind) {
      var username = document.getElementById('m-user').value.trim();
      var password = document.getElementById('m-pass').value;
      if (!username || !password) { errorEl.textContent = 'Preencha usuário e senha.'; return; }
      errorEl.textContent = '';
      buttons.forEach(function (b) { b.disabled = true; });
      apiFetch('POST', '/auth/' + kind, { username: username, password: password }).then(function (res) {
        if (!res.ok) {
          errorEl.textContent = errorText(res, 'Não deu certo. Tente de novo.');
          buttons.forEach(function (b) { b.disabled = false; });
          return;
        }
        afterLogin(res.data);
      }).catch(function () {
        errorEl.textContent = 'Sem conexão com o servidor.';
        buttons.forEach(function (b) { b.disabled = false; });
      });
    }

    document.getElementById('m-login').addEventListener('click', function () { submit('login'); });
    document.getElementById('m-register').addEventListener('click', function () { submit('register'); });
    document.getElementById('m-pass').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); submit('login'); }
    });
    document.getElementById('m-skip').addEventListener('click', function () {
      try { localStorage.setItem(SKIP_LOGIN_KEY, '1'); } catch (e) {}
      closeModal();
    });
    document.getElementById('m-user').focus();
    if (GOOGLE_CLIENT_ID) setupGoogleButton(errorEl);
  }

  function setupGoogleButton(errorEl) {
    function render() {
      var box = document.getElementById('m-google');
      if (!box || !window.google || !google.accounts) return;
      google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: function (resp) {
          errorEl.textContent = '';
          apiFetch('POST', '/auth/google', { credential: resp.credential }).then(function (res) {
            if (!res.ok) { errorEl.textContent = errorText(res, 'Não deu certo com o Google.'); return; }
            afterLogin(res.data);
          }).catch(function () { errorEl.textContent = 'Sem conexão com o servidor.'; });
        }
      });
      google.accounts.id.renderButton(box, { theme: 'outline', size: 'large', text: 'continue_with', locale: 'pt-BR' });
    }
    if (window.google && google.accounts) { render(); return; }
    var s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = render;
    document.head.appendChild(s);
  }

  // Vincula uma conta Google à conta já logada (usuário+senha), em vez de logar/criar outra.
  function setupGoogleLinkButton(msgEl) {
    var btn = document.getElementById('m-google-link');
    if (!btn) return;
    var boxId = 'm-google-link-box';
    if (!document.getElementById(boxId)) {
      var box = document.createElement('div');
      box.id = boxId;
      box.style.display = 'flex';
      box.style.justifyContent = 'center';
      box.style.minHeight = '44px';
      btn.parentNode.insertBefore(box, btn.nextSibling);
    }
    btn.disabled = true;

    function render() {
      var box = document.getElementById(boxId);
      if (!box || !window.google || !google.accounts) return;
      google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: function (resp) {
          apiFetch('POST', '/auth/google/link', { credential: resp.credential }).then(function (res) {
            if (!res.ok) { if (msgEl) msgEl.textContent = errorText(res, 'Não deu certo vincular o Google.'); return; }
            if (msgEl) msgEl.textContent = res.data.alreadyLinked ? 'Essa conta Google já estava vinculada.' : 'Google vinculado com sucesso.';
            box.innerHTML = '';
          }).catch(function () { if (msgEl) msgEl.textContent = 'Sem conexão com o servidor.'; });
        }
      });
      google.accounts.id.renderButton(box, { theme: 'outline', size: 'large', text: 'continue_with', locale: 'pt-BR' });
    }
    if (window.google && google.accounts) { render(); return; }
    var s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = render;
    document.head.appendChild(s);
  }

  function afterLogin(data) {
    var user = data.user || {};
    saveSession({ token: data.token, username: user.username, userId: user.id });
    try { localStorage.removeItem(SKIP_LOGIN_KEY); } catch (e) {}
    closeModal();

    var local = state.lists.filter(function (l) { return !l.role; });
    if (local.length && confirm(
      'Enviar as ' + local.length + ' lista(s) deste aparelho pra conta "' + session.username + '"?\n\n' +
      'Se você já usa a conta em outro aparelho e este só tem as listas de exemplo, toque em Cancelar.'
    )) {
      local.forEach(enrollList);
    }

    syncTick().then(function () {
      consumePendingInvite();
      rerender();
    });
  }

  function acceptInvite(code) {
    return apiFetch('POST', '/invites/accept', { code: code }).then(function (res) {
      if (!res.ok) { alert(errorText(res, 'Convite inválido ou expirado.')); return; }
      return syncTick().then(function () {
        alert('Você entrou na lista como ' + ROLE_LABELS[res.data.role] + '.');
        showHome();
      });
    }).catch(function () { alert('Sem conexão com o servidor.'); });
  }

  function consumePendingInvite() {
    var code = null;
    try { code = localStorage.getItem(PENDING_INVITE_KEY); } catch (e) {}
    if (!code || !session) return;
    try { localStorage.removeItem(PENDING_INVITE_KEY); } catch (e) {}
    acceptInvite(code);
  }

  function promptInviteCode() {
    if (!session) {
      alert('Entre numa conta pra usar um convite.');
      openAuthModal();
      return;
    }
    var code = prompt('Digite o código do convite (ou cole o link):');
    if (!code) return;
    var m = /convite=([A-Za-z0-9]+)/.exec(code);
    acceptInvite((m ? m[1] : code).trim().toUpperCase());
  }

  function bootAccountFlow() {
    try {
      var code = new URLSearchParams(location.search).get('convite');
      if (code) {
        localStorage.setItem(PENDING_INVITE_KEY, code.trim().toUpperCase());
        history.replaceState(null, '', location.pathname);
      }
    } catch (e) {}
    var pending = null;
    try { pending = localStorage.getItem(PENDING_INVITE_KEY); } catch (e) {}
    if (session) { consumePendingInvite(); return; }
    if (pending) { openAuthModal('Entre ou crie uma conta pra aceitar o convite.'); return; }
    var skipped = null;
    try { skipped = localStorage.getItem(SKIP_LOGIN_KEY); } catch (e) {}
    if (!skipped) openAuthModal();
  }

  var joinBtn = document.getElementById('btn-join');
  if (joinBtn) joinBtn.addEventListener('click', promptInviteCode);

  function refreshCloudUI() {
    var box = document.getElementById('m-cloud-box');
    if (!box) return;

    if (session) {
      var unsent = state.lists.filter(function (l) { return !l.role; }).length;
      box.innerHTML =
        '<div class="settings-row"><span>Conta: <strong id="m-account-username">' + escapeHtml(session.username) + '</strong></span>' +
          '<button id="m-logout" class="btn btn-secondary" style="flex:none;">Sair</button></div>' +
        '<p class="hint" style="margin:0;">Suas listas sincronizam sozinhas entre os aparelhos em que você entrou (a cada ~5s com o app aberto).</p>' +
        '<div class="settings-row"><span>Guardar meu progresso na conta</span><button id="m-progress-toggle" class="switch" role="switch" aria-label="Guardar meu progresso na conta" aria-checked="' + (game.syncProgress ? 'true' : 'false') + '"><span></span></button></div>' +
        '<p class="hint" style="margin:0;">Só números e conquistas (nunca o texto das suas tarefas) — assim o progresso é o mesmo em todos os aparelhos. <span id="m-progress-status">' + escapeHtml(game.syncProgress ? progressStatus : '') + '</span></p>' +
        (unsent ? '<button id="m-send-local" class="btn btn-secondary">Enviar as ' + unsent + ' lista(s) só deste aparelho pra conta</button>' : '') +
        '<button id="m-join" class="btn btn-secondary">Entrar numa lista com convite</button>' +
        '<button id="m-rename-user" class="btn btn-secondary">Trocar nome de usuário</button>' +
        (GOOGLE_CLIENT_ID ? '<button id="m-google-link" class="btn btn-secondary">Vincular login com Google</button>' : '') +
        '<p id="m-account-msg" class="hint" style="margin:0;"></p>' +
        '<button id="m-delete-account" class="btn btn-danger">Excluir minha conta</button>';
      document.getElementById('m-logout').addEventListener('click', function () {
        if (!confirm('Sair da conta? As listas de outras pessoas saem deste aparelho; as suas ficam aqui como cópia.')) return;
        syncTick().then(function () {
          return apiFetch('POST', '/auth/logout').catch(function () {});
        }).then(function () {
          detachAccount();
          saveSession(null);
          closeModal();
          showHome();
        });
      });
      document.getElementById('m-progress-toggle').addEventListener('click', function () {
        game.syncProgress = !game.syncProgress;
        saveGame();
        this.setAttribute('aria-checked', game.syncProgress ? 'true' : 'false');
        if (game.syncProgress) { setProgressStatus('Sincronizando…'); syncProgress(); } else setProgressStatus('');
      });
      var sendBtn = document.getElementById('m-send-local');
      if (sendBtn) {
        sendBtn.addEventListener('click', function () {
          state.lists.filter(function (l) { return !l.role; }).forEach(enrollList);
          syncTick();
          refreshCloudUI();
        });
      }
      document.getElementById('m-join').addEventListener('click', function () { closeModal(); promptInviteCode(); });

      var msgEl = document.getElementById('m-account-msg');
      document.getElementById('m-rename-user').addEventListener('click', function () {
        var novo = prompt('Novo nome de usuário (3 a 24 letras, números, _ . -):', session.username);
        if (!novo || !novo.trim() || novo.trim() === session.username) return;
        apiFetch('PATCH', '/auth/me', { username: novo.trim() }).then(function (res) {
          if (!res.ok) { msgEl.textContent = errorText(res, 'Não deu certo trocar o nome.'); return; }
          saveSession({ token: session.token, username: res.data.user.username, userId: session.userId });
          refreshCloudUI();
        }).catch(function () { msgEl.textContent = 'Sem conexão com o servidor.'; });
      });

      if (GOOGLE_CLIENT_ID) {
        document.getElementById('m-google-link').addEventListener('click', function () {
          setupGoogleLinkButton(msgEl);
        });
      }

      document.getElementById('m-delete-account').addEventListener('click', function () {
        if (!confirm('Excluir sua conta de verdade? Isso apaga seu login e as listas que você é dono (elas somem pra quem mais usa também). Suas listas ficam aqui como cópia local. Não tem como desfazer.')) return;
        if (!confirm('Tem certeza mesmo? Essa é a última confirmação.')) return;
        apiFetch('DELETE', '/auth/me').then(function (res) {
          if (!res.ok) { msgEl.textContent = errorText(res, 'Não deu certo excluir a conta.'); return; }
          detachAccount();
          saveSession(null);
          closeModal();
          showHome();
        }).catch(function () { msgEl.textContent = 'Sem conexão com o servidor.'; });
      });
      return;
    }

    var code = getSyncCode();
    box.innerHTML =
      '<button id="m-login-open" class="btn btn-secondary">Entrar / criar conta</button>' +
      '<button id="m-join" class="btn btn-secondary">Entrar numa lista com convite</button>' +
      (code
        ? '<p class="hint" style="margin:0;">Sincronização antiga (sem conta) — código:</p>' +
          '<input id="m-cloud-code" type="text" class="code-box" value="' + code + '" readonly>' +
          '<button id="m-cloud-backup-now" class="btn btn-secondary">Fazer backup agora</button>'
        : '');
    document.getElementById('m-login-open').addEventListener('click', function () { openAuthModal(); });
    document.getElementById('m-join').addEventListener('click', function () { closeModal(); promptInviteCode(); });
    var backupBtn = document.getElementById('m-cloud-backup-now');
    if (backupBtn) {
      backupBtn.addEventListener('click', function () {
        uploadCloudBackup().then(function () { alert('Backup enviado.'); });
      });
    }
  }

  // ---------- compartilhar lista com pessoas ----------

  function inviteLink(code) {
    return location.origin + location.pathname + '?convite=' + code;
  }

  function shareInvite(code, role, listName) {
    var text = 'Convite pra lista "' + listName + '" (' + ROLE_LABELS[role] + ') no Checklist Diário:\n' + inviteLink(code) + '\nCódigo: ' + code;
    if (navigator.share) {
      navigator.share({ text: text }).catch(function () {});
    } else if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { alert('Convite copiado.'); }).catch(function () { prompt('Copie o convite:', text); });
    } else {
      prompt('Copie o convite:', text);
    }
  }

  function openMembersModal(list) {
    var owner = list.role === 'owner';
    if (owner && !list.rev) {
      openModal('<h2>👥 ' + escapeHtml(list.name) + '</h2><p class="hint" style="margin:0;">Enviando a lista pra conta…</p>');
      syncTick().then(function () {
        if (list.rev) openMembersModal(list);
        else { closeModal(); alert('Não foi possível enviar a lista agora. Verifique a conexão.'); }
      });
      return;
    }

    var members = list.members || [];
    var html = '<h2>👥 ' + escapeHtml(list.name) + '</h2>' +
      '<p class="hint" style="margin:0;">Dono: <strong>' + escapeHtml(list.ownerName || '?') + '</strong></p>';
    if (!members.length) html += '<p class="hint" style="margin:0;">Ninguém além do dono.</p>';
    members.forEach(function (m) {
      html += owner
        ? '<div class="settings-row"><span>' + escapeHtml(m.username) + '</span><span style="display:flex;gap:6px;">' +
            '<select class="m-role" data-user="' + m.userId + '">' +
              '<option value="editor"' + (m.role === 'editor' ? ' selected' : '') + '>Editor</option>' +
              '<option value="viewer"' + (m.role === 'viewer' ? ' selected' : '') + '>Leitor</option></select>' +
            '<button class="btn btn-danger small-btn m-kick" data-user="' + m.userId + '">Remover</button></span></div>'
        : '<div class="settings-row"><span>' + escapeHtml(m.username) + '</span><span class="hint" style="margin:0;">' + ROLE_LABELS[m.role] + '</span></div>';
    });
    if (owner) {
      html +=
        '<h2 style="font-size:16px;margin:8px 0 0;">Convidar</h2>' +
        '<p class="hint" style="margin:0;">Gere um convite e mande pra pessoa. Vale 7 dias e até 10 usos.</p>' +
        '<div class="settings-row"><select id="m-invite-role"><option value="editor">Editor (mexe nos itens)</option><option value="viewer">Leitor (só vê)</option></select>' +
          '<button id="m-invite-create" class="btn btn-primary small-btn">Gerar convite</button></div>' +
        '<div id="m-invites" style="display:flex;flex-direction:column;gap:8px;"></div>';
    }
    html += '<button id="m-cancel" class="btn btn-secondary">Fechar</button>';
    openModal(html);
    on('m-cancel', closeModal);
    if (!owner) return;

    function refreshInvites() {
      apiFetch('GET', '/lists/' + list.id + '/invites').then(function (res) {
        var box = document.getElementById('m-invites');
        if (!box || !res.ok) return;
        box.innerHTML = res.data.invites.map(function (inv) {
          var days = Math.max(1, Math.ceil((inv.expiresAt - Date.now()) / 86400000));
          return '<div class="settings-row"><span><strong>' + inv.code + '</strong> · ' + ROLE_LABELS[inv.role] +
            '<br><span class="hint" style="margin:0;">expira em ' + days + ' dia(s) · ' + inv.usesLeft + ' uso(s)</span></span>' +
            '<span style="display:flex;gap:6px;">' +
              '<button class="btn btn-secondary small-btn m-inv-share" data-code="' + inv.code + '" data-role="' + inv.role + '">Enviar</button>' +
              '<button class="btn btn-danger small-btn m-inv-revoke" data-code="' + inv.code + '">Revogar</button></span></div>';
        }).join('');
        box.querySelectorAll('.m-inv-share').forEach(function (b) {
          b.addEventListener('click', function () { shareInvite(b.dataset.code, b.dataset.role, list.name); });
        });
        box.querySelectorAll('.m-inv-revoke').forEach(function (b) {
          b.addEventListener('click', function () {
            apiFetch('DELETE', '/lists/' + list.id + '/invites/' + b.dataset.code).then(refreshInvites);
          });
        });
      }).catch(function () {});
    }
    refreshInvites();

    on('m-invite-create', function () {
      var role = document.getElementById('m-invite-role').value;
      apiFetch('POST', '/lists/' + list.id + '/invites', { role: role }).then(function (res) {
        if (!res.ok) { alert(errorText(res, 'Não foi possível gerar o convite.')); return; }
        refreshInvites();
        shareInvite(res.data.code, role, list.name);
      }).catch(function () { alert('Sem conexão com o servidor.'); });
    });

    modal.querySelectorAll('.m-role').forEach(function (sel) {
      sel.addEventListener('change', function () {
        apiFetch('PATCH', '/lists/' + list.id + '/members/' + sel.dataset.user, { role: sel.value }).then(function (res) {
          if (!res.ok) { alert(errorText(res, 'Não foi possível mudar o papel.')); return; }
          list.members.forEach(function (m) { if (m.userId === sel.dataset.user) m.role = sel.value; });
          save();
        }).catch(function () { alert('Sem conexão com o servidor.'); });
      });
    });
    modal.querySelectorAll('.m-kick').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (!confirm('Remover essa pessoa da lista?')) return;
        apiFetch('DELETE', '/lists/' + list.id + '/members/' + btn.dataset.user).then(function (res) {
          if (!res.ok) { alert(errorText(res, 'Não foi possível remover.')); return; }
          list.members = list.members.filter(function (m) { return m.userId !== btn.dataset.user; });
          save();
          openMembersModal(list);
        }).catch(function () { alert('Sem conexão com o servidor.'); });
      });
    });
  }

  // ---------- notificações push (lembretes de verdade) ----------

  function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  }

  if (isStandalone()) document.documentElement.classList.add('standalone');

  function pushSupported() {
    return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  }

  function urlBase64ToUint8Array(base64String) {
    var padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    var base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    var rawData = atob(base64);
    var outputArray = new Uint8Array(rawData.length);
    for (var i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i);
    return outputArray;
  }

  // ---------- lembrete a partir do texto ("ligar pro dentista amanhã 10h") ----------

  // ---------- lembrete por tarefa ----------

  function taskKey(list, item) { return list.id + ':' + item.id; }

  function getTaskReminder(list, item) {
    var r = game.taskReminders[taskKey(list, item)];
    return r && r.date >= todayStr() ? r : null;
  }

  function remindWhen(r) {
    return r.date === todayStr() ? 'hoje ' + r.time : r.date.slice(8) + '/' + r.date.slice(5, 7) + ' ' + r.time;
  }

  function setTaskReminder(list, item, date, time) {
    game.taskReminders[taskKey(list, item)] = { date: date, time: time };
    saveGame();
    scheduleReminderSync();
  }

  function clearTaskReminder(list, item) {
    delete game.taskReminders[taskKey(list, item)];
    saveGame();
    scheduleReminderSync();
  }

  // Só vai pro servidor o que ainda vale: tarefa existente, pendente e com data de hoje em diante.
  function buildTaskReminders() {
    var out = [], today = todayStr(), changed = false;
    Object.keys(game.taskReminders).forEach(function (key) {
      var r = game.taskReminders[key];
      var i = key.indexOf(':');
      var list = getList(key.slice(0, i));
      var item = list && list.items.filter(function (x) { return x.id === key.slice(i + 1); })[0];
      if (!r || r.date < today || (list && !item)) { delete game.taskReminders[key]; changed = true; return; }
      if (!list || item.done) return;
      out.push({ listId: list.id, itemId: item.id, listName: list.name, emoji: list.emoji, text: item.text, date: r.date, time: r.time });
    });
    if (changed) saveGame();
    return out;
  }

  function isMutedToday() { return game.muteDate === todayStr(); }

  var pushFeatures = null; // o que o servidor diz que sabe fazer (null = ainda não sei)

  function buildRemindersPayload() {
    var out = [];
    state.lists
      .filter(function (l) { return l.reminder && l.reminder.enabled && l.reminder.times.length; })
      .forEach(function (l) {
        // fora dos dias da rotina não há o que lembrar (o Worker também filtra por "days")
        var hasPending = scheduledToday(l) && activeItems(l).some(function (i) { return !i.done; });
        l.reminder.times.forEach(function (t) {
          out.push({ listId: l.id, listName: l.name, emoji: l.emoji, time: t, enabled: true, hasPending: hasPending, days: l.days || [] });
        });
      });
    return out;
  }

  function syncPushSubscription() {
    if (!pushSupported()) return Promise.resolve();
    return navigator.serviceWorker.ready.then(function (reg) {
      return reg.pushManager.getSubscription();
    }).then(function (sub) {
      if (!sub) return; // notificações ainda não foram ativadas neste aparelho
      return fetch(PUSH_SERVER_URL + '/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subscription: sub.toJSON(),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          reminders: buildRemindersPayload(),
          taskReminders: buildTaskReminders(),
          muteDate: isMutedToday() ? todayStr() : null
        })
      }).then(function (resp) {
        // servidor novo responde JSON com "features"; o antigo responde só "ok"
        return resp.json().catch(function () { return null; });
      }).then(function (data) {
        pushFeatures = (data && Array.isArray(data.features)) ? data.features : [];
      }).catch(function () {});
    }).catch(function () {});
  }

  function enablePushNotifications() {
    if (!isStandalone()) {
      alert('Antes de ativar, adicione este app à Tela de Início (Safari → Compartilhar → Adicionar à Tela de Início) e abra por lá.');
      return Promise.resolve();
    }
    return Notification.requestPermission().then(function (permission) {
      if (permission !== 'granted') {
        alert('Permissão de notificação negada. Não vai dar pra receber os lembretes.');
        return;
      }
      return navigator.serviceWorker.ready.then(function (reg) {
        return reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
        });
      }).then(function () {
        return syncPushSubscription();
      });
    });
  }

  function disablePushNotifications() {
    return navigator.serviceWorker.ready.then(function (reg) {
      return reg.pushManager.getSubscription();
    }).then(function (sub) {
      if (!sub) return;
      var endpoint = sub.endpoint;
      return sub.unsubscribe().then(function () {
        return fetch(PUSH_SERVER_URL + '/unsubscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: endpoint })
        }).catch(function () {});
      });
    });
  }

  function togglePushNotifications() {
    if (!pushSupported()) return;
    navigator.serviceWorker.ready.then(function (reg) {
      reg.pushManager.getSubscription().then(function (sub) {
        var action = sub ? disablePushNotifications() : enablePushNotifications();
        action.then(refreshPushUI);
      });
    });
  }

  function refreshPushUI() {
    var btn = document.getElementById('m-push-toggle');
    var status = document.getElementById('m-push-status');
    if (!btn || !status) return;

    if (!pushSupported()) {
      btn.textContent = 'Indisponível';
      btn.disabled = true;
      status.textContent = 'Este navegador não suporta notificações push.';
      return;
    }
    if (!isStandalone()) {
      btn.textContent = 'Ativar';
      status.textContent = 'Adicione o app à Tela de Início e abra por lá antes de ativar.';
      return;
    }
    navigator.serviceWorker.ready.then(function (reg) {
      return reg.pushManager.getSubscription();
    }).then(function (sub) {
      if (sub) {
        btn.textContent = 'Desativar';
        status.textContent = 'Notificações ativadas. Configure o horário em cada lista (⋯).';
      } else {
        btn.textContent = 'Ativar';
        status.textContent = 'Desativadas. Depois de ativar, configure o horário em cada lista (⋯).';
      }
    });
  }

  // ---------- bloqueio do app (Face ID / Touch ID / senha do aparelho) ----------

  var APP_LOCK_KEY = 'checklist-diario:appLock';

  function getAppLock() {
    try { return JSON.parse(localStorage.getItem(APP_LOCK_KEY) || 'null'); } catch (e) { return null; }
  }

  function isAppLockEnabled() {
    var lock = getAppLock();
    return !!(lock && lock.enabled);
  }

  function bufToBase64url(buf) {
    var bytes = new Uint8Array(buf), bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function base64urlToBuf(str) {
    var b64 = str.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(str.length / 4) * 4, '=');
    var bin = atob(b64);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes.buffer;
  }

  function webAuthnSupported() {
    return !!(window.PublicKeyCredential && navigator.credentials);
  }

  function enableAppLock() {
    if (!webAuthnSupported()) {
      alert('Este navegador/aparelho não suporta bloqueio por Face ID/Touch ID/senha.');
      return Promise.resolve(false);
    }
    return navigator.credentials.create({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        rp: { name: 'Checklist Diário' },
        user: { id: crypto.getRandomValues(new Uint8Array(16)), name: 'checklist', displayName: 'Checklist Diário' },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
        // No iOS, Face ID via WebAuthn sempre aparece como "passkey salva" do sistema
        // (Chaveiro do iCloud), mesmo com residentKey: 'discouraged' — nao tem contorno
        // possivel a partir de um PWA (so um app nativo, via LocalAuthentication, evita
        // essa tela). E o preco de ter Face ID sem virar app nativo.
        authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required' },
        timeout: 60000
      }
    }).then(function (cred) {
      localStorage.setItem(APP_LOCK_KEY, JSON.stringify({ enabled: true, credentialId: bufToBase64url(cred.rawId) }));
      return true;
    }).catch(function (err) {
      alert('Não foi possível ativar o bloqueio: ' + err.message);
      return false;
    });
  }

  function disableAppLock() {
    localStorage.removeItem(APP_LOCK_KEY);
  }

  function verifyAppLock() {
    var lock = getAppLock();
    if (!lock || !lock.enabled) return Promise.resolve(true);
    return navigator.credentials.get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        allowCredentials: [{ id: base64urlToBuf(lock.credentialId), type: 'public-key' }],
        userVerification: 'required',
        timeout: 60000
      }
    }).then(function () { return true; }).catch(function () { return false; });
  }

  function showLockScreen() {
    document.getElementById('lock-screen').classList.remove('hidden');
  }

  function hideLockScreen() {
    document.getElementById('lock-screen').classList.add('hidden');
  }

  function tryUnlock() {
    verifyAppLock().then(function (ok) { if (ok) hideLockScreen(); });
  }

  document.getElementById('btn-unlock').addEventListener('click', tryUnlock);

  // ---------- reset diário ao voltar pro app ----------

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') {
      if (isAppLockEnabled()) { showLockScreen(); tryUnlock(); }
      applyDailyReset();
      purgeOldTrash();
      if (currentListId) renderDetail(); else renderHome();
      cloudTick();
      startCloudPolling();
    } else {
      if (isAppLockEnabled()) showLockScreen();
      stopCloudPolling();
    }
  });

  // ---------- service worker (offline + autoatualização) ----------

  var swRegistration = null;

  if ('serviceWorker' in navigator) {
    var refreshingAfterUpdate = false;
    // Quando uma versão nova assume o controle da página, recarrega sozinho
    // (sem isso, era preciso fechar e reabrir o app duas vezes pra ver uma
    // atualização, já que ele guarda uma cópia offline de tudo).
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (refreshingAfterUpdate) return;
      refreshingAfterUpdate = true;
      window.location.reload();
    });

    window.addEventListener('load', function () {
      navigator.serviceWorker.register('service-worker.js').then(function (reg) {
        swRegistration = reg;
      }).catch(function () {});
    });

    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible' && swRegistration) {
        swRegistration.update().catch(function () {});
      }
    });
  }

  // ---------- boot ----------

  load();
  showHome();
  maybeGreet();
  cloudTick();
  startCloudPolling();
  if (session) syncProgress();
  (function () {
    var invite = false;
    try {
      invite = !!new URLSearchParams(location.search).get('convite') || !!localStorage.getItem(PENDING_INVITE_KEY);
    } catch (e) {}
    if (isNewInstall && !game.onboarded && !invite) {
      startOnboarding(bootAccountFlow);
    } else {
      if (isNewInstall) { game.onboarded = true; saveGame(); }
      bootAccountFlow();
    }
  })();
  if (isAppLockEnabled()) { showLockScreen(); tryUnlock(); }
})();
