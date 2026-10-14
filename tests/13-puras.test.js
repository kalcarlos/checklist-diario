// Testes unitários (Node, sem navegador) das funções puras de pure.js.
const P = require('../pure.js');

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ok  ', n); } else { fail++; console.log('  FAIL', n, x === undefined ? '' : JSON.stringify(x)); } };

console.log('1. parseWhen (quarta, 14/10/2026, 09:00)');
const NOW = new Date(2026, 9, 14, 9, 0, 0);
const w = (t, now) => { const r = P.parseWhen(t, now || NOW); return r ? r.date + ' ' + r.time : null; };
const cases = [
  ['ligar amanhã 10h', '2026-10-15 10:00'], ['Ligar AMANHÃ 10H', '2026-10-15 10:00'], ['reunião hoje 15:30', '2026-10-14 15:30'],
  ['remédio 21h', '2026-10-14 21:00'], ['acordar 7h', '2026-10-15 07:00'], ['sexta 14h', '2026-10-16 14:00'],
  ['sexta-feira 14h', '2026-10-16 14:00'], ['quarta às 14h30', '2026-10-21 14:30'], ['domingo 8h', '2026-10-18 08:00'],
  ['depois de amanhã 9h', '2026-10-16 09:00'], ['jantar hoje 9h da noite', '2026-10-14 21:00'], ['café às 11', '2026-10-14 11:00'],
  ['almoço 12h da tarde', '2026-10-14 12:00'], ['(amanhã 8h)', '2026-10-15 08:00'], ['terça 10:05.', '2026-10-20 10:05'],
  ['comprar 3 pães', null], ['pagar dia 10/10', null], ['hoje 8h', null], ['hoje 9h', null], ['amanhã', null], ['senha 25h', null],
  ['10h30m', null], ['', null], ['às 24', null], ['reunião 12:60', null],
];
cases.forEach(([t, want]) => ok(JSON.stringify(t) + ' → ' + want, w(t) === want, w(t)));
ok('virada de mês: 31/10 + amanhã', w('amanhã 8h', new Date(2026, 9, 31, 9, 0)) === '2026-11-01 08:00');
ok('virada de ano: 31/12 + amanhã', w('amanhã 8h', new Date(2026, 11, 31, 9, 0)) === '2027-01-01 08:00');
ok('sem dia e hora já passou: amanhã', w('academia 6h') === '2026-10-15 06:00');

console.log('2. findLinks');
const L = (t) => P.findLinks(t).map((x) => x.type + ':' + x.href);
ok('site com www', L('veja www.exemplo.com.br/x?y=1.').join() === 'url:https://www.exemplo.com.br/x?y=1');
ok('http completo e rótulo é só o host', P.findLinks('https://a.com/b/c')[0].label === 'a.com');
ok('e-mail', L('mande para ana@site.com.br hoje').join() === 'mail:mailto:ana@site.com.br');
ok('telefone com DDD', L('ligar (11) 91234-5678').join() === 'tel:tel:11912345678');
ok('telefone +55', L('+55 11 91234-5678').join() === 'tel:tel:+5511912345678');
ok('8 dígitos com hífen', L('fixo 3456-7890').join() === 'tel:tel:34567890');
ok('número solto, CPF e data não viram link', L('pedido 123456 cpf 123.456.789-00 em 10/10/2026').length === 0, L('pedido 123456 cpf 123.456.789-00 em 10/10/2026'));
ok('sem repetir o mesmo link', L('a.com https://a.com https://a.com').length === 1 || L('https://a.com https://a.com').length === 1);
ok('texto vazio ou nulo', P.findLinks('').length === 0 && P.findLinks(null).length === 0);

