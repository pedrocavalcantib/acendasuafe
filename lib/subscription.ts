// src/lib/subscription.ts
import { Platform } from 'react-native';
import Purchases, {
  PurchasesCustomerInfo,
  PurchasesOfferings,
} from 'react-native-purchases';
import RevenueCatUI, { PAYWALL_RESULT } from 'react-native-purchases-ui';

// 🔑 Suas API Keys reais do RevenueCat
const REVENUECAT_API_KEY_IOS = 'appl_gOlGddmXJQjtWPKpSmyuKlvpiix';
const REVENUECAT_API_KEY_ANDROID = 'goog_jsJwiQdBwYBIxchmSSpoabFUvPn';

// 🏷 ID do entitlement configurado no painel do RevenueCat
// (se no painel estiver outro identificador — ex: "Acenda Sua Fé Unlimited" —
// troque aqui para ficar idêntico)
const ENTITLEMENT_ID = 'premium';

// =======================
// Inicialização do SDK
// =======================
export function initPurchases(userId: string) {
  const apiKey =
    Platform.OS === 'ios' ? REVENUECAT_API_KEY_IOS : REVENUECAT_API_KEY_ANDROID;

  Purchases.configure({
    apiKey,
    appUserID: userId,
  });
}

// =======================
// Helpers de Customer Info
// =======================
export async function getCustomerInfo(): Promise<PurchasesCustomerInfo> {
  return await Purchases.getCustomerInfo();
}

export type SubscriptionStatus = 'active' | 'pending' | 'canceled' | 'never';

export function getSubscriptionStatus(
  customerInfo: PurchasesCustomerInfo | null
): SubscriptionStatus {
  if (!customerInfo) return 'never';

  const ent = customerInfo.entitlements.all[ENTITLEMENT_ID];
  if (!ent) return 'never';

  const now = new Date();
  const exp = ent.expirationDate ? new Date(ent.expirationDate) : null;

  const isActive = !!customerInfo.entitlements.active[ENTITLEMENT_ID];
  const hasBillingIssue = !!ent.billingIssueDetectedAt;

  // 1) PENDENTE: ativo, mas com problema de cobrança (grace period)
  if (isActive && hasBillingIssue) {
    return 'pending';
  }

  // 2) ATIVO normal (trial ou pago, sem problema de cobrança)
  if (isActive && !hasBillingIssue) {
    return 'active';
  }

  // 3) JÁ TEVE E EXPIROU
  if (exp && exp < now) {
    return 'canceled';
  }

  // 4) Qualquer outro caso estranho (entitlement existiu mas não está ativo
  // e não temos expiração clara) – tratamos como "canceled"
  return 'canceled';
}

export function hasEntitlement(
  customerInfo: PurchasesCustomerInfo | null,
): boolean {
  if (!customerInfo) return false;
  return !!customerInfo.entitlements.active[ENTITLEMENT_ID];
}

// Conveniência: mesmo que o nome seja "isUserSubscribed", por baixo usa o entitlement
export function isUserSubscribed(
  customerInfo: PurchasesCustomerInfo | null,
): boolean {
  return hasEntitlement(customerInfo);
}

// =======================
// Offerings / Compra direta (opcional)
// =======================
export async function getOfferings(): Promise<PurchasesOfferings> {
  return await Purchases.getOfferings();
}

// Exemplo de compra do pacote mensal via Offerings (se quiser usar sem Paywall UI)
export async function purchaseMonthly(): Promise<PurchasesCustomerInfo> {
  const offerings = await Purchases.getOfferings();
  const offering = offerings.all['Acenda Mensal']; // identifier exato

  if (!offering) {
    throw new Error('Nenhuma offering atual no RevenueCat');
  }

  const monthly = offering.availablePackages.find(
    (p) => p.packageType === 'MONTHLY' || p.identifier === 'monthly',
  );

  if (!monthly) {
    throw new Error('Pacote mensal não encontrado na offering atual');
  }

  const { customerInfo } = await Purchases.purchasePackage(monthly);
  return customerInfo;
}

// =======================
// Restore
// =======================
export async function restorePurchases(): Promise<PurchasesCustomerInfo> {
  return await Purchases.restorePurchases();
}

// =======================
// Paywall UI oficial (RevenueCatUI)
// =======================
export async function presentPaywall(): Promise<boolean> {
  // Apresenta a paywall da offering atual configurada no painel
  const result: PAYWALL_RESULT = await RevenueCatUI.presentPaywall();

  switch (result) {
    case PAYWALL_RESULT.PURCHASED:
    case PAYWALL_RESULT.RESTORED:
      // compra ok ou restore ok
      return true;

    case PAYWALL_RESULT.NOT_PRESENTED:
    case PAYWALL_RESULT.ERROR:
    case PAYWALL_RESULT.CANCELLED:
    default:
      return false;
  }
}