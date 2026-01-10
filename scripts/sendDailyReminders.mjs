// scripts/sendDailyReminders.mjs

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

// --- Helpers de horário -----------------------------------------------------

// Retorna "HH:MM" no timezone atual do processo (se você setar TZ no Railway, ele usa isso)
function getCurrentHHMM(date = new Date()) {
  const h = String(date.getHours()).padStart(2, '0');
  const m = String(date.getMinutes()).padStart(2, '0');
  const hhmm = `${h}:${m}`;
  console.log(`[TIME] Agora é ${hhmm}`);
  return hhmm;
}

// Converte "HH:MM" para minutos desde 00:00
function toMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

// Diferença em minutos entre dois horários "HH:MM", tratando virada de dia
// diff = now - target (em minutos), ajustado para faixa [0, 1440)
function diffMinutes(nowHHMM, targetHHMM) {
  const DAY_MINUTES = 24 * 60;
  const now = toMinutes(nowHHMM);
  const target = toMinutes(targetHHMM);
  let diff = now - target;
  if (diff < 0) diff += DAY_MINUTES; // trata casos tipo 00:02 vs 23:59
  return diff;
}

// ---------------------------------------------------------------------------

async function main() {
  const hhmm = getCurrentHHMM();
  console.log('[PUSH] Rodando worker de push. Horário atual:', hhmm);

  // 2) Buscar todos os registros com notificationTime e pushToken
  const { data, error } = await supabase
    .from('kv_store_258bafe3') // sua tabela
    .select('key, value');

  if (error) {
    console.error('[PUSH] Erro ao buscar dados no Supabase:', error);
    return;
  }

  if (!data || data.length === 0) {
    console.log('[PUSH] Nenhum registro encontrado na tabela.');
    return;
  }

  // 3) Filtrar quem tem notificationTime dentro da janela de 5 minutos
  //    e possui pushToken válido
  const WINDOW_MINUTES = 5;

  const usersToNotify = data.filter((row) => {
    const v = row.value || {};

    const notificationTime = v.notificationTime;
    const pushToken = v.pushToken;

    if (!notificationTime || !pushToken) {
      return false;
    }

    const diff = diffMinutes(hhmm, notificationTime);

    // Considera o usuário se o horário dele está entre
    // (now - 5 minutos) e now, inclusive now.
    const dentroDaJanela = diff >= 0 && diff < WINDOW_MINUTES;

    if (dentroDaJanela) {
      console.log(
        `[PUSH] User ${row.key} está na janela. notificationTime=${notificationTime}, diff=${diff}min`
      );
    }

    return dentroDaJanela;
  });

  console.log(
    `[PUSH] Encontrados ${usersToNotify.length} usuários para notificar.`
  );

  if (usersToNotify.length === 0) {
    console.log('[PUSH] Nenhuma mensagem para enviar neste minuto.');
    return;
  }

  // 4) Montar mensagens
  const messages = [];

  for (const row of usersToNotify) {
    const v = row.value || {};
    const pushToken = v.pushToken;

    if (!pushToken) continue;
    if (!Expo.isExpoPushToken(pushToken)) {
      console.log('[PUSH] Token inválido, ignorando:', pushToken);
      continue;
    }

    messages.push({
      to: pushToken,
      sound: 'default',
      title: 'Seu momento com Deus ✨',
      body: 'Reserve um instante para sua reflexão espiritual de hoje.',
      data: { type: 'daily_reminder' },
    });
  }

  if (messages.length === 0) {
    console.log('[PUSH] Nenhuma mensagem válida após filtrar tokens.');
    return;
  }

  // 5) Enviar em lotes
  const chunks = expo.chunkPushNotifications(messages);
  const tickets = [];

  for (const chunk of chunks) {
    try {
      const ticketChunk = await expo.sendPushNotificationsAsync(chunk);
      console.log('[PUSH] Tickets de envio:', ticketChunk);
      tickets.push(...ticketChunk);
    } catch (err) {
      console.error('[PUSH] Erro ao enviar notificação:', err);
    }
  }

  console.log('[PUSH] Envio de notificações finalizado.');
}

main()
  .then(() => {
    console.log('[PUSH] Worker concluído.');
    process.exit(0);
  })
  .catch((err) => {
    console.error('[PUSH] Erro inesperado no worker:', err);
    process.exit(1);
  });