console.log('3. mergeProgressInto');
const mk = (o) => Object.assign({ days: {}, doneLists: {}, badges: {}, total: 0, listsDone: 0, reviews: {} }, o);
const A = () => mk({ days: { '2026-10-10': 3, '2026-10-11': 1 }, badges: { first: '2026-10-10' }, total: 10, listsDone: 2, reviews: { '2026-10-04': { helped: 'x', next: 'y', at: '2026-10-05', seen: true } } });
const B = { days: { '2026-10-10': 5, '2026-10-12': 2 }, doneLists: { '2026-10-12': 1 }, badges: { first: '2026-10-01', streak7: '2026-10-09' }, total: 25, listsDone: 1, reviews: { '2026-10-04': { seen: true, at: '2026-10-04' }, '2026-09-27': { seen: true, at: '2026-09-28' } } };
let g = A(); const changed = P.mergeProgressInto(g, B);
ok('maior contagem por dia', g.days['2026-10-10'] === 5 && g.days['2026-10-11'] === 1 && g.days['2026-10-12'] === 2, g.days);
ok('conquista mais antiga e novas conquistas', g.badges.first === '2026-10-01' && g.badges.streak7 === '2026-10-09', g.badges);
ok('totais pelo maior', g.total === 25 && g.listsDone === 2);
ok('revisão local (com texto) é preservada; nova vem só como "vista"', g.reviews['2026-10-04'].helped === 'x' && g.reviews['2026-09-27'].seen === true && g.reviews['2026-09-27'].helped === '', g.reviews);
ok('avisa que mudou', changed === true);
const snap = JSON.stringify(g);
ok('idempotente: repetir não muda nada e retorna false', P.mergeProgressInto(g, B) === false && JSON.stringify(g) === snap);
const g2 = mk(B); P.mergeProgressInto(g2, A());
const stable = (o) => JSON.stringify(o, (k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort()) : v));
ok('comutativo nos números (A+B == B+A)', stable([g.days, g.badges, g.total, g.listsDone]) === stable([g2.days, g2.badges, g2.total, g2.listsDone]), [g2.days, g2.badges]);
ok('entrada inválida não quebra', P.mergeProgressInto(A(), null) === false && P.mergeProgressInto(A(), 'x') === false);

console.log('4. dayKey e plain');
ok('dayKey com zero à esquerda', P.dayKey(new Date(2026, 0, 5)) === '2026-01-05');
ok('plain tira acentos e baixa caixa', P.plain('AMANHÃ às Ç') === 'amanha as c');

console.log('5. rhythm');
const T = new Date(2026, 9, 14);
const key = (n) => P.dayKey(new Date(2026, 9, 14 - n));
let r = P.rhythm({}, T);
ok('sem dados: tudo zerado, sem melhor dia', r.active30 === 0 && r.total30 === 0 && r.avgPerActive === 0 && r.bestDow === null && r.returns === 0);
r = P.rhythm(null, T);
ok('entrada nula não quebra', r.active30 === 0);
const d = {}; [1, 2, 3, 4, 5].forEach((n) => { d[key(n)] = 2; });
r = P.rhythm(d, T);
ok('5 dias seguidos: 5 ativos, 10 itens, média 2', r.active30 === 5 && r.total30 === 10 && r.avgPerActive === 2, r);
ok('sem pausa: nenhuma retomada', r.returns === 0);
// terças (dia 2) rendem mais: 14/10/2026 é quarta; terças = 13, 6, 29/9, 22/9, 15/9
const e = {}; [1, 8, 15, 22, 29].forEach((n) => { e[key(n)] = 6; }); [2, 3, 9].forEach((n) => { e[key(n)] = 1; });
r = P.rhythm(e, T);
ok('melhor dia da semana é terça (2)', r.bestDow === 2, r);
ok('poucos dias ativos (<5): sem "melhor dia"', P.rhythm({ [key(1)]: 9, [key(2)]: 1 }, T).bestDow === null);
const f = { [key(20)]: 1, [key(19)]: 1, [key(10)]: 2, [key(2)]: 1 };
r = P.rhythm(f, T);
ok('retomadas: voltou após pausa de 3+ dias (2x)', r.returns === 2, r);
ok('pausa de 2 dias não conta como retomada', P.rhythm({ [key(5)]: 1, [key(2)]: 1 }, T).returns === 0);
ok('atividade antiga (>30 dias) não entra nos 30 dias', P.rhythm({ [key(40)]: 5 }, T).active30 === 0);
ok('média com decimal', P.rhythm({ [key(1)]: 1, [key(2)]: 2 }, T).avgPerActive === 1.5);

