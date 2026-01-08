// app/index.tsx

import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import React, { useEffect, useState } from 'react';
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

export default function HomeScreen() {
  const [userId, setUserId] = useState<string | null>(null);

  // 1) Listener da WebView: recebe o userId do app web
  const handleWebViewMessage = (event: any) => {
    try {
      const message: WebMessage = JSON.parse(event.nativeEvent.data);

      if (message.type === 'USER_ID_CREATED') {
        const { userId: receivedUserId, isLocal } = message.data;

        console.log('UserId recebido:', receivedUserId);
        console.log('É local?', isLocal);

        // guarda no estado (depois podemos salvar em AsyncStorage/SecureStore)
        setUserId(receivedUserId);
      }
    } catch (err) {
      console.log('Erro ao parsear mensagem da WebView:', err);
    }
  };

  // 2) Só registra push quando já tiver userId
  useEffect(() => {
    if (!userId) {
      console.log('Ainda não recebi userId do app web, não vou registrar push ainda.');
      return;
    }

    async function registerForPushNotificationsAsync() {
      // Só funciona em device físico
      if (!Constants.isDevice) {
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

      if (finalStatus !== 'granted') {
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
      }

      if (finalStatus !== 'granted') {
        console.log('Permissão para notificações não concedida.');
        return;
      }

      // Pega Expo Push Token
      const tokenResponse = await Notifications.getExpoPushTokenAsync();
      const expoToken = tokenResponse.data;
      console.log('Expo push token:', expoToken);

      // Salva no Supabase
      const { error } = await supabase
        .from('kv_store_258bafe3') // nome da sua tabela
        .upsert(
          {
            key: `pushToken:${expoToken}`, // chave única
            value: {
              token: expoToken,
              userId, // <- VAI JUNTO COM O TOKEN
              platform: Platform.OS,
              createdAt: new Date().toISOString(),
            },
          },
          { onConflict: 'key' } // se já existir essa key, atualiza
        );

      if (error) {
        console.log('Erro ao salvar token no Supabase:', error);
      } else {
        console.log('Token salvo no Supabase com sucesso');
      }
    }

    registerForPushNotificationsAsync();
  }, [userId]);

  // 3) WebView apontando pro app web e ouvindo mensagens
  return (
    <SafeAreaView style={{ flex: 1 }}>
      <StatusBar barStyle="dark-content" />
      <WebView
        source={{ uri: WEB_APP_URL }}
        style={{ flex: 1 }}
        onMessage={handleWebViewMessage}
      />
    </SafeAreaView>
  );
}