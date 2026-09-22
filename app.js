(function () {
  'use strict';

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
  var EMOJI_CHOICES = [
    '🏠', '🛒', '💊', '📞', '🧺', '🐶', '🐱', '💼', '🧹', '🚗', '💰', '🏋️',
    '📚', '🍽️', '🧴', '🪴', '👶', '🎂', '🎁', '✈️', '🏥', '🦷', '👓', '💇',
    '💅', '🧾', '📦', '🔧', '🔌', '🧑‍💻', '📅', '🐾', '🍎', '🧽', '🛠️', '🎓',
    '⚽', '🎮', '🎵', '🌱', '🧻', '📮', '🏦', '⛪', '🚲', '🧵', '🐦', '🧯'
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

  function load() {
    var raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
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
    state.trash.push({ id: uid(), type: 'list', deletedAt: Date.now(), list: list });
    save();
  }

  function moveItemToTrash(list, item) {
    list.items = list.items.filter(function (i) { return i.id !== item.id; });
    state.trash.push({
      id: uid(), type: 'item', deletedAt: Date.now(),
      listId: list.id, listName: list.name, listEmoji: list.emoji, item: item
    });
    save();
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
      list.items.forEach(function (item) { item.done = false; });
      list.lastResetDate = today;
      changed = true;
    });
    state.lastResetDate = today;
    if (changed) save();
    else localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  // ---------- navegação ----------

  var screenHome = document.getElementById('screen-home');
  var screenDetail = document.getElementById('screen-detail');

  function showHome() {
    currentListId = null;
    screenDetail.classList.add('hidden');
    screenHome.classList.remove('hidden');
    renderHome();
  }

  function showDetail(listId) {
    currentListId = listId;
    itemFilter = 'all';
    screenHome.classList.add('hidden');
    screenDetail.classList.remove('hidden');
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
    moveListToTrash(list);
    done();
  }

  function renderHome() {
    var container = document.getElementById('lists-container');
    container.innerHTML = '';

    if (state.lists.length === 0) {
      var empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = 'Nenhuma lista ainda. Toque no + para criar sua primeira checklist.';
      container.appendChild(empty);
      return;
    }

    state.lists.forEach(function (list) {
      var total = list.items.length;
      var done = list.items.filter(function (i) { return i.done; }).length;
      var pct = total === 0 ? 0 : Math.round((done / total) * 100);

      var card = document.createElement('div');
      card.className = 'list-card';
      card.innerHTML =
        '<div class="emoji">' + list.emoji + '</div>' +
        '<div class="info">' +
          '<textarea class="name" rows="1" readonly></textarea>' +
          '<div class="meta">' + (total === 0 ? 'Sem itens' : (done + ' de ' + total + ' feitos')) +
            (list.type === 'rotina' ? ' · diária' : '') + roleMeta(list) + '</div>' +
          '<div class="progress-bar"><div style="width:' + pct + '%"></div></div>' +
        '</div>' +
        (canEditMeta(list) ? '<button class="edit-btn" aria-label="Renomear">✏️</button>' : '') +
        '<button class="drag-handle" aria-label="Arrastar para reordenar">' + DRAG_ICON + '</button>' +
        '<button class="delete" aria-label="' + (canEditMeta(list) ? 'Excluir lista' : 'Sair da lista') + '">' +
          (canEditMeta(list) ? '🗑️' : '🚪') + '</button>';

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
      ? 'Lista diária: os itens desmarcam sozinhos todo dia à meia-noite.'
      : 'Lista simples: marque os itens e use "Limpar concluídos" quando quiser.';
    if (list.role === 'viewer') hint = 'Você só pode ver esta lista (dono: ' + (list.ownerName || '?') + ').';
    else if (list.role === 'editor') hint = 'Você é editor: pode mexer nos itens. Dono: ' + (list.ownerName || '?') + '.';
    document.getElementById('detail-hint').textContent = hint;
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
      li.textContent = 'Nenhum item ainda. Adicione abaixo.';
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
      liEmpty.textContent = itemFilter === 'done' ? 'Nenhum item marcado.' : 'Nenhum item pendente.';
      container.appendChild(liEmpty);
      return;
    }

    visibleItems.forEach(function (item) {
      var row = document.createElement('li');
      row.className = 'item-row' + (item.done ? ' done' : '');
      row.innerHTML =
        '<div class="check">' + (item.done ? '✓' : '') + '</div>' +
        '<textarea class="text" rows="1" readonly></textarea>' +
        (editable ? '<button class="edit-btn" aria-label="Editar texto">✏️</button>' : '') +
        (canReorder ? '<button class="drag-handle" aria-label="Arrastar para reordenar">' + DRAG_ICON + '</button>' : '') +
        (editable ? '<button class="delete" aria-label="Excluir">🗑️</button>' : '');

      var textEl = row.querySelector('.text');
      textEl.value = item.text;

      if (!editable) {
        container.appendChild(row);
        autoGrow(textEl);
        return;
      }

      row.querySelector('.check').addEventListener('click', function () {
        item.done = !item.done;
        save();
        renderDetail();
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

      row.querySelector('.edit-btn').addEventListener('click', function () {
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
        moveItemToTrash(list, item);
        renderDetail();
      });

      container.appendChild(row);
      autoGrow(textEl);
    });
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
    list.items.push({ id: uid(), text: text, done: false });
    learnFromText(text, list.id);
    input.value = '';
    autoGrow(input);
    hideAddSuggestion();
    save();
    renderDetail();
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

  function closeModal() {
    backdrop.classList.add('hidden');
    modal.innerHTML = '';
  }

  backdrop.addEventListener('click', function (e) {
    if (e.target === backdrop) closeModal();
  });

  // ---------- nova lista ----------

  document.getElementById('btn-new-list').addEventListener('click', function () {
    var chosenEmoji = EMOJI_CHOICES[0];
    var chosenType = 'lista';

    openModal(
      '<h2>Nova lista</h2>' +
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

    document.getElementById('m-cancel').addEventListener('click', closeModal);
    document.getElementById('m-create').addEventListener('click', function () {
      var name = document.getElementById('m-name').value.trim();
      if (!name) return;
      state.lists.push(createList(name, chosenEmoji, chosenType));
      save();
      closeModal();
      renderHome();
    });

    document.getElementById('m-name').focus();
  });

  // ---------- menu da lista (⋯) ----------

  function buildShareText(list) {
    var lines = list.items.map(function (i) { return (i.done ? '✅ ' : '⬜ ') + i.text; });
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
      '<label class="settings-row"><span>Lembrete diário</span>' +
        '<input id="m-reminder-enabled" type="checkbox"' + (list.reminder.enabled ? ' checked' : '') + '></label>' +
      '<div id="m-reminder-times"></div>' +
      '<button id="m-add-time" class="btn btn-secondary" style="padding:8px;">+ Adicionar horário</button>' +
      '<p class="hint" style="margin:0;">Pra receber esse aviso mesmo com o app fechado, ative "Notificações" em Ajustes. Não avisa se a lista já estiver toda feita. Esse lembrete é só seu; cada pessoa na lista escolhe o próprio horário.</p>';
    if (isMeta) {
      html +=
        '<div class="settings-row"><span>Ícone</span><button id="m-change-icon" class="btn btn-secondary" style="flex:none;">' + list.emoji + ' Trocar</button></div>' +
        '<div class="settings-row"><span>Tipo</span><button id="m-change-type" class="btn btn-secondary" style="flex:none;">' +
          (list.type === 'rotina' ? 'Rotina diária' : 'Lista simples') + '</button></div>' +
        '<div class="settings-row"><span>Ordenar por</span><button id="m-sort-order" class="btn btn-secondary" style="flex:none;">' +
          SORT_LABELS[list.sortOrder] + '</button></div>' +
        '<button id="m-rename" class="btn btn-secondary">Renomear</button>';
    }
    if (list.role) {
      html += '<button id="m-members" class="btn btn-secondary">' +
        (list.role === 'owner' ? '👥 Compartilhar com pessoas' : '👥 Ver membros') + '</button>';
    } else if (isMeta) {
      html += '<button id="m-members-local" class="btn btn-secondary">👥 Compartilhar com pessoas</button>';
    }
    html += '<button id="m-share" class="btn btn-secondary">Copiar como texto</button>';
    if (isItems) {
      html +=
        '<button id="m-check-all" class="btn btn-secondary">Marcar todos</button>' +
        '<button id="m-uncheck-all" class="btn btn-secondary">Desmarcar todos</button>' +
        '<button id="m-clear" class="btn btn-secondary">Limpar concluídos</button>';
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
            ? '<button class="btn btn-secondary m-time-remove" data-idx="' + idx + '" style="flex:none;padding:8px 10px;">Remover</button>'
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

    on('m-check-all', function () {
      list.items.forEach(function (i) { i.done = true; });
      save();
      closeModal();
      renderDetail();
    });

    on('m-uncheck-all', function () {
      list.items.forEach(function (i) { i.done = false; });
      save();
      closeModal();
      renderDetail();
    });

    on('m-clear', function () {
      list.items.filter(function (i) { return i.done; }).forEach(function (i) {
        moveItemToTrash(list, i);
      });
      closeModal();
      renderDetail();
    });

    on('m-delete', function () {
      if (!list.role && !confirm('Excluir a lista "' + list.name + '"? Fica na lixeira por 7 dias, dá pra restaurar.')) return;
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
        if (normalizeAccents(item.text.toLowerCase()).indexOf(q) !== -1) {
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
      '<div class="settings-row"><span>Notificações</span><button id="m-push-toggle" class="btn btn-secondary" style="flex:none;">…</button></div>' +
      '<p id="m-push-status" class="hint" style="margin:0;"></p>' +
      '<div id="m-cloud-box" style="display:flex;flex-direction:column;gap:8px;"></div>' +
      '<p class="hint" style="margin:0;">As listas da conta ficam no servidor (não são criptografadas de ponta a ponta) — não guarde nada muito sensível nelas.</p>' +
      '<div class="settings-row"><span>Exportar backup (.json)</span><button id="m-export" class="btn btn-secondary" style="flex:none;">Exportar</button></div>' +
      '<div class="settings-row"><span>Importar backup (.json)</span><button id="m-import" class="btn btn-secondary" style="flex:none;">Importar</button></div>' +
      '<input id="m-import-file" type="file" accept="application/json" class="hidden" style="display:none;">' +
      '<div class="settings-row"><span>Verificar atualização do app</span><button id="m-check-update" class="btn btn-secondary" style="flex:none;">Verificar</button></div>' +
      '<div class="settings-row"><span>Sugestão de categoria</span><button id="m-reset-learning" class="btn btn-secondary" style="flex:none;">Resetar aprendizado</button></div>' +
      '<div class="settings-row"><span>Bloqueio do app (Face ID/Touch ID)</span><button id="m-app-lock" class="btn btn-secondary" style="flex:none;">' +
        (isAppLockEnabled() ? 'Desativar' : 'Ativar') + '</button></div>' +
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
      name: list.name, emoji: list.emoji, type: list.type,
      sortOrder: list.sortOrder, items: list.items, lastResetDate: list.lastResetDate
    };
  }

  function isDirty(list) {
    return !list.base || canon(listData(list)) !== canon(list.base);
  }

  function isEditingText() {
    var el = document.activeElement;
    return !!(el && el.tagName === 'TEXTAREA' && !el.readOnly);
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
    ['name', 'emoji', 'type', 'sortOrder', 'lastResetDate'].forEach(function (f) {
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

  function buildRemindersPayload() {
    var out = [];
    state.lists
      .filter(function (l) { return l.reminder && l.reminder.enabled && l.reminder.times.length; })
      .forEach(function (l) {
        var hasPending = l.items.some(function (i) { return !i.done; });
        l.reminder.times.forEach(function (t) {
          out.push({ listId: l.id, listName: l.name, emoji: l.emoji, time: t, enabled: true, hasPending: hasPending });
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
          reminders: buildRemindersPayload()
        })
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
  cloudTick();
  startCloudPolling();
  bootAccountFlow();
  if (isAppLockEnabled()) { showLockScreen(); tryUnlock(); }
})();