console.log('6. streak (sequência com perdão)');
const K = (n) => P.dayKey(new Date(2026, 9, 14 - n));
const mkd = (ns) => Object.fromEntries(ns.map((n) => [K(n), 1]));
ok('sem dados: 0', P.streak({}, T, 120) === 0);
ok('hoje + 2 dias seguidos: 3', P.streak(mkd([0, 1, 2]), T, 120) === 3);
ok('hoje ainda sem marcar não quebra (conta de ontem)', P.streak(mkd([1, 2, 3]), T, 120) === 3);
ok('um dia perdido é perdoado', P.streak(mkd([0, 1, 3, 4]), T, 120) === 4);
ok('dois perdidos em menos de 7 dias quebram', P.streak(mkd([0, 1, 4, 5]), T, 120) === 2);
ok('perdão volta depois de 7 dias', P.streak(mkd([0, 2, 3, 4, 5, 6, 7, 8, 10]), T, 120) === 9, P.streak(mkd([0, 2, 3, 4, 5, 6, 7, 8, 10]), T, 120));
ok('respeita o limite de dias guardados', P.streak(mkd([0, 1, 2, 3, 4, 5]), T, 2) <= 3);

console.log('7. reviewWeekDays / weekTotals');
let wk = P.reviewWeekDays({ [K(1)]: 4, [K(2)]: 2 }, { [K(1)]: 1 }, T); // quarta
ok('quarta: semana em andamento começa na segunda (12/10)', wk.key === '2026-10-12' && wk.days.length === 7 && wk.days[0].dow === 1 && wk.days[6].dow === 0, wk.key);
ok('marca "hoje" e dias futuros', wk.days[2].today === true && wk.days[3].future === true && wk.days[1].future === false);
ok('contagens por dia', wk.days[1].count === 4 && wk.days[1].lists === 1 && wk.days[0].count === 2, wk.days.map((d) => d.count));
const MON = new Date(2026, 9, 12);
wk = P.reviewWeekDays({}, {}, MON);
ok('segunda: mostra a semana anterior inteira (05/10)', wk.key === '2026-10-05' && wk.days.every((d) => !d.future));
const SUN = new Date(2026, 9, 18);
ok('domingo: semana em andamento termina hoje', P.reviewWeekDays({}, {}, SUN).days[6].today === true);
const wt = P.weekTotals(P.reviewWeekDays({ [K(1)]: 4, [K(2)]: 2 }, { [K(1)]: 1 }, T), { first: '2026-10-13', old: '2026-09-01' }, [{ id: 'first' }, { id: 'old' }, { id: 'none' }]);
ok('totais, dias ativos e melhor dia', wt.total === 6 && wt.lists === 1 && wt.active === 2 && wt.best.count === 4, wt);
ok('só conquistas da semana', wt.badges.length === 1 && wt.badges[0].id === 'first');
ok('semana vazia', P.weekTotals(P.reviewWeekDays({}, {}, T), {}, []).best === null);

