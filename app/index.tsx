// app/index.tsx

import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import React, { useEffect, useRef, useState } from 'react';
import { Platform, SafeAreaView, StatusBar } from 'react-native';
import { WebView } from 'react-native-webview';
import { supabase } from '../lib/supabase';

const WEB_APP_URL = 'https://great-fable-03032415.figma.site';

// (opcional, mas ajuda a tipar a mensagem)
type WebMessage =
  | {
      type: 'USER_ID_CREATED';
      data: {
        userId: string;
        isLocal?: boolean;
      };
    }
  | any;

  async function saveDebugTokenToSupabase(userId: string) {
  try {
    const normalizedUserId = userId.replace(/^user:/, '');
    const userKey = `user:${normalizedUserId}`;
    console.log('[DEBUG] Vou salvar token fake para key:', userKey);

    // 1) Busca o usuario com retry leve (pode ainda estar sendo criado no backend)
    let foundRow: { key: string; value: any } | null = null;
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const { data: byKey, error: byKeyError } = await supabase
        .from('kv_store_258bafe3')
        .select('key, value')
        .eq('key', userKey)
        .maybeSingle();

      if (byKeyError) {
        console.log('[DEBUG] Erro ao buscar usuario por key no Supabase:', byKeyError);
        return;
      }

      const { data: byValue, error: byValueError } = byKey
        ? { data: byKey, error: null }
        : await supabase
            .from('kv_store_258bafe3')
            .select('key, value')
            .contains('value', { id: normalizedUserId })
            .limit(1)
            .maybeSingle();

      if (byValueError) {
        console.log('[DEBUG] Erro ao buscar usuario por value no Supabase:', byValueError);
        return;
      }

      if (byValue) {
        foundRow = byValue;
        break;
      }

      console.log(`[DEBUG] Tentativa ${attempt}/5 sem resultado, aguardando...`);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    if (!foundRow) {
      console.log('[DEBUG] Nenhum usuario encontrado para userId:', normalizedUserId);
      return;
    }

    console.log('[DEBUG] JSON atual:', JSON.stringify(foundRow.value));

    // 2) Monta novo JSON com pushToken fake
    const currentValue = foundRow.value || {};
    const newValue = {
      ...currentValue,
      pushToken: 'DEBUG_TOKEN_TESTE',
    };

    console.log('[DEBUG] Novo JSON a salvar:', JSON.stringify(newValue));

    // 3) Atualiza
    const { error: updateError } = await supabase
      .from('kv_store_258bafe3')
      .update({ value: newValue })
      .eq('key', foundRow.key);

    if (updateError) {
      console.log('[DEBUG] Erro ao atualizar usuário no Supabase:', updateError);
    } else {
      console.log('[DEBUG] pushToken DEBUG salvo com sucesso!');
    }
  } catch (err) {
    console.log('[DEBUG] Erro inesperado ao salvar token:', err);
  }
}

