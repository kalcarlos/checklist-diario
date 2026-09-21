(function () {
  'use strict';

  var STORAGE_KEY = 'checklist-diario:v1';
  var SYNC_CODE_KEY = 'checklist-diario:syncCode';
  var LAST_SYNC_KEY = 'checklist-diario:lastSyncedAt';
  var CLOUD_POLL_INTERVAL_MS = 20000;
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
  var PUSH_SERVER_URL = 'https://checklist-diario-push.kalcarlos.workers.dev';
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
      reminder: { enabled: false, time: '08:00' }, items: []
    };
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
      if (!list.reminder) list.reminder = { enabled: false, time: '08:00' };
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
      state.lists.push(entry.list);
    } else {
      var list = getList(entry.listId);
      if (!list) {
        alert('A lista "' + entry.listName + '" desse item não existe mais. Restaure a lista primeiro, se ela também estiver na lixeira.');
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
  }

  function applyDailyReset() {
    var today = todayStr();
    if (state.lastResetDate === today) return;
    state.lists.forEach(function (list) {
      if (list.type === 'rotina') {
        list.items.forEach(function (item) { item.done = false; });
      }
    });
    state.lastResetDate = today;
    save();
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
            (list.type === 'rotina' ? ' · diária' : '') + '</div>' +
          '<div class="progress-bar"><div style="width:' + pct + '%"></div></div>' +
        '</div>' +
        '<button class="edit-btn" aria-label="Renomear">✏️</button>' +
        '<button class="drag-handle" aria-label="Arrastar para reordenar">' + DRAG_ICON + '</button>' +
        '<button class="delete" aria-label="Excluir lista">🗑️</button>';

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

      card.querySelector('.edit-btn').addEventListener('click', function (e) {
        e.stopPropagation();
        nameEl.readOnly = false;
        nameEl.focus();
        nameEl.setSelectionRange(nameEl.value.length, nameEl.value.length);
      });

      setupDragReorder(container, card, card.querySelector('.drag-handle'), state.lists, list, function () {
        save();
        renderHome();
      });

      card.querySelector('.delete').addEventListener('click', function (e) {
        e.stopPropagation();
        moveListToTrash(list);
        renderHome();
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
    document.getElementById('detail-hint').textContent = list.type === 'rotina'
      ? 'Lista diária: os itens desmarcam sozinhos todo dia à meia-noite.'
      : 'Lista simples: marque os itens e use "Limpar concluídos" quando quiser.';

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
        '<button class="edit-btn" aria-label="Editar texto">✏️</button>' +
        (itemFilter === 'all' ? '<button class="drag-handle" aria-label="Arrastar para reordenar">' + DRAG_ICON + '</button>' : '') +
        '<button class="delete" aria-label="Excluir">🗑️</button>';

      var textEl = row.querySelector('.text');
      textEl.value = item.text;

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

      if (itemFilter === 'all') {
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

  document.getElementById('btn-list-menu').addEventListener('click', function () {
    var list = getList(currentListId);
    if (!list) return;

    openModal(
      '<h2>' + list.emoji + ' ' + escapeHtml(list.name) + '</h2>' +
      '<label class="settings-row"><span>Lembrete diário</span>' +
        '<input id="m-reminder-enabled" type="checkbox"' + (list.reminder.enabled ? ' checked' : '') + '></label>' +
      '<label class="settings-row"><span>Horário</span>' +
        '<input id="m-reminder-time" type="time" value="' + list.reminder.time + '"></label>' +
      '<p class="hint" style="margin:0;">Pra receber esse aviso mesmo com o app fechado, ative "Notificações" em Ajustes.</p>' +
      '<button id="m-rename" class="btn btn-secondary">Renomear</button>' +
      '<button id="m-check-all" class="btn btn-secondary">Marcar todos</button>' +
      '<button id="m-uncheck-all" class="btn btn-secondary">Desmarcar todos</button>' +
      '<button id="m-clear" class="btn btn-secondary">Limpar concluídos</button>' +
      '<button id="m-delete" class="btn btn-danger">Excluir lista</button>' +
      '<button id="m-cancel" class="btn btn-secondary">Fechar</button>'
    );

    function saveReminder() {
      list.reminder.enabled = document.getElementById('m-reminder-enabled').checked;
      list.reminder.time = document.getElementById('m-reminder-time').value || '08:00';
      save();
      syncPushSubscription();
    }
    document.getElementById('m-reminder-enabled').addEventListener('change', saveReminder);
    document.getElementById('m-reminder-time').addEventListener('change', saveReminder);

    document.getElementById('m-cancel').addEventListener('click', closeModal);

    document.getElementById('m-rename').addEventListener('click', function () {
      var novo = prompt('Novo nome da lista:', list.name);
      if (novo && novo.trim()) {
        list.name = novo.trim();
        save();
        closeModal();
        renderDetail();
      }
    });

    document.getElementById('m-check-all').addEventListener('click', function () {
      list.items.forEach(function (i) { i.done = true; });
      save();
      closeModal();
      renderDetail();
    });

    document.getElementById('m-uncheck-all').addEventListener('click', function () {
      list.items.forEach(function (i) { i.done = false; });
      save();
      closeModal();
      renderDetail();
    });

    document.getElementById('m-clear').addEventListener('click', function () {
      list.items.filter(function (i) { return i.done; }).forEach(function (i) {
        moveItemToTrash(list, i);
      });
      closeModal();
      renderDetail();
    });

    document.getElementById('m-delete').addEventListener('click', function () {
      if (confirm('Excluir a lista "' + list.name + '"? Fica na lixeira por 7 dias, dá pra restaurar.')) {
        moveListToTrash(list);
        closeModal();
        showHome();
      }
    });
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

  // ---------- ajustes (exportar / importar) ----------

  document.getElementById('btn-settings').addEventListener('click', function () {
    openModal(
      '<h2>Ajustes</h2>' +
      '<div class="settings-row"><span>Notificações</span><button id="m-push-toggle" class="btn btn-secondary" style="flex:none;">…</button></div>' +
      '<p id="m-push-status" class="hint" style="margin:0;"></p>' +
      '<div id="m-cloud-box" style="display:flex;flex-direction:column;gap:8px;"></div>' +
      '<p class="hint" style="margin:0;">O backup na nuvem é gratuito e automático depois de criado, mas não é criptografado com senha — não guarde nada sensível nas listas.</p>' +
      '<div class="settings-row"><span>Exportar backup (.json)</span><button id="m-export" class="btn btn-secondary" style="flex:none;">Exportar</button></div>' +
      '<div class="settings-row"><span>Importar backup (.json)</span><button id="m-import" class="btn btn-secondary" style="flex:none;">Importar</button></div>' +
      '<input id="m-import-file" type="file" accept="application/json" class="hidden" style="display:none;">' +
      '<div class="settings-row"><span>Verificar atualização do app</span><button id="m-check-update" class="btn btn-secondary" style="flex:none;">Verificar</button></div>' +
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

  // ---------- backup na nuvem (não perder os dados) ----------

  var cloudBackupTimer = null;

  function getSyncCode() {
    return localStorage.getItem(SYNC_CODE_KEY);
  }

  function setSyncCode(code) {
    localStorage.setItem(SYNC_CODE_KEY, code);
  }

  function generateSyncCode() {
    var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sem letras/números parecidos (0/O, 1/I/L)
    var bytes = new Uint8Array(10);
    crypto.getRandomValues(bytes);
    var code = '';
    for (var i = 0; i < bytes.length; i++) code += chars[bytes[i] % chars.length];
    return code;
  }

  function scheduleCloudBackup() {
    if (!getSyncCode()) return; // só faz backup automático depois que o usuário criar um código
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
    if (!code) return Promise.resolve();
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

  function downloadCloudBackup(code) {
    return fetch(PUSH_SERVER_URL + '/data/load', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: code })
    }).then(function (resp) {
      if (!resp.ok) throw new Error(resp.status === 404 ? 'codigo nao encontrado' : 'erro no servidor');
      return resp.json();
    });
  }

  // Puxa a nuvem sem esperar o usuário mandar: se outro aparelho salvou algo
  // mais novo, atualiza os dados locais sozinho (checagem por horário, sem
  // tempo real de verdade, mas automático o bastante pra não precisar
  // restaurar manualmente).
  function checkCloudForUpdates() {
    var code = getSyncCode();
    if (!code) return Promise.resolve();
    return fetch(PUSH_SERVER_URL + '/data/load', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: code })
    }).then(function (resp) {
      if (!resp.ok) return null;
      return resp.json();
    }).then(function (record) {
      if (!record || !record.updatedAt) return;
      if (record.updatedAt <= getLastSyncedAt()) return; // nada mais novo que o nosso

      state = record.data;
      ensureReminderDefaults();
      ensureWordStatsDefaults();
      ensureTrashDefaults();
      if (!state.lastResetDate) state.lastResetDate = todayStr();
      applyDailyReset();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); // não usa save() pra não reenviar pra nuvem
      setLastSyncedAt(record.updatedAt);

      if (currentListId) renderDetail(); else renderHome();
    }).catch(function () {});
  }

  var cloudPollTimer = null;

  function startCloudPolling() {
    stopCloudPolling();
    if (!getSyncCode()) return;
    cloudPollTimer = setInterval(checkCloudForUpdates, CLOUD_POLL_INTERVAL_MS);
  }

  function stopCloudPolling() {
    clearInterval(cloudPollTimer);
    cloudPollTimer = null;
  }

  function refreshCloudUI() {
    var box = document.getElementById('m-cloud-box');
    if (!box) return;
    var code = getSyncCode();
    if (code) {
      box.innerHTML =
        '<p class="hint" style="margin:0;">Seu código de sincronização (anote e use nos outros aparelhos):</p>' +
        '<input id="m-cloud-code" type="text" value="' + code + '" readonly ' +
          'style="font-size:20px;letter-spacing:2px;text-align:center;font-weight:700;">' +
        '<p class="hint" style="margin:0;">Sincroniza sozinho a cada ~20s enquanto o app estiver aberto nos aparelhos.</p>' +
        '<button id="m-cloud-backup-now" class="btn btn-secondary">Fazer backup agora</button>';
      document.getElementById('m-cloud-backup-now').addEventListener('click', function () {
        uploadCloudBackup().then(function () { alert('Backup enviado.'); });
      });
    } else {
      box.innerHTML =
        '<button id="m-cloud-create" class="btn btn-secondary">Criar backup na nuvem</button>' +
        '<button id="m-cloud-restore" class="btn btn-secondary">Restaurar de um código</button>';
      document.getElementById('m-cloud-create').addEventListener('click', function () {
        setSyncCode(generateSyncCode());
        uploadCloudBackup();
        startCloudPolling();
        refreshCloudUI();
      });
      document.getElementById('m-cloud-restore').addEventListener('click', function () {
        var code = prompt('Digite o código de sincronização do outro aparelho:');
        if (!code) return;
        code = code.trim().toUpperCase();
        downloadCloudBackup(code).then(function (record) {
          if (!confirm('Isso substitui todos os dados atuais pelos da nuvem. Continuar?')) return;
          state = record.data;
          ensureReminderDefaults();
          ensureWordStatsDefaults();
          ensureTrashDefaults();
          if (!state.lastResetDate) state.lastResetDate = todayStr();
          applyDailyReset();
          localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
          setSyncCode(code);
          setLastSyncedAt(record.updatedAt || Date.now());
          startCloudPolling();
          closeModal();
          showHome();
        }).catch(function (err) {
          alert('Não foi possível restaurar: ' + err.message);
        });
      });
    }
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
    return state.lists
      .filter(function (l) { return l.reminder && l.reminder.enabled; })
      .map(function (l) {
        return { listId: l.id, listName: l.name, emoji: l.emoji, time: l.reminder.time, enabled: true };
      });
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

  // ---------- reset diário ao voltar pro app ----------

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') {
      applyDailyReset();
      purgeOldTrash();
      if (currentListId) renderDetail(); else renderHome();
      checkCloudForUpdates();
      startCloudPolling();
    } else {
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
  checkCloudForUpdates();
  startCloudPolling();
})();
