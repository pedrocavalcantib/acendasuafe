// scripts/sendHabitFollowups.mjs

import { createClient } from '@supabase/supabase-js';
import expoPkg from 'expo-server-sdk';

const { Expo } = expoPkg;

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey) {
  console.error('Faltam SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY nas env vars');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: { persistSession: false },
});

const expo = new Expo();

// ----------------- Helpers de datas -----------------

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function asLocalDateOnly(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function parseDateStr(dateStr) {
  // dateStr no formato "YYYY-MM-DD"
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

// recebe lista de strings "YYYY-MM-DD" e descobre:
// - última data
// - tamanho da sequência encerrando nessa data
function analyzeStreak(completedDates) {
  if (!completedDates || completedDates.length === 0) {
    return { lastDateStr: null, lastDate: null, streakLength: 0 };
  }

  // ordena crescente, só pra garantir
  const sorted = [...completedDates].sort(); // lexical funciona em YYYY-MM-DD
  const lastDateStr = sorted[sorted.length - 1];
  const lastDate = parseDateStr(lastDateStr);

  let streak = 1;
  let prevDate = lastDate;

  for (let i = sorted.length - 2; i >= 0; i--) {
    const d = parseDateStr(sorted[i]);

    const diffDays = Math.round(
      (asLocalDateOnly(prevDate) - asLocalDateOnly(d)) / MS_PER_DAY
    );

    if (diffDays === 1) {
      streak += 1;
      prevDate = d;
    } else {
      break;
    }
  }

  return { lastDateStr, lastDate, streakLength: streak };
}

// ----------------- Lógica dos pushes -----------------

function decidePushType(daysSinceLast, streakLength) {
  // #1 – Quebrou sequência de 3+ dias (ontem foi o primeiro dia sem completar)
  if (daysSinceLast === 1 && streakLength >= 3) {
    return 'BROKE_3_STREAK';
  }

  // #2 – 3 dias sem completar
  if (daysSinceLast === 3) {
    return 'NO_DAY_3';
  }

  // #3 – 7 dias sem completar
  if (daysSinceLast === 7) {
    return 'NO_DAY_7';
  }

  // #4 – múltiplos de 7 (14, 21, 28, ...)
  if (daysSinceLast >= 14 && daysSinceLast % 7 === 0) {
    return 'NO_DAY_MULTIPLE_7';
  }

  return null;
}

function buildMessage(pushType) {
  switch (pushType) {
    case 'BROKE_3_STREAK':
      return {
        title: 'Tá quase virando hábito ✨',
        body:
          'Você vem em uma boa sequência. Bora retomar hoje, sem peso, só mais um passo. 🕯️',
      };

    case 'NO_DAY_3':
      return {
        title: 'Continuo aqui por você 💛',
        body: 'Que tal separar 3 minutinhos hoje pra se recentrar?',
      };

    case 'NO_DAY_7':
      return {
        title: 'Uma semana passa voando…',
        body: 'Se quiser, hoje pode ser um recomeço tranquilo. 🕯️',
      };

    case 'NO_DAY_MULTIPLE_7':
      return {
        title: 'Toda pausa pode virar recomeço ✨',
        body: 'Se sentir que faz sentido, tire um tempo para se recentrar hoje. 🌱',
      };

    default:
      return null;
  }
}

// ----------------- Main -----------------

async function main() {
  const today = asLocalDateOnly(new Date());
  console.log('[FOLLOWUP] Rodando worker de follow-up de hábito. Hoje:', today);

  // pega todos os registros (igual ao script de lembrete)
  const { data, error } = await supabase
    .from('kv_store_258bafe3')
    .select('key, value');

  if (error) {
    console.error('[FOLLOWUP] Erro ao buscar dados no Supabase:', error);
    return;
  }

  if (!data || data.length === 0) {
    console.log('[FOLLOWUP] Nenhum registro encontrado.');
    return;
  }

  const messages = [];

  for (const row of data) {
    const v = row.value || {};

    const pushToken = v.pushToken;
    const completedDates = v.completedDates || [];
    const notificationsEnabled = v.notificationsEnabled;

    // só manda se tiver token e push habilitado (ajusta a condição se seu campo for diferente)
    if (!pushToken) continue;
    if (notificationsEnabled === false) continue;
    if (!Expo.isExpoPushToken(pushToken)) {
      console.log('[FOLLOWUP] Token inválido, ignorando:', pushToken);
      continue;
    }

    const { lastDate, lastDateStr, streakLength } = analyzeStreak(completedDates);

    if (!lastDate) {
      // nunca completou nada -> nada desses 4 pushes faz sentido
      continue;
    }

    const daysSinceLast = Math.floor(
      (asLocalDateOnly(today) - asLocalDateOnly(lastDate)) / MS_PER_DAY
    );

    // se a última conclusão é hoje ou no futuro, não manda follow-up
    if (daysSinceLast <= 0) continue;

    const pushType = decidePushType(daysSinceLast, streakLength);

    if (!pushType) continue;

    const msg = buildMessage(pushType);
    if (!msg) continue;

    console.log(
      `[FOLLOWUP] User ${row.key} -> last=${lastDateStr}, streak=${streakLength}, daysSinceLast=${daysSinceLast}, pushType=${pushType}`
    );

    messages.push({
      to: pushToken,
      sound: 'default',
      title: msg.title,
      body: msg.body,
      data: { type: 'habit_followup', pushType },
    });
  }

  console.log(`[FOLLOWUP] ${messages.length} mensagens para enviar.`);

  if (messages.length === 0) {
    console.log('[FOLLOWUP] Nada para enviar hoje.');
    return;
  }

  const chunks = expo.chunkPushNotifications(messages);
  const tickets = [];

  for (const chunk of chunks) {
    try {
      const ticketChunk = await expo.sendPushNotificationsAsync(chunk);
      console.log('[FOLLOWUP] Tickets de envio:', ticketChunk);
      tickets.push(...ticketChunk);
    } catch (err) {
      console.error('[FOLLOWUP] Erro ao enviar notificações:', err);
    }
  }

  console.log('[FOLLOWUP] Envio de notificações finalizado.');
}

main()
  .then(() => {
    console.log('[FOLLOWUP] Worker concluído.');
    process.exit(0);
  })
  .catch((err) => {
    console.error('[FOLLOWUP] Erro inesperado no worker:', err);
    process.exit(1);
  });