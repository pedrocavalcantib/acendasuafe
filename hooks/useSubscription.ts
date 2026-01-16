// hooks/useSubscription.ts
import { useEffect, useState } from 'react';
import {
    getCustomerInfo,
    initPurchases,
    isUserSubscribed,
    purchaseMonthly,
    restorePurchases,
} from '../lib/subscription';

type Status = 'loading' | 'active' | 'inactive' | 'error';

export function useSubscription(userId: string | null) {
  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      console.log('[SUBS] useSubscription load() chamado', { userId });

      if (!userId) {
        console.log('[SUBS] sem userId -> status = inactive');
        setStatus('inactive');
        return;
      }

      try {
        setStatus('loading');
        console.log('[SUBS] initPurchases começando...', { userId });
        await initPurchases(userId);
        console.log('[SUBS] initPurchases OK');

        const info = await getCustomerInfo();
        console.log(
          '[SUBS] getCustomerInfo retornou',
          info
            ? {
                entitlementsAtivos: Object.keys(info.entitlements?.active ?? {}),
              }
            : 'info nula',
        );

        const subscribed = isUserSubscribed(info);
        console.log('[SUBS] isUserSubscribed =>', subscribed);

        setStatus(subscribed ? 'active' : 'inactive');
        console.log('[SUBS] status final após load():', subscribed ? 'active' : 'inactive');
      } catch (err: any) {
        console.log('[SUBS] erro ao carregar status', err);
        setError(err?.message ?? 'Erro');
        setStatus('error');
      }
    }

    load();
  }, [userId]);

  async function buy() {
    console.log('[SUBS] buy() chamado');
    try {
      setStatus('loading');

      const info = await purchaseMonthly();
      console.log(
        '[SUBS] purchaseMonthly retornou',
        info
          ? {
              entitlementsAtivos: Object.keys(info.entitlements?.active ?? {}),
            }
          : 'info nula',
      );

      const subscribed = isUserSubscribed(info);
      console.log('[SUBS] isUserSubscribed após compra =>', subscribed);

      setStatus(subscribed ? 'active' : 'inactive');
      console.log('[SUBS] status final após buy():', subscribed ? 'active' : 'inactive');

      return subscribed;
    } catch (err: any) {
      console.log('[SUBS] erro na compra', err);
      setError(err?.message ?? 'Erro na compra');
      setStatus('error');
      return false;
    }
  }

  async function restore() {
    console.log('[SUBS] restore() chamado');
    try {
      setStatus('loading');

      const info = await restorePurchases();
      console.log(
        '[SUBS] restorePurchases retornou',
        info
          ? {
              entitlementsAtivos: Object.keys(info.entitlements?.active ?? {}),
            }
          : 'info nula',
      );

      const subscribed = isUserSubscribed(info);
      console.log('[SUBS] isUserSubscribed após restore =>', subscribed);

      setStatus(subscribed ? 'active' : 'inactive');
      console.log('[SUBS] status final após restore():', subscribed ? 'active' : 'inactive');

      return subscribed;
    } catch (err: any) {
      console.log('[SUBS] erro ao restaurar', err);
      setError(err?.message ?? 'Erro ao restaurar');
      setStatus('error');
      return false;
    }
  }

  console.log('[SUBS] hook renderizou', { status, error, hasUserId: !!userId });

  return { status, error, buy, restore };
}