import * as Notifications from 'expo-notifications';

// handler global – deixa as notificações aparecerem como alerta
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';

import { useColorScheme } from '@/hooks/use-color-scheme';

export default function RootLayout() {
  const colorScheme = useColorScheme();

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack
        screenOptions={{
          headerShown: false,   // <-- desliga header pra TODAS as telas
        }}
      >
        <Stack.Screen name="index" /> {/* sua tela de WebView */}
      </Stack>
      <StatusBar style="auto" />
    </ThemeProvider>
  );
}