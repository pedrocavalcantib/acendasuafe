import { createClient } from '@supabase/supabase-js';
import { Expo } from 'expo-server-sdk';

// 1) Ler variáveis de ambiente (você vai configurar no Railway)
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Faltam SUPABASE_URL ou SUPABASE_ANON_KEY nas env vars');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);
const expo = new Expo();

// 2) Função pra pegar o horário atual no formato "HH:MM"
function getCurrentHHMM() {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`; // ex: "08:00"
}

async function main() {
  const hhmm = getCurrentHHMM();
  console.log('Rodando worker de push. Horário atual:', hhmm);

  // 3) Buscar usuários cujo reminderTime == horário atual
  const { data, error } = await supabase
    .from('kv_store_258bafe3')
    .select('value');

  if (error) {
    console.error('Erro ao buscar dados no Supabase:', error);
    return;
  }

  if (!data || data.length === 0) {
    console.log('Nenhum registro encontrado na tabela.');
    return;
  }

  // Filtra quem tem reminderTime igual ao horário atual
  const usersToNotify = data.filter((row) => {
    const v = row.value || {};
    return v.reminderTime === hhmm && !!v.pushToken;
  });

  console.log(`Encontrados ${usersToNotify.length} usuários para notificar.`);

  const messages = [];

  for (const row of usersToNotify) {
    const { pushToken } = row.value || {};

    if (!pushToken) continue;
    if (!Expo.isExpoPushToken(pushToken)) {
      console.log('Token inválido, ignorando:', pushToken);
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
    console.log('Nenhuma mensagem para enviar neste minuto.');
    return;
  }

  // 4) Enviar em lotes
  const chunks = expo.chunkPushNotifications(messages);
  const tickets = [];

  for (const chunk of chunks) {
    try {
      const ticketChunk = await expo.sendPushNotificationsAsync(chunk);
      console.log('Tickets de envio:', ticketChunk);
      tickets.push(...ticketChunk);
    } catch (err) {
      console.error('Erro ao enviar notificação:', err);
    }
  }

  console.log('Envio de notificações finalizado.');
}

main().then(() => {
  console.log('Worker concluído.');
  process.exit(0);
});