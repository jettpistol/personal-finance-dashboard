import { useState, type ReactNode } from 'react';
import { Alert, Anchor, Button, Card, Grid, Group, Progress, Skeleton, Stack, Text, Title, Tooltip } from '@mantine/core';
import { Sparkline } from '@mantine/charts';
import { IconAlertTriangle, IconCalendarDue, IconPlus } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api, qs } from '../lib/api';
import { scopeName, useApp } from '../lib/app-state';
import { addMonths, currentMonth, date, money, monthName, pct } from '../lib/format';
import type { BalanceSummary, Currency, Dashboard, Goal } from '../lib/types';
import { MonthSelect, PageHeader } from '../components/Layout';
import { TxTable } from '../components/TxTable';
import type { Inflation, Trend } from '../components/ReportTabs';
import { NominalRealSwitch, Source, Variation, percentChange, realChange, sourceText, type Measure } from '../components/Informe';

export function SharedBalanceText({ balances }: { balances: BalanceSummary[] }) {
  const { me, users } = useApp();
  const lines = balances.flatMap((b) => b.settlements.map((s) => ({ ...s, currency: b.currency })));
  if (!lines.length) return <Text fw={600}>Están a mano.</Text>;
  const name = (id: number) => (id === me.id ? 'vos' : (users.find((u) => u.id === id)?.display_name ?? '?'));
  return (
    <Stack gap={4}>
      {lines.map((l, i) => (
        <Text key={i} fw={600}>
          {l.from === me.id ? (
            <>
              Le debés <span className="num pfd-down">{money(l.amount, l.currency)}</span> a {name(l.to)}
            </>
          ) : l.to === me.id ? (
            <>
              {name(l.from)} te debe <span className="num pfd-up">{money(l.amount, l.currency)}</span>
            </>
          ) : (
            <>
              {name(l.from)} le debe {money(l.amount, l.currency)} a {name(l.to)}
            </>
          )}
        </Text>
      ))}
    </Stack>
  );
}

type ReleaseRow = { label: ReactNode; value: ReactNode };

function ReleaseColumn({ label, figure, history, rows, tone }: { label: string; figure: string; history: number[]; rows: ReleaseRow[]; tone: 'navy' | 'red' | 'teal' }) {
  const color = { navy: 'navy.7', red: 'red.7', teal: 'teal.7' }[tone];
  return (
    <section>
      <Text size="sm" fw={650} c="var(--pfd-ink-2)">
        {label}
      </Text>
      <Group justify="space-between" align="flex-end" wrap="nowrap" gap="sm" mt={2}>
        <div className="pfd-release-figure num">{figure}</div>
        {history.some((v) => v !== 0) && (
          <Tooltip label="Últimos 6 meses" withArrow>
            <Sparkline w={84} h={30} data={history} color={color} curveType="linear" fillOpacity={0.12} strokeWidth={1.5} aria-label={`${label}: últimos 6 meses`} />
          </Tooltip>
        )}
      </Group>
      <dl className="pfd-release-rows">
        {rows.map((r, i) => (
          <FragmentRow key={i} label={r.label} value={r.value} />
        ))}
      </dl>
    </section>
  );
}

/** Signed money difference, green when it improves savings. */
function MoneyDelta({ cents, currency }: { cents: number | null; currency: Currency }) {
  if (cents == null) return <span style={{ color: 'var(--pfd-ink-2)' }}>—</span>;
  return <span className={`num ${cents > 0 ? 'pfd-up' : cents < 0 ? 'pfd-down' : ''}`}>{money(cents, currency, { sign: true })}</span>;
}

function FragmentRow({ label, value }: ReleaseRow) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </>
  );
}

