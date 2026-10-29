import { useMemo, useState } from 'react';
import { Alert, Badge, Card, Group, Loader, Progress, ScrollArea, Select, SimpleGrid, Stack, Table, Text, Title } from '@mantine/core';
import { AreaChart, BarChart, LineChart } from '@mantine/charts';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api, qs } from '../lib/api';
import { ACCOUNT_TYPE_LABEL, addMonths, currentMonth, money, monthName, pct } from '../lib/format';
import type { AccountType, Currency, FeeKind, Scope } from '../lib/types';
import { FEE_KINDS, FEE_LABELS } from '../lib/fees';
import { MonthSelect } from './Layout';
import { Delta, Empty, Kpi, MissingRatesAlert, RealPct, axisK, change, unitFormatter, units } from './ReportBits';

// ---- API shapes (see server/src/lib/reports.ts) ----

export type TrendRow = {
  month: string;
  income: number;
  /** + money into the joint pot (household) / - money handed to it (personal). */
  contributions: number;
  expense: number;
  net: number;
  savings_rate: number | null;
  cpi_pct: number | null;
  categories: Record<string, number>;
};
export type Trend = { rows: TrendRow[]; categories: { name: string; color: string | null }[]; missing_rates: boolean };
type Yearly = Trend & { year: number; totals: { income: number; contributions: number; expense: number; net: number; savings_rate: number | null; categories: Record<string, number> } };
type NetWorth = { rows: { month: string; total: number; by_type: Record<string, number>; assets: number; liabilities: number }[]; accounts: { id: number; name: string; type: AccountType; currency: Currency }[] };
type Person = { user_id: number; name: string; color: string; personal: number | null; shared_share: number; total: number | null; paid_for_shared: number; income: number | null };
type Merchant = { name: string; amount: number; count: number; average: number; category: string | null };
export type Inflation = {
  month: string;
  cpi_latest_month: string | null;
  cpi_month: number | null;
  cpi_vs_prev: number | null;
  cpi_vs_year: number | null;
  total: { amount: number; previous: number; year_ago: number; nominal_vs_prev: number | null; real_vs_prev: number | null; nominal_vs_year: number | null; real_vs_year: number | null };
  categories: {
    category_id: number | null;
    name: string;
    amount: number;
    previous: number;
    year_ago: number;
    nominal_vs_prev: number | null;
    real_vs_prev: number | null;
    nominal_vs_year: number | null;
    real_vs_year: number | null;
  }[];
  history: { month: string; cpi_pct: number | null }[];
};

export type ReportParams = { scope: Scope; currency: Currency; real: boolean; from: string; to: string };

const MAX_SERIES = 7;
const OTHER = 'Otros';

/**
 * Categories in a fixed order (by total over the period, largest first). Beyond 7 series the
 * rest fold into "Otros" so the stacked bars stay readable and colors never cycle.
 */
