/**
 * ERP › Sales: money display and currency matching over the company's own list
 * (`sales_currencies`, managed in Settings). Pure helpers, no React.
 */

import { appLocale, formatNumber } from '@/lib/i18n/format';
import type { Currency } from './types';

const byCode = (code: string, currencies: Currency[]) => currencies.find((c) => c.code === code);

/** The currency's name in the page language; an unknown code shows as typed. */
export function currencyLabel(code: string | null | undefined, currencies: Currency[], locale: string): string {
  if (!code) return '';
  const c = byCode(code, currencies);
  if (!c) return code;
  return appLocale(locale) === 'fa' ? c.name_fa : c.name_en;
}

/** An amount with the currency's decimals and symbol (or name); unknown code → the raw code. */
export function formatMoney(
  n: number | null | undefined, code: string | null | undefined, currencies: Currency[], locale: string,
): string {
  if (typeof n !== 'number') return '—';
  if (!code) return formatNumber(n, locale);
  const c = byCode(code, currencies);
  if (!c) return `${formatNumber(n, locale)} ${code}`;
  const digits = { minimumFractionDigits: c.decimals, maximumFractionDigits: c.decimals };
  return `${formatNumber(n, locale, digits)} ${c.symbol ?? currencyLabel(code, currencies, locale)}`;
}

// Spellings the contract ledger used before currencies were managed; kept so old files still map.
const LEDGER_ALIAS: Record<string, string> = {
  euro: 'EUR', eur: 'EUR', '€': 'EUR', 'یورو': 'EUR',
  dollar: 'USD', usd: 'USD', uds: 'USD', $: 'USD', 'دلار': 'USD',
  rial: 'IRR', rials: 'IRR', irr: 'IRR', 'ریال': 'IRR',
  aed: 'AED', dirham: 'AED', 'درهم': 'AED', cny: 'CNY', yuan: 'CNY', 'یوان': 'CNY',
};

const key = (s: string) => s.toLowerCase().replace(/\s+/g, '');

/** The code of an active currency named by `text` (code or either name), else a ledger alias, else null. */
export function matchCurrency(text: string, currencies: Currency[]): string | null {
  const k = key(text);
  if (!k) return null;
  const active = currencies.filter((c) => c.active);
  const hit = active.find((c) => key(c.code) === k || key(c.name_fa) === k || key(c.name_en) === k);
  if (hit) return hit.code;
  const alias = LEDGER_ALIAS[k];
  return alias && active.some((c) => c.code === alias) ? alias : null;
}
