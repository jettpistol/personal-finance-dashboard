import { NumberInput, type NumberInputProps } from '@mantine/core';
import { GroupedSelect, type GroupedSelectProps } from './GroupedSelect';
import { accountSelectData, categorySelectData, useAccounts, useCategories } from '../lib/queries';
import { useApp } from '../lib/app-state';
import type { Currency } from '../lib/types';

/** Money input in units (not cents) with Argentine separators. */
export function MoneyInput({ currency, ...props }: NumberInputProps & { currency?: Currency }) {
  return (
    <NumberInput
      decimalSeparator=","
      thousandSeparator="."
      decimalScale={2}
      prefix={currency === 'USD' ? 'US$ ' : '$ '}
      hideControls
      inputMode="decimal"
      {...props}
    />
  );
}

export function AccountSelect({
  value,
  onChange,
  writableOnly,
  includeArchived,
  currency,
  ...props
}: Omit<GroupedSelectProps, 'value' | 'onChange' | 'data' | 'defaultValue'> & {
  value: number | null | undefined;
  onChange: (id: number | null) => void;
  writableOnly?: boolean;
  includeArchived?: boolean;
  currency?: Currency;
}) {
  const accounts = useAccounts();
  const { users } = useApp();
  return (
    <GroupedSelect
      searchable
      data={accountSelectData(accounts.data, users, { writableOnly, includeArchived, currency })}
      value={value == null ? null : String(value)}
      onChange={(v) => onChange(v ? Number(v) : null)}
      nothingFoundMessage="Sin cuentas"
      {...props}
    />
  );
}

export function CategorySelect({
  value,
  onChange,
  kind,
  parentsOnly,
  ...props
}: Omit<GroupedSelectProps, 'value' | 'onChange' | 'data' | 'defaultValue'> & { value: number | null | undefined; onChange: (id: number | null) => void; kind: 'expense' | 'income'; parentsOnly?: boolean }) {
  const cats = useCategories();
  return (
    <GroupedSelect
      searchable
      clearable
      data={categorySelectData(cats.data, kind, { parentsOnly })}
      value={value == null ? null : String(value)}
      onChange={(v) => onChange(v ? Number(v) : null)}
      nothingFoundMessage="Sin coincidencias"
      {...props}
    />
  );
}