function foldCategories(trend: Trend) {
  const totals = new Map<string, number>();
  for (const r of trend.rows) for (const [k, v] of Object.entries(r.categories)) totals.set(k, (totals.get(k) ?? 0) + v);
  const ordered = [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
  const keep = ordered.length > MAX_SERIES + 1 ? ordered.slice(0, MAX_SERIES) : ordered;
  const colorOf = new Map(trend.categories.map((c) => [c.name, c.color ?? 'gray']));
  const series = keep.map((name) => ({ name, color: `${colorOf.get(name) ?? 'gray'}.6` }));
  const folded = keep.length < ordered.length;
  if (folded) series.push({ name: OTHER, color: 'gray.5' });
  const data = trend.rows.map((r) => {
    const row: Record<string, number | string> = { month: monthName(r.month, true) };
    let other = 0;
    for (const [k, v] of Object.entries(r.categories)) {
      if (keep.includes(k)) row[k] = units(v);
      else other += v;
    }
    if (folded) row[OTHER] = units(other);
    return row;
  });
  return { series, data, ordered };
}

/** Money coming in: income plus contributions into the joint pot (household scope). */
const inflow = (r: { income: number; contributions: number }) => r.income + Math.max(0, r.contributions ?? 0);
const contribLabel = (rows: { contributions: number }[]) => (rows.some((r) => r.contributions > 0) ? 'Aportes al pozo común' : 'Aportes al hogar');

function useReport<T>(key: string, url: string, enabled = true) {
  return useQuery({ queryKey: ['reports', key, url], queryFn: () => api.get<T>(url), enabled });
}

function Loading() {
  return (
    <Group justify="center" py="xl">
      <Loader />
    </Group>
  );
}

// ---- Tendencia ----

export function TrendTab({ p }: { p: ReportParams }) {
  const q = useReport<Trend>('trend', `/reports/trend${qs(p)}`);
  const fmt = unitFormatter(p.currency, true);
  const folded = useMemo(() => (q.data ? foldCategories(q.data) : null), [q.data]);
  if (!q.data || !folded) return <Loading />;
  const t = q.data;
  if (t.rows.every((r) => !r.expense && !inflow(r))) return <Empty />;
  const flows = t.rows.map((r) => ({ month: monthName(r.month, true), Ingresos: units(inflow(r)), Gastos: units(r.expense) }));
  const hasContrib = t.rows.some((r) => r.contributions);
  const months = t.rows.slice(-6);
  return (
    <Stack>
      <MissingRatesAlert show={t.missing_rates} />
      <Card>
        <Title order={5} mb={4}>
          Gastos por categoría
        </Title>
        <BarChart h={320} data={folded.data} dataKey="month" type="stacked" series={folded.series} valueFormatter={fmt} yAxisProps={axisK(p.currency)} withLegend legendProps={{ verticalAlign: 'bottom' }} gridAxis="y" maxBarWidth={44} />
      </Card>
      <Card>
        <Title order={5} mb="md">
          {t.rows.some((r) => r.contributions > 0) ? 'Ingresos (con aportes al pozo común) y gastos' : 'Ingresos y gastos'}
        </Title>
        <BarChart
          h={260}
          data={flows}
          dataKey="month"
          series={[
            { name: 'Ingresos', color: 'teal.6' },
            { name: 'Gastos', color: 'red.6' },
          ]}
          valueFormatter={fmt}
          yAxisProps={axisK(p.currency)}
          withLegend
          legendProps={{ verticalAlign: 'bottom' }}
          gridAxis="y"
          maxBarWidth={28}
        />
      </Card>
      <Card>
        <Title order={5} mb="md">
          Detalle por mes (últimos {months.length})
        </Title>
        <Table.ScrollContainer minWidth={640}>
          <Table striped verticalSpacing={6} fz="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Categoría</Table.Th>
                {months.map((r) => (
                  <Table.Th key={r.month} ta="right">
                    {monthName(r.month, true)}
                  </Table.Th>
                ))}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {folded.ordered.map((name) => (
                <Table.Tr key={name}>
                  <Table.Td fw={500}>{name}</Table.Td>
                  {months.map((r, i) => {
                    const v = r.categories[name] ?? 0;
                    const prevRow = i > 0 ? months[i - 1] : t.rows[t.rows.indexOf(r) - 1];
                    return (
                      <Table.Td key={r.month} ta="right">
                        <Text size="sm" className="num">
                          {money(v, p.currency, { compact: true })}
                        </Text>
                        {prevRow && <Group justify="flex-end"><Delta value={change(v, prevRow.categories[name] ?? 0)} goodWhenUp={false} /></Group>}
                      </Table.Td>
                    );
                  })}
                </Table.Tr>
              ))}
              <Table.Tr fw={700}>
                <Table.Td fw={700}>Total gastos</Table.Td>
                {months.map((r) => (
                  <Table.Td key={r.month} ta="right" className="num" fw={700}>
                    {money(r.expense, p.currency, { compact: true })}
                  </Table.Td>
                ))}
              </Table.Tr>
              <Table.Tr>
                <Table.Td fw={700}>Ingresos</Table.Td>
                {months.map((r) => (
                  <Table.Td key={r.month} ta="right" className="num" c="teal.7" fw={600}>
                    {money(r.income, p.currency, { compact: true })}
                  </Table.Td>
                ))}
              </Table.Tr>
              {hasContrib && (
                <Table.Tr>
                  <Table.Td fw={700}>{contribLabel(t.rows)}</Table.Td>
                  {months.map((r) => (
                    <Table.Td key={r.month} ta="right" className="num" fw={600}>
                      {money(r.contributions, p.currency, { compact: true })}
                    </Table.Td>
                  ))}
                </Table.Tr>
              )}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Card>
    </Stack>
  );
}

// ---- Anual ----

export function YearTab({ p }: { p: ReportParams }) {
  const thisYear = Number(currentMonth().slice(0, 4));
  const [year, setYear] = useState(thisYear);
  const q = useReport<Yearly>('yearly', `/reports/yearly${qs({ scope: p.scope, currency: p.currency, real: p.real, year })}`);
  const years = Array.from({ length: 6 }, (_, i) => String(thisYear - i));
  const y = q.data;
  const cats = useMemo(() => (y ? Object.entries(y.totals.categories).sort((a, b) => b[1] - a[1]) : []), [y]);
  const max = useMemo(() => (y ? Math.max(1, ...y.rows.flatMap((r) => Object.values(r.categories))) : 1), [y]);
  return (
    <Stack>
      <Group>
        <Select size="xs" w={110} data={years} value={String(year)} onChange={(v) => v && setYear(Number(v))} allowDeselect={false} aria-label="Año" />
      </Group>
      {!y ? (
        <Loading />
      ) : (
        <>
          <MissingRatesAlert show={y.missing_rates} />
          <SimpleGrid cols={{ base: 2, sm: 4 }}>
            <Kpi
              label={y.totals.contributions > 0 ? 'Ingresos y aportes' : 'Ingresos'}
              value={money(y.totals.income + Math.max(0, y.totals.contributions), p.currency)}
              hint={y.totals.contributions ? `${contribLabel([y.totals])}: ${money(y.totals.contributions, p.currency)}` : undefined}
            />
            <Kpi label="Gastos" value={money(y.totals.expense, p.currency)} />
            <Kpi label="Ahorro" value={money(y.totals.net, p.currency)} />
            <Kpi label="Tasa de ahorro" value={pct(y.totals.savings_rate)} />
          </SimpleGrid>
          {!cats.length ? (
            <Empty />
          ) : (
            <Card>
              <Title order={5} mb={4}>
                Gastos por mes y categoría
              </Title>
              <Table.ScrollContainer minWidth={900}>
                <Table verticalSpacing={4} fz="xs" withColumnBorders>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Categoría</Table.Th>
                      {y.rows.map((r) => (
                        <Table.Th key={r.month} ta="right">
                          {monthName(r.month, true).split(' ')[0]}
                        </Table.Th>
                      ))}
                      <Table.Th ta="right">Total</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {cats.map(([name, total]) => (
                      <Table.Tr key={name}>
                        <Table.Td fw={500} style={{ whiteSpace: 'nowrap' }}>
                          {name}
                        </Table.Td>
                        {y.rows.map((r) => {
                          const v = r.categories[name] ?? 0;
                          const alpha = v ? 0.08 + (v / max) * 0.5 : 0;
                          return (
                            <Table.Td key={r.month} ta="right" className="num" style={{ background: v ? `rgba(34, 139, 230, ${alpha.toFixed(2)})` : undefined }}>
                              {v ? money(v, p.currency, { compact: true }) : ''}
                            </Table.Td>
                          );
                        })}
                        <Table.Td ta="right" className="num" fw={700}>
                          {money(total, p.currency, { compact: true })}
                        </Table.Td>
                      </Table.Tr>
                    ))}
                    <Table.Tr>
                      <Table.Td fw={700}>Total</Table.Td>
                      {y.rows.map((r) => (
                        <Table.Td key={r.month} ta="right" className="num" fw={700}>
                          {r.expense ? money(r.expense, p.currency, { compact: true }) : ''}
                        </Table.Td>
                      ))}
                      <Table.Td ta="right" className="num" fw={800}>
                        {money(y.totals.expense, p.currency, { compact: true })}
                      </Table.Td>
                    </Table.Tr>
                    <Table.Tr>
                      <Table.Td fw={700}>Ingresos</Table.Td>
                      {y.rows.map((r) => (
                        <Table.Td key={r.month} ta="right" className="num" c="teal.7">
                          {inflow(r) ? money(inflow(r), p.currency, { compact: true }) : ''}
                        </Table.Td>
                      ))}
                      <Table.Td ta="right" className="num" fw={800} c="teal.7">
                        {money(y.totals.income + Math.max(0, y.totals.contributions), p.currency, { compact: true })}
                      </Table.Td>
                    </Table.Tr>
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            </Card>
          )}
        </>
      )}
    </Stack>
  );
}

// ---- Ahorro ----

export function SavingsTab({ p }: { p: ReportParams }) {
  const q = useReport<Trend>('trend', `/reports/trend${qs(p)}`);
  if (!q.data) return <Loading />;
  const rows = q.data.rows;
  const withIncome = rows.filter((r) => inflow(r) > 0);
  const totalIncome = withIncome.reduce((a, r) => a + inflow(r), 0);
  const totalNet = withIncome.reduce((a, r) => a + r.net, 0);
  const avgRate = totalIncome > 0 ? (totalNet / totalIncome) * 100 : null;
  const best = [...withIncome].sort((a, b) => (b.savings_rate ?? -1e9) - (a.savings_rate ?? -1e9))[0];
  const rateData = rows.map((r) => ({ month: monthName(r.month, true), 'Tasa de ahorro': r.savings_rate ?? 0 }));
  const netData = rows.map((r) => ({ month: monthName(r.month, true), Ahorro: units(r.net) }));
  if (!withIncome.length) return <Empty>Registrá ingresos para ver tu tasa de ahorro.</Empty>;
  return (
    <Stack>
      <MissingRatesAlert show={q.data.missing_rates} />
      <SimpleGrid cols={{ base: 1, sm: 3 }}>
        <Kpi label="Tasa de ahorro promedio" value={pct(avgRate)} hint="Ahorro total del período dividido por los ingresos totales." />
        <Kpi label="Ahorro acumulado" value={money(totalNet, p.currency)} />
        <Kpi label="Mejor mes" value={best ? monthName(best.month) : '—'}>
          <Text size="xs" c="dimmed">
            {best ? `Ahorraron el ${pct(best.savings_rate)} de los ingresos` : ''}
          </Text>
        </Kpi>
      </SimpleGrid>
      <Card>
        <Title order={5} mb={4}>
          Tasa de ahorro por mes
        </Title>
        <BarChart
          h={260}
          data={rateData}
          dataKey="month"
          series={[{ name: 'Tasa de ahorro', color: 'blue.6' }]}
          getBarColor={(v) => (v < 0 ? 'red.6' : 'blue.6')}
          valueFormatter={(v) => pct(v)}
          referenceLines={[{ y: 0, color: 'gray.6' }]}
          gridAxis="y"
          maxBarWidth={32}
        />
      </Card>
      <Card>
        <Title order={5} mb="md">
          Ahorro neto por mes (ingresos − gastos)
        </Title>
        <BarChart
          h={240}
          data={netData}
          dataKey="month"
          series={[{ name: 'Ahorro', color: 'teal.6' }]}
          getBarColor={(v) => (v < 0 ? 'red.6' : 'teal.6')}
          valueFormatter={unitFormatter(p.currency, true)}
          yAxisProps={axisK(p.currency)}
          referenceLines={[{ y: 0, color: 'gray.6' }]}
          gridAxis="y"
          maxBarWidth={32}
        />
      </Card>
    </Stack>
  );
}

// ---- Patrimonio ----

const TYPE_COLORS: Record<string, string> = {
  bank: 'blue.6',
  savings: 'teal.6',
  investment: 'grape.6',
  wallet: 'cyan.6',
  cash: 'lime.6',
  credit_card: 'red.6',
};

export function NetWorthTab({ p }: { p: ReportParams }) {
  const q = useReport<NetWorth>('net-worth', `/reports/net-worth${qs({ scope: p.scope, currency: p.currency, from: p.from, to: p.to })}`);
  if (!q.data) return <Loading />;
  const nw = q.data;
  if (!nw.accounts.length) return <Empty>No hay cuentas en este ámbito.</Empty>;
  const last = nw.rows.at(-1)!;
  const first = nw.rows[0];
  const types = [...new Set(nw.rows.flatMap((r) => Object.keys(r.by_type)))].filter((t) => nw.rows.some((r) => r.by_type[t]));
  const fmt = unitFormatter(p.currency, true);
  const totalData = nw.rows.map((r) => ({ month: monthName(r.month, true), Patrimonio: units(r.total) }));
  const typeData = nw.rows.map((r) => ({ month: monthName(r.month, true), ...Object.fromEntries(types.map((t) => [ACCOUNT_TYPE_LABEL[t as AccountType] ?? t, units(r.by_type[t] ?? 0)])) }));
  const flowData = nw.rows.map((r) => ({ month: monthName(r.month, true), Activos: units(r.assets), Deudas: units(Math.abs(r.liabilities)) }));
  return (
    <Stack>
      <SimpleGrid cols={{ base: 1, sm: 3 }}>
        <Kpi label="Patrimonio actual" value={money(last.total, p.currency)}>
          <Delta value={change(last.total, first.total)} goodWhenUp suffix={`desde ${monthName(first.month, true)}`} />
        </Kpi>
        <Kpi label="Activos" value={money(last.assets, p.currency)} />
        <Kpi label="Deudas (tarjetas, saldos negativos)" value={money(Math.abs(last.liabilities), p.currency)} />
      </SimpleGrid>
      <Card>
        <Title order={5} mb={4}>
          Evolución del patrimonio
        </Title>
        <AreaChart h={260} data={totalData} dataKey="month" series={[{ name: 'Patrimonio', color: 'blue.6' }]} valueFormatter={fmt} yAxisProps={axisK(p.currency)} curveType="monotone" gridAxis="y" withDots={false} />
      </Card>
      <SimpleGrid cols={{ base: 1, md: 2 }}>
        <Card>
          <Title order={5} mb="md">
            Por tipo de cuenta
          </Title>
          <BarChart
            h={260}
            data={typeData}
            dataKey="month"
            type="stacked"
            series={types.map((t) => ({ name: ACCOUNT_TYPE_LABEL[t as AccountType] ?? t, color: TYPE_COLORS[t] ?? 'gray.6' }))}
            valueFormatter={fmt}
            yAxisProps={axisK(p.currency)}
            withLegend
            legendProps={{ verticalAlign: 'bottom' }}
            gridAxis="y"
            maxBarWidth={32}
          />
        </Card>
        <Card>
          <Title order={5} mb="md">
            Activos y deudas
          </Title>
          <LineChart
            h={260}
            data={flowData}
            dataKey="month"
            series={[
              { name: 'Activos', color: 'teal.6' },
              { name: 'Deudas', color: 'red.6' },
            ]}
            valueFormatter={fmt}
            yAxisProps={axisK(p.currency)}
            withLegend
            legendProps={{ verticalAlign: 'bottom' }}
            curveType="monotone"
            gridAxis="y"
          />
        </Card>
      </SimpleGrid>
    </Stack>
  );
}

// ---- Por persona ----

export function PeopleTab({ currency }: { currency: Currency }) {
  const [from, setFrom] = useState(currentMonth());
  const [to, setTo] = useState(currentMonth());
  const range = from <= to ? { from, to } : { from: to, to: from };
  const q = useReport<Person[]>('per-person', `/reports/per-person${qs({ ...range, currency })}`);
  const people = q.data;
  const fmt = unitFormatter(currency, true);
  const show = (v: number | null) => (v == null ? 'Privado' : money(v, currency));
  return (
    <Stack>
      <Group gap="xs">
        <Text size="sm">Desde</Text>
        <MonthSelect value={from} onChange={setFrom} />
        <Text size="sm">hasta</Text>
        <MonthSelect value={to} onChange={setTo} />
      </Group>
      {!people ? (
        <Loading />
      ) : (
        <>
          <SimpleGrid cols={{ base: 1, sm: Math.min(people.length, 3) }}>
            {people.map((u) => (
              <Card key={u.user_id}>
                <Text fw={700} size="lg">
                  {u.name}
                </Text>
                <Stack gap={6} mt="sm">
                  <Row label="Ingresos" value={show(u.income)} />
                  <Row label="Gastos personales" value={show(u.personal)} />
                  <Row label="Su parte de lo compartido" value={money(u.shared_share, currency)} />
                  <Row label="Pagó de lo compartido" value={money(u.paid_for_shared, currency)} />
                  <Row label="Gasto total" value={show(u.total)} strong />
                </Stack>
              </Card>
            ))}
          </SimpleGrid>
          <Card>
            <Title order={5} mb={4}>
              Gastos compartidos: parte de cada uno vs. lo que pagó
            </Title>
            <BarChart
              h={240}
              data={people.map((u) => ({ name: u.name, 'Su parte': units(u.shared_share), 'Pagó': units(u.paid_for_shared) }))}
              dataKey="name"
              series={[
                { name: 'Su parte', color: 'grape.6' },
                { name: 'Pagó', color: 'blue.6' },
              ]}
              valueFormatter={fmt}
              yAxisProps={axisK(currency)}
              withLegend
              legendProps={{ verticalAlign: 'bottom' }}
              gridAxis="y"
              maxBarWidth={48}
            />
          </Card>
        </>
      )}
    </Stack>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <Group justify="space-between" wrap="nowrap">
      <Text size="sm" c="dimmed">
        {label}
      </Text>
      <Text size="sm" fw={strong ? 800 : 600} className="num" c={value === 'Privado' ? 'dimmed' : undefined}>
        {value}
      </Text>
    </Group>
  );
}

// ---- Comercios ----

export function MerchantsTab({ p }: { p: ReportParams }) {
  const q = useReport<Merchant[]>('merchants', `/reports/merchants${qs({ scope: p.scope, currency: p.currency, from: p.from, to: p.to })}`);
  if (!q.data) return <Loading />;
  const rows = q.data;
  if (!rows.length) return <Empty />;
  const top = rows.slice(0, 10);
  const total = rows.reduce((a, r) => a + r.amount, 0);
  return (
    <Stack>
      <Card>
        <Title order={5} mb="md">
          Top 10 comercios
        </Title>
        <BarChart
          h={Math.max(220, top.length * 34)}
          data={top.map((r) => ({ name: r.name.length > 28 ? `${r.name.slice(0, 27)}…` : r.name, Total: units(r.amount) }))}
          dataKey="name"
          orientation="vertical"
          series={[{ name: 'Total', color: 'blue.6' }]}
          valueFormatter={unitFormatter(p.currency, true)}
          xAxisProps={axisK(p.currency)}
          yAxisProps={{ width: 170 }}
          gridAxis="x"
          maxBarWidth={22}
        />
      </Card>
      <Card>
        <ScrollArea>
          <Table verticalSpacing={6} fz="sm" miw={560}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Comercio / descripción</Table.Th>
                <Table.Th>Categoría</Table.Th>
                <Table.Th ta="right">Veces</Table.Th>
                <Table.Th ta="right">Promedio</Table.Th>
                <Table.Th ta="right">Total</Table.Th>
                <Table.Th w={110}>% del total</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.map((r) => (
                <Table.Tr key={r.name}>
                  <Table.Td fw={500}>{r.name}</Table.Td>
                  <Table.Td>
                    <Text size="xs" c="dimmed">
                      {r.category ?? '—'}
                    </Text>
                  </Table.Td>
                  <Table.Td ta="right" className="num">
                    {r.count}
                  </Table.Td>
                  <Table.Td ta="right" className="num">
                    {money(r.average, p.currency)}
                  </Table.Td>
                  <Table.Td ta="right" className="num" fw={600}>
                    {money(r.amount, p.currency)}
                  </Table.Td>
                  <Table.Td>
                    <Progress value={total ? (r.amount / total) * 100 : 0} size="sm" aria-label={`${pct(total ? (r.amount / total) * 100 : 0)} del total`} />
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </ScrollArea>
      </Card>
    </Stack>
  );
}

// ---- Inflación ----

export function InflationTab({ scope }: { scope: Scope }) {
  const [month, setMonth] = useState(addMonths(currentMonth(), -1));
  const q = useReport<Inflation>('inflation', `/reports/inflation${qs({ scope, month })}`);
  const d = q.data;
  return (
    <Stack>
      <Group gap="xs">
        <MonthSelect value={month} onChange={setMonth} />
        <Text size="xs" c="dimmed">
          Montos en pesos.
        </Text>
      </Group>
      {!d ? (
        <Loading />
      ) : !d.cpi_latest_month ? (
        <Alert color="blue" title="Faltan los datos de inflación">
          Todavía no hay IPC cargado. Actualizalo o cargalo a mano en{' '}
          <Text component={Link} to="/ajustes" inherit fw={600}>
            Ajustes → Inflación
          </Text>
          .
        </Alert>
      ) : (
        <>
          {d.cpi_month == null && (
            <Alert color="yellow">
              El INDEC todavía no publicó el IPC de {monthName(month)}. Se usa el último dato disponible ({monthName(d.cpi_latest_month)}).
            </Alert>
          )}
          <SimpleGrid cols={{ base: 2, sm: 4 }}>
            <Kpi label={`IPC de ${monthName(month, true)}`} value={pct(d.cpi_month)} hint="Inflación mensual oficial (INDEC)." />
            <Kpi label="Inflación interanual" value={pct(d.cpi_vs_year)} hint="Inflación acumulada entre el mismo mes del año pasado y este." />
            <Kpi label="Tu gasto vs mes anterior" value={pct(d.total.nominal_vs_prev, 1, true)}>
              <Group gap={4}>
                <Text size="xs" c="dimmed">
                  Real:
                </Text>
                <RealPct value={d.total.real_vs_prev} />
              </Group>
            </Kpi>
            <Kpi label="Tu gasto vs hace un año" value={pct(d.total.nominal_vs_year, 1, true)}>
              <Group gap={4}>
                <Text size="xs" c="dimmed">
                  Real:
                </Text>
                <RealPct value={d.total.real_vs_year} />
              </Group>
            </Kpi>
          </SimpleGrid>
          <Card padding="md">
            <Text size="sm">
              <b>Cómo leerlo:</b> la variación <i>nominal</i> es cuánto cambió lo que gastaron en pesos. La <i>real</i> descuenta la inflación:{' '}
              <Badge color="red" variant="light" size="sm">
                positiva
              </Badge>{' '}
              = gastaron más de lo que subieron los precios (consumieron más o esa categoría se encareció más que el promedio);{' '}
              <Badge color="teal" variant="light" size="sm">
                negativa
              </Badge>{' '}
              = el gasto creció menos que la inflación.
            </Text>
          </Card>
          <Card>
            <Title order={5} mb="md">
              Por categoría
            </Title>
            <Table.ScrollContainer minWidth={720}>
              <Table verticalSpacing={6} fz="sm">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th />
                    <Table.Th />
                    <Table.Th ta="center" colSpan={3} style={{ borderLeft: '1px solid var(--pfd-rule)' }}>
                      vs mes anterior
                    </Table.Th>
                    <Table.Th ta="center" colSpan={3} style={{ borderLeft: '1px solid var(--pfd-rule)' }}>
                      vs hace un año
                    </Table.Th>
                  </Table.Tr>
                  <Table.Tr>
                    <Table.Th>Categoría</Table.Th>
                    <Table.Th ta="right">{monthName(month, true)}</Table.Th>
                    <Table.Th ta="right" style={{ borderLeft: '1px solid var(--pfd-rule)' }}>Mes anterior</Table.Th>
                    <Table.Th ta="right">Nominal</Table.Th>
                    <Table.Th ta="right">Real</Table.Th>
                    <Table.Th ta="right" style={{ borderLeft: '1px solid var(--pfd-rule)' }}>Hace un año</Table.Th>
                    <Table.Th ta="right">Nominal</Table.Th>
                    <Table.Th ta="right">Real</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {d.categories.map((c) => (
                    <Table.Tr key={c.name}>
                      <Table.Td fw={500}>{c.name}</Table.Td>
                      <Table.Td ta="right" className="num">
                        {money(c.amount, 'ARS', { compact: true })}
                      </Table.Td>
                      <Table.Td ta="right" className="num" c="dimmed">
                        {money(c.previous, 'ARS', { compact: true })}
                      </Table.Td>
                      <Table.Td ta="right" className="num">
                        {pct(c.nominal_vs_prev, 1, true)}
                      </Table.Td>
                      <Table.Td>
                        <RealPct value={c.real_vs_prev} />
                      </Table.Td>
                      <Table.Td ta="right" className="num" c="dimmed">
                        {c.year_ago ? money(c.year_ago, 'ARS', { compact: true }) : 'sin dato'}
                      </Table.Td>
                      <Table.Td ta="right" className="num">
                        {pct(c.nominal_vs_year, 1, true)}
                      </Table.Td>
                      <Table.Td>
                        <RealPct value={c.real_vs_year} />
                      </Table.Td>
                    </Table.Tr>
                  ))}
                  <Table.Tr>
                    <Table.Td fw={800}>Total</Table.Td>
                    <Table.Td ta="right" className="num" fw={700}>
                      {money(d.total.amount, 'ARS', { compact: true })}
                    </Table.Td>
                    <Table.Td ta="right" className="num" c="dimmed">
                      {money(d.total.previous, 'ARS', { compact: true })}
                    </Table.Td>
                    <Table.Td ta="right" className="num" fw={700}>
                      {pct(d.total.nominal_vs_prev, 1, true)}
                    </Table.Td>
                    <Table.Td>
                      <RealPct value={d.total.real_vs_prev} />
                    </Table.Td>
                    <Table.Td ta="right" className="num" c="dimmed">
                      {d.total.year_ago ? money(d.total.year_ago, 'ARS', { compact: true }) : 'sin dato'}
                    </Table.Td>
                    <Table.Td ta="right" className="num" fw={700}>
                      {pct(d.total.nominal_vs_year, 1, true)}
                    </Table.Td>
                    <Table.Td>
                      <RealPct value={d.total.real_vs_year} />
                    </Table.Td>
                  </Table.Tr>
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          </Card>
          <Card>
            <Title order={5} mb="md">
              Inflación mensual (IPC) de los últimos 12 meses
            </Title>
            <BarChart
              h={220}
              data={d.history.filter((h) => h.cpi_pct != null).map((h) => ({ month: monthName(h.month, true), IPC: h.cpi_pct }))}
              dataKey="month"
              series={[{ name: 'IPC', color: 'ocre.6' }]}
              valueFormatter={(v) => pct(v)}
              gridAxis="y"
              maxBarWidth={28}
            />
          </Card>
        </>
      )}
    </Stack>
  );
}

type FeeReport = {
  total: number;
  months: { month: string; amount: number }[];
  platforms: { platform: string; total: number; count: number; kinds: Partial<Record<FeeKind, number>> }[];
  missing_rates: boolean;
};

/** Fees that platforms (Mercado Pago and others) took from movements, already inside their amounts. */
export function FeesTab({ p }: { p: ReportParams }) {
  const q = useReport<FeeReport>('fees', `/reports/fees${qs({ scope: p.scope, currency: p.currency, from: p.from, to: p.to })}`);
  if (!q.data) return <Loading />;
  const r = q.data;
  if (!r.platforms.length) return <Empty>No hay comisiones registradas en este período.</Empty>;
  const kinds = FEE_KINDS.filter((k) => r.platforms.some((x) => x.kinds[k]));
  return (
    <Stack>
      <MissingRatesAlert show={r.missing_rates} />
      <Card>
        <Group justify="space-between" mb="md">
          <Title order={5}>Comisiones por mes</Title>
          <Text size="sm" className="num">
            Total <b>{money(r.total, p.currency)}</b>
          </Text>
        </Group>
        <BarChart
          h={220}
          data={r.months.map((m) => ({ month: monthName(m.month, true), Comisiones: units(m.amount) }))}
          dataKey="month"
          series={[{ name: 'Comisiones', color: 'blue.6' }]}
          valueFormatter={unitFormatter(p.currency, true)}
          yAxisProps={axisK(p.currency)}
          maxBarWidth={28}
        />
      </Card>
      <Card>
        <ScrollArea>
          <Table verticalSpacing={6} fz="sm" miw={480}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Plataforma</Table.Th>
                {kinds.map((k) => (
                  <Table.Th key={k} ta="right">
                    {FEE_LABELS[k]}
                  </Table.Th>
                ))}
                <Table.Th ta="right">Movimientos</Table.Th>
                <Table.Th ta="right">Total</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {r.platforms.map((x) => (
                <Table.Tr key={x.platform}>
                  <Table.Td fw={500}>{x.platform}</Table.Td>
                  {kinds.map((k) => (
                    <Table.Td key={k} ta="right" className="num">
                      {x.kinds[k] ? money(x.kinds[k]!, p.currency) : '—'}
                    </Table.Td>
                  ))}
                  <Table.Td ta="right" className="num">
                    {x.count}
                  </Table.Td>
                  <Table.Td ta="right" className="num" fw={600}>
                    {money(x.total, p.currency)}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </ScrollArea>
      </Card>
    </Stack>
  );
}
