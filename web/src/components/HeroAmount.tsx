import { Menu, NumberInput, UnstyledButton } from '@mantine/core';
import { IconChevronDown } from '@tabler/icons-react';
import type { Currency } from '../lib/types';

/** Width in `ch` of the amount as shown (es-AR separators), so the box hugs the number. */
function shownLength(value: number | string): number {
  const raw = String(value ?? '');
  if (!raw) return 1;
  const [int, dec] = raw.replace('-', '').split('.');
  const digits = int.length || 1;
  return digits + Math.floor((digits - 1) / 3) + (dec !== undefined ? dec.length + 1 : 0);
}

/**
 * The amount as the headline of a form: a big monospace number, signed and colored by type
 * (− red for a gasto, + green for an ingreso), with the currency as a small menu beside it.
 */
export function HeroAmount({
  value,
  onChange,
  type,
  currency,
  onCurrencyChange,
  error,
  label = 'Monto',
  caption,
}: {
  value: number | string;
  onChange: (v: number | string) => void;
  type: 'expense' | 'income';
  currency: Currency;
  onCurrencyChange: (c: Currency) => void;
  error?: boolean;
  label?: string;
  caption?: string;
}) {
  const sign = type === 'expense' ? '−' : '+';
  return (
    <div className="pfd-hero" data-type={type} data-error={error || undefined}>
      <div className="pfd-hero-amount">
        <span className="pfd-hero-sign" aria-hidden>
          {sign}
        </span>
        <NumberInput
          variant="unstyled"
          aria-label={label}
          placeholder="0"
          decimalSeparator=","
          thousandSeparator="."
          decimalScale={2}
          allowNegative={false}
          hideControls
          inputMode="decimal"
          value={value}
          onChange={onChange}
          styles={{ input: { width: `${shownLength(value) + 0.6}ch` } }}
          classNames={{ input: 'pfd-hero-input' }}
          data-autofocus
        />
        <Menu position="bottom-start" offset={2} width={120}>
          <Menu.Target>
            <UnstyledButton className="pfd-hero-currency" aria-label={`Moneda: ${currency}`}>
              {currency}
              <IconChevronDown size={14} />
            </UnstyledButton>
          </Menu.Target>
          <Menu.Dropdown>
            {(['ARS', 'USD'] as Currency[]).map((c) => (
              <Menu.Item key={c} onClick={() => onCurrencyChange(c)} fw={c === currency ? 700 : undefined}>
                {c === 'ARS' ? 'ARS · pesos' : 'USD · dólares'}
              </Menu.Item>
            ))}
          </Menu.Dropdown>
        </Menu>
      </div>
      {caption && <div className="pfd-hero-caption">{caption}</div>}
    </div>
  );
}
