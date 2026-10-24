import { useState } from 'react';
import { Group, SegmentedControl, Switch, Tabs, Tooltip } from '@mantine/core';
import { PageHeader } from '../components/Layout';
import { InflationTab, MerchantsTab, NetWorthTab, PeopleTab, SavingsTab, TrendTab, YearTab, type ReportParams } from '../components/ReportTabs';
import { scopeName, useApp } from '../lib/app-state';
import { addMonths, currentMonth } from '../lib/format';

type Tab = 'trend' | 'year' | 'savings' | 'networth' | 'people' | 'merchants' | 'inflation';

// Tabs where the month-range and constant-pesos controls apply.
const USES_RANGE: Tab[] = ['trend', 'savings', 'networth', 'merchants'];
const USES_REAL: Tab[] = ['trend', 'year', 'savings'];

export function ReportsPage() {
  const { scope, currency, users, me } = useApp();
  const [tab, setTab] = useState<Tab>('trend');
  const [months, setMonths] = useState('12');
  const [realRaw, setReal] = useState(false);
  const real = realRaw && currency === 'ARS';
  const to = currentMonth();
  const p: ReportParams = { scope, currency, real, from: addMonths(to, -(Number(months) - 1)), to };

  return (
    <>
      <PageHeader
        title="Reportes"
        description={`${scopeName(scope, users, me.id)} · montos en ${currency}${currency === 'USD' ? ' (al dólar BNA del día de cada movimiento)' : ''}`}
        actions={
          <Group gap="sm">
            {USES_RANGE.includes(tab) && (
              <SegmentedControl
                size="xs"
                value={months}
                onChange={setMonths}
                data={[
                  { value: '6', label: '6 meses' },
                  { value: '12', label: '12 meses' },
                  { value: '24', label: '24 meses' },
                ]}
              />
            )}
            {USES_REAL.includes(tab) && (
              <Tooltip label={currency === 'USD' ? 'Solo aplica a montos en pesos' : 'Expresa los montos de meses anteriores en pesos de hoy usando el IPC (INDEC)'} multiline w={260} withArrow>
                <div>
                  <Switch label="Pesos constantes" checked={real} disabled={currency === 'USD'} onChange={(e) => setReal(e.currentTarget.checked)} />
                </div>
              </Tooltip>
            )}
          </Group>
        }
      />
      <Tabs value={tab} onChange={(v) => v && setTab(v as Tab)} keepMounted={false}>
        <Tabs.List mb="md" style={{ flexWrap: 'nowrap', overflowX: 'auto' }}>
          <Tabs.Tab value="trend">Tendencia</Tabs.Tab>
          <Tabs.Tab value="year">Anual</Tabs.Tab>
          <Tabs.Tab value="savings">Ahorro</Tabs.Tab>
          <Tabs.Tab value="networth">Patrimonio</Tabs.Tab>
          <Tabs.Tab value="people">Por persona</Tabs.Tab>
          <Tabs.Tab value="merchants">Comercios</Tabs.Tab>
          <Tabs.Tab value="inflation">Inflación</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="trend">
          <TrendTab p={p} />
        </Tabs.Panel>
        <Tabs.Panel value="year">
          <YearTab p={p} />
        </Tabs.Panel>
        <Tabs.Panel value="savings">
          <SavingsTab p={p} />
        </Tabs.Panel>
        <Tabs.Panel value="networth">
          <NetWorthTab p={p} />
        </Tabs.Panel>
        <Tabs.Panel value="people">
          <PeopleTab currency={currency} />
        </Tabs.Panel>
        <Tabs.Panel value="merchants">
          <MerchantsTab p={p} />
        </Tabs.Panel>
        <Tabs.Panel value="inflation">
          <InflationTab scope={scope} />
        </Tabs.Panel>
      </Tabs>
    </>
  );
}
