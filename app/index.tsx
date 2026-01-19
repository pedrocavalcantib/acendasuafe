// app/index.tsx

import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import React, { useEffect, useRef, useState } from 'react';
import { Alert, Linking, Platform, SafeAreaView, StatusBar } from 'react-native';
import Purchases, { LOG_LEVEL } from 'react-native-purchases';
import { WebView } from 'react-native-webview';
import { getCustomerInfo, getSubscriptionStatus, presentPaywall } from '../lib/subscription';
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

async function openManageSubscription() {
  try {
    if (Platform.OS === 'ios') {
      // Abre a tela de assinaturas da App Store
      const url = 'https://apps.apple.com/account/subscriptions';
      const supported = await Linking.canOpenURL(url);

      if (supported) {
        console.log('[SUBS][NATIVE] abrindo gerenciador de assinatura iOS');
        await Linking.openURL(url);
      } else {
        Alert.alert(
          'Assinatura',
          'Não foi possível abrir as configurações de assinatura da App Store. Tente ajustar manualmente em Ajustes > ID Apple > Assinaturas.'
        );
      }
    } else if (Platform.OS === 'android') {
      // Abre a tela de assinaturas da Play Store
      const url = 'https://play.google.com/store/account/subscriptions';
      const supported = await Linking.canOpenURL(url);

      if (supported) {
        console.log('[SUBS][NATIVE] abrindo gerenciador de assinatura Android');
        await Linking.openURL(url);
      } else {
        Alert.alert(
          'Assinatura',
          'Não foi possível abrir as configurações de assinatura da Play Store. Tente ajustar manualmente na Play Store > Ícone do perfil > Pagamentos e assinaturas.'
        );
      }
    }
  } catch (err) {
    console.log('[SUBS][NATIVE] erro ao abrir tela de assinatura:', err);
    Alert.alert(
      'Assinatura',
      'Ocorreu um erro ao abrir as configurações de assinatura. Tente novamente mais tarde.'
    );
  }
}

export default function HomeScreen() {
  const [userId, setUserId] = useState<string | null>(null);
  const [webReady, setWebReady] = useState(false);
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [pendingPushPayload, setPendingPushPayload] = useState<{
    userId: string;
    pushToken: string;
    token: string;
    platform: string;
    createdAt: string;
  } | null>(null);
  const webViewRef = useRef<WebView>(null);

  // [RC] Inicializa RevenueCat
  useEffect(() => {
    const setupRevenueCat = async () => {
      try {
        // Chaves reais por plataforma
        const iosApiKey = 'appl_gOlGddmXJQjtWPKpSmyuKlvpiix';
        const androidApiKey = 'goog_jsJwiQdBwYBIxchmSSpoabFUvPn';

        Purchases.setLogLevel(LOG_LEVEL.VERBOSE); // ajuda no debug

        await Purchases.configure({
          apiKey: Platform.OS === 'ios' ? iosApiKey : androidApiKey,
        });

        console.log('[RC] RevenueCat configurado com sucesso');
      } catch (err) {
        console.log('[RC] Erro ao configurar RevenueCat:', err);
      }
    };

    setupRevenueCat();
  }, []);

  const sendSubscriptionStatusToWeb = async () => {
    if (!webViewRef.current) {
      console.log('[SUBS][NATIVE] WebView ainda não está pronta pra receber status');
      return;
    }

    try {
      console.log('[SUBS][NATIVE] buscando customerInfo no RevenueCat...');
      const info = await getCustomerInfo();
      const status = getSubscriptionStatus(info);

      console.log('[SUBS][NATIVE] status calculado:', status);

      webViewRef.current.postMessage(
        JSON.stringify({
          type: 'SUBSCRIPTION_STATUS',
          data: { status },
        }),
      );
    } catch (err) {
      console.log('[SUBS][NATIVE] erro ao buscar status de assinatura:', err);
      webViewRef.current.postMessage(
        JSON.stringify({
          type: 'SUBSCRIPTION_STATUS',
          data: { status: 'never', error: true },
        }),
      );
    }
  };

useEffect(() => {
  console.log('[PUSH][OPEN] Registrando listener de abertura de notificação');

  const subscription = Notifications.addNotificationResponseReceivedListener(
    (response) => {
      try {
        const notif = response.notification;
        const notificationId =
          notif.request.content.data?.notificationId as string | undefined;

        console.log('[PUSH][OPEN] Notificação aberta:', {
          notificationId,
          data: notif.request.content.data,
        });

        if (!notificationId) {
          console.log('[PUSH][OPEN] Sem notificationId, ignorando');
          return;
        }

        if (!webViewRef.current) {
          console.log('[PUSH][OPEN] WebView ainda não montada, não deu pra enviar');
          return;
        }

        webViewRef.current.postMessage(
          JSON.stringify({
            type: 'PUSH_OPENED',
            data: { notificationId },
          }),
        );
      } catch (err) {
        console.log('[PUSH][OPEN] Erro inesperado no listener:', err);
      }
    },
  );

  return () => {
    subscription.remove();
  };
}, []);

  // 1) Listener da WebView: recebe o userId do app web
  // 1) Listener da WebView: recebe o userId e comandos do app web
const handleWebViewMessage = async (event: any) => {
  try {
    const message = JSON.parse(event.nativeEvent.data);

    console.log('[WEBVIEW][NATIVE] mensagem recebida:', message);

    if (message.type === 'USER_ID_CREATED') {
  const { userId: receivedUserId, isLocal } = message.data;
  console.log('UserId recebido:', receivedUserId);
  console.log('É local?', isLocal);
  setUserId(receivedUserId);

  const platform = Platform.OS; // 'ios' ou 'android'

  webViewRef.current?.postMessage(
    JSON.stringify({
      type: 'PLATFORM_INFO',
      data: {
        userId: receivedUserId,
        platform, // 'ios' | 'android'
            },
          }),
        );

    } else if (message.type === 'NOTIFICATIONS_ENABLED') {
      console.log('[PUSH][NATIVE] notifications enabled from web');
      setNotificationsEnabled(true);

    } else if (message.type === 'NOTIFICATIONS_ENABLED_ACK') {
      console.log('[PUSH][NATIVE] notifications enabled ack', message.data);

    } else if (message.type === 'PUSH_TOKEN_ACK') {
      console.log('[PUSH][NATIVE] ack', message.data);

    } else if (message.type === 'OPEN_PAYWALL') {
      console.log('[SUBS][NATIVE] pedido de abrir paywall');
      const success = await presentPaywall();
      const info = await getCustomerInfo();
      const status = getSubscriptionStatus(info);

      webViewRef.current?.postMessage(
        JSON.stringify({
          type: 'PAYWALL_RESULT',
          data: { success, status },
        }),
      );

    } else if (message.type === 'CHECK_SUBSCRIPTION_STATUS') {
      console.log('[SUBS][NATIVE] web pediu status de assinatura');
      sendSubscriptionStatusToWeb();

    } else if (message.type === 'OPEN_SUBS_MANAGEMENT') {
      console.log('[SUBS][NATIVE] abrir tela de gerenciamento de assinatura');
      openManageSubscription();
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
    if (!notificationsEnabled) {
      console.log('Notificacoes ainda nao habilitadas no app web.');
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
  }, [notificationsEnabled, userId]);

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