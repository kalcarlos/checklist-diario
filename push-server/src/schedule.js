// Decide, sem fazer nenhuma chamada de rede, quais lembretes estao no horario.
// Puro (recebe o registro e a data/hora local da pessoa) para poder ser testado.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

function minutes(hm) {
  const [h, m] = hm.split(':').map(Number);
  return h * 60 + m;
}

// Valida e limpa os lembretes por tarefa que chegam do app.
export function sanitizeTaskReminders(list) {
  if (!Array.isArray(list)) return [];
  const s = (v, n) => String(v == null ? '' : v).slice(0, n);
  return list.slice(0, 100).filter((t) => t && DATE_RE.test(t.date || '') && TIME_RE.test(t.time || '') && t.listId && t.itemId)
    .map((t) => ({
      listId: s(t.listId, 64), itemId: s(t.itemId, 64), listName: s(t.listName, 60), emoji: s(t.emoji, 8),
      text: s(t.text, 120), date: t.date, time: t.time,
    }));
}

export const taskKey = (t) => `${t.listId}:${t.itemId}:${t.date}:${t.time}`;

// Ao regravar o registro (o app reenvia tudo a cada alteracao) preserva o que ja foi enviado,
// senao um lembrete atrasado dispararia de novo.
export function carrySent(oldRecord, next) {
  if (!oldRecord) return next;
  const sent = new Set((oldRecord.taskReminders || []).filter((t) => t.sent).map(taskKey));
  next.taskReminders = (next.taskReminders || []).map((t) => (sent.has(taskKey(t)) ? { ...t, sent: true } : t));
  const lastByList = new Map();
  (oldRecord.reminders || []).forEach((r) => { if (r.lastSentDate) lastByList.set(`${r.listId}:${r.time}`, r.lastSentDate); });
  next.reminders = (next.reminders || []).map((r) => {
    const last = lastByList.get(`${r.listId}:${r.time}`);
    return last && !r.lastSentDate ? { ...r, lastSentDate: last } : r;
  });
  return next;
}

// Devolve { due: [{ payload, mark }], changed }.
//  - due: notificacoes a enviar agora; chame mark() depois de enviar com sucesso
//  - changed: o registro foi alterado aqui (descartes/marcas) e precisa ser regravado
// Tolerancia de 2 minutos para lembretes por tarefa (um cron perdido nao some com o aviso).
export function planReminders(record, now) {
  const { date, hm, weekday } = now;
  const out = { due: [], changed: false };
  if (record.muteDate === date) return out; // "silenciar hoje"

  for (const reminder of record.reminders || []) {
    if (!reminder.enabled) continue;
    if (reminder.time !== hm) continue;
    if (reminder.lastSentDate === date) continue;
    if (Array.isArray(reminder.days) && reminder.days.length && !reminder.days.includes(weekday)) {
      reminder.lastSentDate = date; out.changed = true; continue;
    }
    if (reminder.hasPending === false) { reminder.lastSentDate = date; out.changed = true; continue; }
    out.due.push({
      payload: {
        title: `${reminder.emoji || '✅'} ${reminder.listName}`,
        body: 'Hora de checar essa lista.',
        tag: 'checklist-' + reminder.listId,
        listId: reminder.listId,
      },
      mark: () => { reminder.lastSentDate = date; },
    });
  }

  if (Array.isArray(record.taskReminders)) {
    const before = record.taskReminders.length;
    record.taskReminders = record.taskReminders.filter((t) => t.date >= date); // descarta os de dias passados
    if (record.taskReminders.length !== before) out.changed = true;
    for (const t of record.taskReminders) {
      if (t.sent || t.date !== date) continue;
      const late = minutes(hm) - minutes(t.time);
      if (late < 0 || late > 2) continue;
      out.due.push({
        payload: {
          title: `${t.emoji || '🔔'} ${t.text || 'Tarefa'}`,
          body: t.listName ? `Da lista ${t.listName}.` : 'Hora de fazer essa tarefa.',
          tag: 'checklist-task-' + t.itemId,
          listId: t.listId,
        },
        mark: () => { t.sent = true; },
      });
    }
  }
  return out;
}