export default function HomeScreen() {
  const [userId, setUserId] = useState<string | null>(null);
  const [webReady, setWebReady] = useState(false);
  const [pendingPushPayload, setPendingPushPayload] = useState<{
    userId: string;
    pushToken: string;
    token: string;
    platform: string;
    createdAt: string;
  } | null>(null);
  const webViewRef = useRef<WebView>(null);

  // 1) Listener da WebView: recebe o userId do app web
const handleWebViewMessage = (event: any) => {
  try {
    const message = JSON.parse(event.nativeEvent.data);

    if (message.type === 'USER_ID_CREATED') {
      const { userId: receivedUserId, isLocal } = message.data;
      console.log('UserId recebido:', receivedUserId);
      console.log('É local?', isLocal);
      setUserId(receivedUserId);

      // (debug removido) evitar sobrescrever pushToken real no Supabase
    }

    if (message.type === 'PUSH_TOKEN_ACK') {
      console.log('[PUSH][NATIVE] ack', message.data);
    }
  } catch (err) {
    console.log('Mensagem inválida vinda da WebView:', err);
  }
};
  // 2) Só registra push quando já tiver userId
  useEffect(() => {
    if (!userId) {
      console.log('Ainda não recebi userId do app web, não vou registrar push ainda.');
      return;
    }

    async function registerForPushNotificationsAsync() {
      try {
      // Só funciona em device físico
      console.log('[DEBUG] Device.isDevice:', Device.isDevice);
      if (!Device.isDevice) {
        console.log('Push notifications só funcionam em dispositivo físico.');
        return;
      }

      // ANDROID: configura canal
      if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync('default', {
          name: 'default',
          importance: Notifications.AndroidImportance.MAX,
          vibrationPattern: [0, 250, 250, 250],
          lightColor: '#ffffff',
        });
      }

      // Verifica/solicita permissão
      const { status: existingStatus } = await Notifications.getPermissionsAsync();
      let finalStatus = existingStatus;
      console.log('[DEBUG] Permissao atual:', existingStatus);

      if (finalStatus !== 'granted') {
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
        console.log('[DEBUG] Permissao apos request:', finalStatus);
      }

      if (finalStatus !== 'granted') {
        console.log('Permissão para notificações não concedida.');
        return;
      }

      // Pega Expo Push Token
      const projectId =
        Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
      console.log('[DEBUG] EAS projectId:', projectId);
      const tokenResponse = await Notifications.getExpoPushTokenAsync(
        projectId ? { projectId } : undefined
      );
      const expoToken = tokenResponse.data;
      console.log('Expo push token:', expoToken);

      console.log('[PUSH][NATIVE] token ready, aguardando webReady', {
        webReady,
        userId,
      });
      setPendingPushPayload({
        userId,
        pushToken: expoToken,
        token: expoToken,
        platform: Platform.OS,
        createdAt: new Date().toISOString(),
      });
      } catch (err) {
        console.log('[DEBUG] Erro ao registrar push:', err);
      }
    }

    registerForPushNotificationsAsync();
  }, [userId]);

  useEffect(() => {
    if (!webReady || !pendingPushPayload || !webViewRef.current) return;

    const traceId = `trace_${Date.now()}`;
    const payload = {
      type: 'PUSH_TOKEN',
      data: {
        ...pendingPushPayload,
        traceId,
      },
    };

    console.log('[PUSH][NATIVE] send', {
      traceId,
      userId: pendingPushPayload.userId,
      pushToken: pendingPushPayload.pushToken,
    });

    webViewRef.current.postMessage(JSON.stringify(payload));
    webViewRef.current.postMessage(
      JSON.stringify({ ...payload, type: 'PUSH_TOKEN_READY' })
    );

    const escapedUserId = JSON.stringify(pendingPushPayload.userId);
    const escapedToken = JSON.stringify(pendingPushPayload.pushToken);
    const injected = `
      (function() {
        var attempts = 0;
        var max = 30;
        var interval = 500;
        var userId = ${escapedUserId};
        var pushToken = ${escapedToken};
        function trySend() {
          if (window.savePushTokenFromNative) {
            window.savePushTokenFromNative(userId, pushToken);
            return;
          }
          attempts += 1;
          if (attempts < max) {
            setTimeout(trySend, interval);
          }
        }
        trySend();
      })();
      true;
    `;
    webViewRef.current.injectJavaScript(injected);

    console.log('Push token enviado para o app web');
    setPendingPushPayload(null);
  }, [pendingPushPayload, webReady]);

  // 3) WebView apontando pro app web e ouvindo mensagens
  return (
    <SafeAreaView style={{ flex: 1 }}>
      <StatusBar barStyle="dark-content" />
      <WebView
        source={{ uri: WEB_APP_URL }}
        style={{ flex: 1 }}
        onMessage={handleWebViewMessage}
        onLoadEnd={() => {
          console.log('[WEBVIEW] load end');
          setWebReady(true);
        }}
        ref={webViewRef}
      />
    </SafeAreaView>
  );
}
