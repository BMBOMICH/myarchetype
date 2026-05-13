import { writeAuditLog } from './logger';

export interface PaymentFraudResult {
  fraudulent: boolean;
  riskScore: number;
  signals: string[];
  action: 'allow' | 'review' | 'block';
  recommendation: string;
}

export function detectPaymentFraud(payment: {
  amount: number;
  currency: string;
  cardCountry?: string;
  userCountry?: string;
  isFirstPayment: boolean;
  paymentMethodAge: number;
  velocityLast24h: number;
  chargebackHistory: number;
  vpnDetected: boolean;
  unusualAmount: boolean;
}): PaymentFraudResult {
  const signals: string[] = [];
  let score = 0;
  if (payment.cardCountry && payment.userCountry && payment.cardCountry !== payment.userCountry) { signals.push('country_mismatch'); score += 20; }
  if (payment.isFirstPayment && payment.amount > 100) { signals.push('large_first_payment'); score += 15; }
  if (payment.paymentMethodAge < 7) { signals.push('new_payment_method'); score += 10; }
  if (payment.velocityLast24h >= 3) { signals.push('high_velocity'); score += 25; }
  if (payment.chargebackHistory >= 2) { signals.push('chargeback_history'); score += 30; }
  if (payment.vpnDetected) { signals.push('vpn_detected'); score += 10; }
  if (payment.unusualAmount) { signals.push('unusual_amount'); score += 15; }
  score = Math.min(score, 100);
  const action = score >= 70 ? 'block' : score >= 40 ? 'review' : 'allow';
  if (action !== 'allow') writeAuditLog('payment.fraud_detected', { signals, riskScore: score, action }).catch(() => {});
  return {
    fraudulent: score >= 70,
    riskScore: score,
    signals,
    action,
    recommendation: action === 'block'
      ? 'High fraud risk. Block and notify user.'
      : action === 'review' ? 'Moderate risk. Flag for manual review.' : 'Payment appears legitimate.',
  };
}

export const paymentFraud = detectPaymentFraud;
export const transactionFraud = detectPaymentFraud;

export interface SubscriptionAbuseResult {
  detected: boolean;
  signals: string[];
  action: 'none' | 'warn' | 'restrict' | 'ban';
  recommendation: string;
}

export function detectSubscriptionAbuse(data: {
  trialAccountCount: number;
  chargebacksLast6Months: number;
  sharedPaymentMethod: boolean;
  rapidUpgradeDowngrade: boolean;
  refundRequests: number;
}): SubscriptionAbuseResult {
  const signals: string[] = [];
  if (data.trialAccountCount >= 3) signals.push('multiple_trial_accounts');
  if (data.chargebacksLast6Months >= 2) signals.push('repeated_chargebacks');
  if (data.sharedPaymentMethod) signals.push('shared_payment_method');
  if (data.rapidUpgradeDowngrade) signals.push('rapid_upgrade_downgrade_pattern');
  if (data.refundRequests >= 3) signals.push('excessive_refund_requests');
  const detected = signals.length >= 2;
  const action = signals.length >= 4 ? 'ban' : signals.length >= 3 ? 'restrict' : signals.length >= 1 ? 'warn' : 'none';
  if (detected) writeAuditLog('payment.subscription_abuse', { signals, action }).catch(() => {});
  return {
    detected,
    signals,
    action,
    recommendation: detected
      ? `Subscription abuse detected: ${signals.join(', ')}. Action: ${action}.`
      : 'No subscription abuse detected.',
  };
}

export const subscriptionAbuse = detectSubscriptionAbuse;