function RankedCategories({ d, trend, infl, currency }: { d: Dashboard; trend: Trend | undefined; infl: Inflation | undefined; currency: Currency }) {
  const [measure, setMeasure] = useState<Measure>('nominal');
  const real = measure === 'real' && currency === 'ARS';
  const s = d.summary;
  const prevRow = trend?.rows.find((r) => r.month === addMonths(d.month, -1));
  const cpi = infl?.cpi_vs_prev ?? null;
  const rows = s.by_category.map((c) => {
    const prevNominal = prevRow?.categories[c.name] ?? 0;
    const prev = real && cpi != null ? Math.round(prevNominal * (1 + cpi / 100)) : prevNominal;
    return { ...c, prev, change: percentChange(c.amount, prev) };
  });
  const max = Math.max(1, ...rows.flatMap((r) => [r.amount, r.prev]));
  return (
    <Card>
      <Group justify="space-between" wrap="nowrap">
        <Title order={4}>Gasto por rubro</Title>
        <NominalRealSwitch value={measure} onChange={setMeasure} currency={currency} />
      </Group>
      {rows.length === 0 ? (
        <Text c="dimmed" size="sm">
          Todavía no hay gastos este mes. Cargá uno con «Nuevo movimiento» o importá el resumen del banco.
        </Text>
      ) : (
        <>
          <Group gap="lg" mb={6}>
            <Group gap={6}>
              <span className="pfd-swatch" style={{ background: 'var(--mantine-color-navy-7)' }} />
              <Text size="xs" c="var(--pfd-ink-2)">
                {monthName(d.month)}
              </Text>
            </Group>
            <Group gap={6}>
              <span className="pfd-swatch" style={{ border: `1px ${real ? 'dashed var(--pfd-real)' : 'solid var(--pfd-rule-strong)'}` }} />
              <Text size="xs" c="var(--pfd-ink-2)">
                {monthName(addMonths(d.month, -1))}
                {real ? ' en pesos de hoy' : ''}
              </Text>
            </Group>
          </Group>
          <div>
            {rows.map((r) => (
              <div key={r.name} className="pfd-rank-row">
                <Group gap={8} wrap="nowrap" style={{ minWidth: 0 }}>
                  <span className="pfd-swatch" style={{ background: `var(--mantine-color-${r.color ?? 'gray'}-6)` }} />
                  <Text size="sm" truncate>
                    {r.name}
                  </Text>
                </Group>
                <div className="pfd-rank-track" aria-hidden>
                  <div className="pfd-rank-bar" style={{ width: `${(r.amount / max) * 100}%`, background: 'var(--mantine-color-navy-7)' }} />
                  {r.prev > 0 && <div className="pfd-rank-ghost" data-real={real || undefined} style={{ width: `${(r.prev / max) * 100}%` }} />}
                </div>
                <Text size="sm" fw={600} ta="right" className="num">
                  {money(r.amount, currency)}
                </Text>
                <Text size="xs" ta="right" fw={600}>
                  <Variation value={r.change} goodWhenUp={false} digits={0} />
                </Text>
              </div>
            ))}
          </div>
          <Source>{sourceText(currency, { real, cpiMonth: infl?.cpi_latest_month ? monthName(infl.cpi_latest_month) : null })}</Source>
        </>
      )}
    </Card>
  );
}

function BudgetsPanel({ d }: { d: Dashboard }) {
  return (
    <Card data-bar="blue">
      <Group justify="space-between">
        <Title order={4}>Presupuestos</Title>
        <Anchor component={Link} to="/presupuestos" size="xs">
          Editar
        </Anchor>
      </Group>
      {d.budgets.length === 0 ? (
        <Text c="dimmed" size="sm">
          Sin presupuestos para este tablero.{' '}
          <Anchor component={Link} to="/presupuestos">
            Definir presupuestos
          </Anchor>
        </Text>
      ) : (
        <Stack gap={10}>
          {d.budgets.slice(0, 6).map((b) => (
            <div key={b.id}>
              <Group justify="space-between" mb={3} wrap="nowrap">
                <Text size="sm" truncate>
                  {b.category_name}
                </Text>
                <Text size="xs" className="num" fw={600} c={b.pct >= 100 ? 'red.8' : b.pct >= 80 ? 'ocre.8' : 'var(--pfd-ink-2)'}>
                  {money(b.spent, b.currency, { compact: true })} / {money(b.amount, b.currency, { compact: true })}
                </Text>
              </Group>
              <Progress value={Math.min(100, b.pct)} color={b.pct >= 100 ? 'red.7' : b.pct >= 80 ? 'ocre.5' : 'teal.7'} size={8} aria-label={`${b.category_name}: ${pct(b.pct, 0)}`} />
            </div>
          ))}
        </Stack>
      )}
    </Card>
  );
}