console.log('8. rotina, adiar e cooperativo');
const NAMES = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
ok('lista simples ignora dias', P.isScheduledOn({ type: 'lista', days: [1] }, 3) === true);
ok('rotina sem dias: todo dia', P.isScheduledOn({ type: 'rotina' }, 3) === true && P.isScheduledOn({ type: 'rotina', days: [] }, 3) === true);
ok('rotina só em seg/qua', P.isScheduledOn({ type: 'rotina', days: [1, 3] }, 3) === true && P.isScheduledOn({ type: 'rotina', days: [1, 3] }, 2) === false);
ok('rótulos de dias', P.daysLabelOf([], NAMES) === 'Todos os dias' && P.daysLabelOf([0, 1, 2, 3, 4, 5, 6], NAMES) === 'Todos os dias' && P.daysLabelOf([5, 4, 3, 2, 1], NAMES) === 'Dias úteis' && P.daysLabelOf([6, 0], NAMES) === 'Fim de semana' && P.daysLabelOf([3, 1], NAMES) === 'seg, qua');
ok('adiado até data futura', P.isSnoozedOn({ snoozeUntil: '2026-10-15' }, '2026-10-14') === true);
ok('volta no dia marcado', P.isSnoozedOn({ snoozeUntil: '2026-10-14' }, '2026-10-14') === false && P.isSnoozedOn({}, '2026-10-14') === false);
ok('rótulo de adiar', P.snoozeLabel('2026-10-15', '2026-10-15') === 'amanhã' && P.snoozeLabel('2026-10-20', '2026-10-15') === 'em 20/10');
const items = [{ done: true, doneBy: 'carla' }, { done: true, doneBy: 'zeca' }, { done: true, doneBy: 'bruno' }, { done: true, doneBy: 'bruno' }, { done: false, doneBy: 'ana' }, { done: true }];
ok('contribuições: mais itens primeiro; só concluídos com autor', P.contributionsOf(items, null).map((c) => c.name + c.count).join() === 'bruno2,carla1,zeca1');
ok('empate: "eu" vem primeiro, mesmo depois no alfabeto', P.contributionsOf(items, 'zeca').map((c) => c.name).join() === 'bruno,zeca,carla');
ok('sem itens: lista vazia', P.contributionsOf([], 'zeca').length === 0);

console.log('9. backup automático');
const n0 = new Date(2026, 9, 14, 10, 0);
ok('backup vencido: nunca enviado', P.backupDue(0, n0) === true);
ok('backup vencido: enviado ontem', P.backupDue(new Date(2026, 9, 13, 23, 59).getTime(), n0) === true);
ok('backup em dia: enviado hoje cedo', P.backupDue(new Date(2026, 9, 14, 0, 1).getTime(), n0) === false);
ok('idade: hoje/ontem/data/nunca', P.backupAge(new Date(2026, 9, 14, 9, 5).getTime(), n0) === 'hoje às 09:05' && P.backupAge(new Date(2026, 9, 13, 21, 30).getTime(), n0) === 'ontem às 21:30' && P.backupAge(new Date(2026, 9, 2, 8, 0).getTime(), n0) === '02/10 às 08:00' && P.backupAge(0, n0) === 'ainda não enviado');
const rnd = Array.from({ length: 64 }, (_, i) => (i * 37 + 11) % 256);
const code = P.makeBackupCode(rnd);
ok('código: 24 caracteres alfanuméricos (aceito pelo servidor)', /^[A-Za-z0-9]{24}$/.test(code), code);
ok('código: bytes insuficientes ou todos rejeitados -> null', P.makeBackupCode([1, 2, 3]) === null && P.makeBackupCode(new Array(64).fill(255)) === null);
ok('código: aleatório de verdade difere', P.makeBackupCode(Array.from({ length: 64 }, (_, i) => (i * 91 + 5) % 256)) !== code);
ok('agrupado de 4 em 4 e volta ao normal', P.groupBackupCode(code) === code.match(/.{4}/g).join('-') && P.normalizeBackupCode(P.groupBackupCode(code)) === code);
ok('normaliza espaços e hífens; recusa curto/longo/vazio', P.normalizeBackupCode(' ab12 cd34-EF56 ') === 'ab12cd34EF56' && P.normalizeBackupCode('abc') === null && P.normalizeBackupCode('a'.repeat(33)) === null && P.normalizeBackupCode('') === null && P.normalizeBackupCode(null) === null);

console.log(`\n${pass} ok, ${fail} falhas`);
process.exit(fail ? 1 : 0);