export function DashboardPage() {
  const { scope, currency, users, me, openTx } = useApp();
  const [month, setMonth] = useState(currentMonth());
  const q = useQuery({ queryKey: ['dashboard', scope, currency, month], queryFn: () => api.get<Dashboard>(`/dashboard${qs({ scope, currency, month })}`) });
  const trend = useQuery({
    queryKey: ['reports', 'trend', scope, currency, month],
    queryFn: () => api.get<Trend>(`/reports/trend${qs({ scope, currency, from: addMonths(month, -5), to: month })}`),
  });
  const infl = useQuery({ queryKey: ['reports', 'inflation', scope, month], queryFn: () => api.get<Inflation>(`/reports/inflation${qs({ scope, month })}`) });
  const goals = useQuery({ queryKey: ['goals'], queryFn: () => api.get<Goal[]>('/goals') });
  const d = q.data;

  if (q.error) return <Alert color="red">{(q.error as Error).message}</Alert>;
  if (!d) {
    return (
      <Stack>
        <Skeleton h={40} w={320} />
        <Skeleton h={150} />
        <Skeleton h={320} />
      </Stack>
    );
  }

  const s = d.summary;
  const inflow = s.income + Math.max(0, s.contributions);
  const prevInflow = d.previous.income + Math.max(0, d.previous.contributions);
  const hist = trend.data?.rows ?? [];
  const cpi = currency === 'ARS' ? (infl.data?.cpi_vs_prev ?? null) : null;
  const expenseChange = percentChange(s.expense, d.previous.expense);
  const inflowChange = percentChange(inflow, prevInflow);
  const scopeGoals = (goals.data ?? []).filter((g) => g.scope === scope && !g.archived).slice(0, 3);
  const empty = s.count === 0 && d.accounts.length === 0;
  const estimated = currency === 'ARS' && infl.data != null && infl.data.cpi_month == null;
  const realLabel = (
    <>
      Var. real{estimated && <span className="pfd-note-mark">(e)</span>}
    </>
  );

  return (
    <>
      <PageHeader
        title={`Informe de ${monthName(month).toLowerCase()}`}
        description={`${scopeName(scope, users, me.id)} · montos en ${currency}${d.fx ? ` · dólar BNA vendedor ${money(Math.round(d.fx.sell * 100), 'ARS')} (${date(d.fx.date, 'D MMM')})` : ''}`}
        actions={<MonthSelect value={month} onChange={setMonth} />}
      />

      {empty && (
        <Alert color="navy" mb="md" title="Primeros pasos">
          Creá sus cuentas en <Anchor component={Link} to="/cuentas">Cuentas</Anchor> (la común y las de cada uno), revisá categorías y presupuestos, y cargá
          movimientos a mano o importando el resumen del banco en <Anchor component={Link} to="/importar">Importar</Anchor>.
        </Alert>
      )}
      {s.missing_rates && (
        <Alert color="ocre" icon={<IconAlertTriangle size={16} />} mb="md">
          Faltan cotizaciones del dólar BNA para convertir algunos movimientos. Cargalas en <Anchor component={Link} to="/ajustes">Ajustes</Anchor>.
        </Alert>
      )}
      {d.pending > 0 && (
        <Alert color="ocre" icon={<IconCalendarDue size={16} />} mb="md">
          {d.pending === 1 ? 'Hay 1 movimiento recurrente' : `Hay ${d.pending} movimientos recurrentes`} para confirmar.{' '}
          <Anchor component={Link} to="/recurrentes" fw={600}>
            Revisar ahora
          </Anchor>
        </Alert>
      )}

      <div className="pfd-release" role="group" aria-label="Resumen del mes">
        <ReleaseColumn
          label="Gastos"
          figure={money(s.expense, currency)}
          tone="red"
          history={hist.map((r) => r.expense / 100)}
          rows={[
            { label: 'Var. mensual', value: <Variation value={expenseChange} goodWhenUp={false} /> },
            { label: realLabel, value: <Variation value={realChange(expenseChange, cpi)} goodWhenUp={false} /> },
            { label: 'Mes anterior', value: <span className="num">{money(d.previous.expense, currency)}</span> },
          ]}
        />
        <ReleaseColumn
          label={s.contributions > 0 ? 'Ingresos y aportes' : 'Ingresos'}
          figure={money(inflow, currency)}
          tone="teal"
          history={hist.map((r) => (r.income + Math.max(0, r.contributions)) / 100)}
          rows={[
            { label: 'Var. mensual', value: <Variation value={inflowChange} goodWhenUp /> },
            { label: realLabel, value: <Variation value={realChange(inflowChange, cpi)} goodWhenUp /> },
            s.contributions
              ? { label: s.contributions > 0 ? 'De aportes al pozo' : 'Aportaste al hogar', value: <span className="num">{money(Math.abs(s.contributions), currency)}</span> }
              : { label: 'Mes anterior', value: <span className="num">{money(prevInflow, currency)}</span> },
          ]}
        />
        <ReleaseColumn
          label="Ahorro del mes"
          figure={money(s.net, currency)}
          tone="navy"
          history={hist.map((r) => r.net / 100)}
          rows={[
            { label: 'Vs. mes anterior', value: <MoneyDelta cents={s.net - d.previous.net} currency={currency} /> },
            { label: realLabel, value: <MoneyDelta cents={cpi == null ? null : s.net - Math.round(d.previous.net * (1 + cpi / 100))} currency={currency} /> },
            { label: 'Tasa de ahorro', value: <span className={`num ${s.net < 0 ? 'pfd-down' : ''}`}>{pct(s.savings_rate)} <span style={{ color: 'var(--pfd-ink-2)', fontWeight: 400 }}>(ant. {pct(d.previous.savings_rate)})</span></span> },
          ]}
        />
      </div>
      <Source>
        {sourceText(currency, { real: currency === 'ARS', cpiMonth: infl.data?.cpi_latest_month ? monthName(infl.data.cpi_latest_month) : null })}
        {d.fx ? ` · dólar BNA vendedor ${money(Math.round(d.fx.sell * 100), 'ARS')} (${date(d.fx.date, 'D MMM')})` : ''}
        {estimated ? ' · (e) estimado: el IPC de este mes todavía no se publicó y la variación real usa el último dato' : ''}
      </Source>

      <Grid gutter="md" mt="lg">
        <Grid.Col span={{ base: 12, md: 7 }}>
          <Stack gap="md">
            <RankedCategories d={d} trend={trend.data} infl={infl.data} currency={currency} />
            <Card>
              <Group justify="space-between" wrap="nowrap">
                <Title order={4}>Últimos movimientos</Title>
                <Group gap="sm" wrap="nowrap">
                  <Button size="compact-xs" className="pfd-rail-btn" leftSection={<IconPlus size={12} />} onClick={() => openTx()}>
                    Agregar
                  </Button>
                  <Anchor component={Link} to="/movimientos" size="xs">
                    Ver todos
                  </Anchor>
                </Group>
              </Group>
              <TxTable rows={d.recent} compact />
            </Card>
          </Stack>
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 5 }}>
          <Stack gap="md">
            <BudgetsPanel d={d} />
            <Card data-bar="blue">
              <Group justify="space-between">
                <Title order={4}>Saldo compartido</Title>
                <Anchor component={Link} to="/saldos" size="xs">
                  Detalle
                </Anchor>
              </Group>
              <SharedBalanceText balances={d.balances} />
            </Card>
            <Card data-bar="blue">
              <Group justify="space-between">
                <Title order={4}>Cuentas</Title>
                <Text size="xs" fw={600} className="num" c="var(--pfd-ink-2)">
                  Total {money(d.accounts_total, currency)}
                </Text>
              </Group>
              {d.accounts.length === 0 ? (
                <Text c="dimmed" size="sm">
                  Sin cuentas en este tablero.
                </Text>
              ) : (
                <Stack gap={6}>
                  {d.accounts.map((a) => (
                    <Group key={a.id} justify="space-between" wrap="nowrap">
                      <Text size="sm" truncate>
                        {a.name}
                      </Text>
                      <Tooltip label={`${money(a.converted, currency)} al dólar BNA de hoy`} disabled={a.currency === currency}>
                        <Text size="sm" fw={600} className={`num ${a.balance < 0 ? 'pfd-down' : ''}`}>
                          {money(a.balance, a.currency)}
                        </Text>
                      </Tooltip>
                    </Group>
                  ))}
                </Stack>
              )}
            </Card>

            {d.upcoming_installments.length > 0 && (
              <Card data-bar="blue">
                <Title order={4}>Cuotas comprometidas</Title>
                <Stack gap={6}>
                  {d.upcoming_installments.map((u) => (
                    <Group key={u.month} justify="space-between">
                      <Text size="sm">{monthName(u.month)}</Text>
                      <Text size="sm" fw={600} className="num">
                        {money(u.amount, currency)}
                      </Text>
                    </Group>
                  ))}
                </Stack>
              </Card>
            )}

            {scopeGoals.length > 0 && (
              <Card data-bar="blue">
                <Group justify="space-between">
                  <Title order={4}>Metas de ahorro</Title>
                  <Anchor component={Link} to="/metas" size="xs">
                    Ver metas
                  </Anchor>
                </Group>
                <Stack gap="sm">
                  {scopeGoals.map((g) => (
                    <div key={g.id}>
                      <Group justify="space-between" mb={3} wrap="nowrap">
                        <Text size="sm" fw={600} truncate>
                          {g.name}
                        </Text>
                        <Text size="xs" fw={700} className="num">
                          {pct(g.pct, 0)}
                        </Text>
                      </Group>
                      <Progress value={g.pct} color="navy.7" size={8} aria-label={`${g.name}: ${pct(g.pct, 0)}`} />
                      <Text size="xs" c="var(--pfd-ink-2)" mt={3} className="num">
                        {money(g.saved, g.currency)} de {money(g.target_amount, g.currency)}
                        {g.monthly_needed ? ` · faltan ${money(g.monthly_needed, g.currency)} por mes` : ''}
                      </Text>
                    </div>
                  ))}
                </Stack>
              </Card>
            )}
          </Stack>
        </Grid.Col>

      </Grid>
    </>
  );
}
