import { useState } from 'react';
import {
  Alert,
  Anchor,
  Badge,
  Button,
  Card,
  Grid,
  Group,
  Loader,
  Progress,
  SimpleGrid,
  Stack,
  Text,
  ThemeIcon,
  Title,
  Tooltip,
} from '@mantine/core';
import { DonutChart } from '@mantine/charts';
import { IconAlertTriangle, IconArrowDownRight, IconArrowUpRight, IconCalendarDue, IconCash, IconPigMoney, IconPlus, IconScale, IconWallet } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api, qs } from '../lib/api';
import { scopeName, useApp } from '../lib/app-state';
import { currentMonth, date, money, monthName, pct } from '../lib/format';
import type { BalanceSummary, Dashboard, Goal } from '../lib/types';
import { MonthSelect, PageHeader } from '../components/Layout';
import { TxTable } from '../components/TxTable';

function change(a: number, b: number): number | null {
  return b ? ((a - b) / Math.abs(b)) * 100 : null;
}

function Kpi({ label, value, icon: Icon, color, delta, deltaGood, hint }: { label: string; value: string; icon: typeof IconCash; color: string; delta?: number | null; deltaGood?: 'up' | 'down'; hint?: string }) {
  const good = delta == null ? null : deltaGood === 'up' ? delta >= 0 : delta <= 0;
  return (
    <Card>
      <Group justify="space-between" align="flex-start" wrap="nowrap">
        <div>
          <Text size="xs" c="dimmed" fw={700} tt="uppercase">
            {label}
          </Text>
          <Text fz={24} fw={800} className="num" mt={4}>
            {value}
          </Text>
        </div>
        <ThemeIcon variant="light" color={color} size={38} radius="md">
          <Icon size={20} />
        </ThemeIcon>
      </Group>
      {delta != null && (
        <Group gap={4} mt={6}>
          {delta >= 0 ? <IconArrowUpRight size={14} color={`var(--mantine-color-${good ? 'teal' : 'red'}-6)`} /> : <IconArrowDownRight size={14} color={`var(--mantine-color-${good ? 'teal' : 'red'}-6)`} />}
          <Text size="xs" c={good ? 'teal' : 'red'} fw={600}>
            {pct(delta, 0, true)}
          </Text>
          <Text size="xs" c="dimmed">
            vs mes anterior
          </Text>
        </Group>
      )}
      {hint && (
        <Text size="xs" c="dimmed" mt={delta != null ? 0 : 6}>
          {hint}
        </Text>
      )}
    </Card>
  );
}

export function SharedBalanceText({ balances }: { balances: BalanceSummary[] }) {
  const { me, users } = useApp();
  const lines = balances.flatMap((b) => b.settlements.map((s) => ({ ...s, currency: b.currency })));
  if (!lines.length) return <Text fw={600}>Están a mano 🎉</Text>;
  const name = (id: number) => (id === me.id ? 'vos' : (users.find((u) => u.id === id)?.display_name ?? '?'));
  return (
    <Stack gap={4}>
      {lines.map((l, i) => (
        <Text key={i} fw={600}>
          {l.from === me.id ? (
            <>
              Le debés <Text span c="red" inherit className="num">{money(l.amount, l.currency)}</Text> a {name(l.to)}
            </>
          ) : l.to === me.id ? (
            <>
              {name(l.from)} te debe <Text span c="teal" inherit className="num">{money(l.amount, l.currency)}</Text>
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

export function DashboardPage() {
  const { scope, currency, users, me, openTx } = useApp();
  const [month, setMonth] = useState(currentMonth());
  const q = useQuery({ queryKey: ['dashboard', scope, currency, month], queryFn: () => api.get<Dashboard>(`/dashboard${qs({ scope, currency, month })}`) });
  const goals = useQuery({ queryKey: ['goals'], queryFn: () => api.get<Goal[]>('/goals') });
  const d = q.data;

  if (q.error) return <Alert color="red">{(q.error as Error).message}</Alert>;
  if (!d) return <Loader />;

  const s = d.summary;
  const donut = s.by_category.slice(0, 8).map((c) => ({ name: c.name, value: c.amount / 100, color: `${c.color ?? 'gray'}.6` }));
  const rest = s.by_category.slice(8).reduce((a, c) => a + c.amount, 0);
  if (rest > 0) donut.push({ name: 'Otras', value: rest / 100, color: 'gray.4' });
  const budgetTotal = d.budgets.reduce((a, b) => a + (b.currency === currency ? b.amount : 0), 0);
  const budgetSpent = d.budgets.reduce((a, b) => a + (b.currency === currency ? b.spent : 0), 0);
  const scopeGoals = (goals.data ?? []).filter((g) => g.scope === scope && !g.archived).slice(0, 3);
  const empty = s.count === 0 && d.accounts.length === 0;

  return (
    <>
      <PageHeader
        title={scopeName(scope, users, me.id)}
        description={`Resumen de ${monthName(month).toLowerCase()}${d.fx ? ` · Dólar BNA ${money(Math.round(d.fx.sell * 100), 'ARS')} (${date(d.fx.date, 'D MMM')})` : ''}`}
        actions={<MonthSelect value={month} onChange={setMonth} />}
      />

      {empty && (
        <Alert color="blue" mb="md" title="¡Bienvenidos!">
          Para empezar: creá sus cuentas en <Anchor component={Link} to="/cuentas">Cuentas</Anchor> (la cuenta común y las personales), revisá las categorías y presupuestos, y
          cargá movimientos a mano o importando el resumen del banco en <Anchor component={Link} to="/importar">Importar</Anchor>.
        </Alert>
      )}
      {s.missing_rates && (
        <Alert color="orange" icon={<IconAlertTriangle size={16} />} mb="md">
          Faltan cotizaciones del dólar BNA para convertir algunos movimientos. Actualizalas en <Anchor component={Link} to="/ajustes">Ajustes</Anchor>.
        </Alert>
      )}
      {d.pending > 0 && (
        <Alert color="yellow" icon={<IconCalendarDue size={16} />} mb="md">
          Tenés {d.pending} {d.pending === 1 ? 'movimiento recurrente' : 'movimientos recurrentes'} para confirmar.{' '}
          <Anchor component={Link} to="/recurrentes">
            Revisar
          </Anchor>
        </Alert>
      )}

      <SimpleGrid cols={{ base: 1, xs: 2, lg: 4 }} mb="md">
        <Kpi
          label={s.contributions > 0 ? 'Ingresos y aportes' : 'Ingresos'}
          value={money(s.income + Math.max(0, s.contributions), currency)}
          icon={IconCash}
          color="teal"
          delta={change(s.income + Math.max(0, s.contributions), d.previous.income + Math.max(0, d.previous.contributions))}
          deltaGood="up"
          hint={s.contributions > 0 ? `Aportes al pozo común: ${money(s.contributions, currency)}` : s.contributions < 0 ? `Aportaste al hogar: ${money(-s.contributions, currency)}` : undefined}
        />
        <Kpi label="Gastos" value={money(s.expense, currency)} icon={IconWallet} color="red" delta={change(s.expense, d.previous.expense)} deltaGood="down" />
        <Kpi
          label="Ahorro del mes"
          value={money(s.net, currency)}
          icon={IconPigMoney}
          color="blue"
          hint={s.savings_rate == null ? 'Sin ingresos registrados' : `Tasa de ahorro: ${pct(s.savings_rate)}`}
        />
        <Kpi label="Saldo en cuentas" value={money(d.accounts_total, currency)} icon={IconScale} color="grape" hint={`${d.accounts.length} cuentas`} />
      </SimpleGrid>

      <Grid gutter="md">
        <Grid.Col span={{ base: 12, md: 7 }}>
          <Card h="100%">
            <Group justify="space-between" mb="sm">
              <Title order={4}>Gastos por categoría</Title>
              <Anchor component={Link} to="/reportes" size="sm">
                Ver reportes
              </Anchor>
            </Group>
            {s.by_category.length === 0 ? (
              <Text c="dimmed" size="sm">
                Sin gastos este mes.
              </Text>
            ) : (
              <Group align="center" wrap="wrap" gap="xl">
                <DonutChart
                  data={donut}
                  size={180}
                  thickness={26}
                  withTooltip
                  tooltipDataSource="segment"
                  valueFormatter={(v) => money(Math.round(v * 100), currency)}
                  chartLabel={money(s.expense, currency, { compact: true })}
                />
                <Stack gap={6} style={{ flex: 1, minWidth: 220 }}>
                  {s.by_category.slice(0, 8).map((c) => (
                    <Group key={c.name} justify="space-between" wrap="nowrap" gap="xs">
                      <Group gap={8} wrap="nowrap">
                        <div style={{ width: 10, height: 10, borderRadius: 3, background: `var(--mantine-color-${c.color ?? 'gray'}-6)`, flexShrink: 0 }} />
                        <Text size="sm" lineClamp={1}>
                          {c.name}
                        </Text>
                      </Group>
                      <Group gap={8} wrap="nowrap">
                        <Text size="xs" c="dimmed">
                          {pct((c.amount / s.expense) * 100, 0)}
                        </Text>
                        <Text size="sm" fw={600} className="num">
                          {money(c.amount, currency)}
                        </Text>
                      </Group>
                    </Group>
                  ))}
                </Stack>
              </Group>
            )}
          </Card>
        </Grid.Col>

        <Grid.Col span={{ base: 12, md: 5 }}>
          <Card h="100%">
            <Group justify="space-between" mb="sm">
              <Title order={4}>Presupuestos</Title>
              <Anchor component={Link} to="/presupuestos" size="sm">
                Editar
              </Anchor>
            </Group>
            {d.budgets.length === 0 ? (
              <Text c="dimmed" size="sm">
                Todavía no hay presupuestos para este tablero.{' '}
                <Anchor component={Link} to="/presupuestos">
                  Crear presupuestos
                </Anchor>
              </Text>
            ) : (
              <Stack gap="sm">
                {budgetTotal > 0 && (
                  <Text size="sm" c="dimmed">
                    {money(budgetSpent, currency)} de {money(budgetTotal, currency)} ({pct((budgetSpent / budgetTotal) * 100, 0)})
                    {d.day_of_month ? ` · día ${d.day_of_month} del mes` : ''}
                  </Text>
                )}
                {d.budgets.slice(0, 6).map((b) => (
                  <div key={b.id}>
                    <Group justify="space-between" mb={2} wrap="nowrap">
                      <Text size="sm" fw={500} lineClamp={1}>
                        {b.category_name}
                      </Text>
                      <Text size="xs" c={b.pct >= 100 ? 'red' : b.pct >= 80 ? 'orange' : 'dimmed'} className="num">
                        {money(b.spent, b.currency, { compact: true })} / {money(b.amount, b.currency, { compact: true })}
                      </Text>
                    </Group>
                    <Progress value={Math.min(100, b.pct)} color={b.pct >= 100 ? 'red' : b.pct >= 80 ? 'orange' : 'teal'} size="sm" />
                  </div>
                ))}
              </Stack>
            )}
          </Card>
        </Grid.Col>

        <Grid.Col span={{ base: 12, md: 7 }}>
          <Card>
            <Group justify="space-between" mb="xs">
              <Title order={4}>Últimos movimientos</Title>
              <Group gap="xs">
                <Button size="compact-sm" variant="light" leftSection={<IconPlus size={14} />} onClick={() => openTx()}>
                  Agregar
                </Button>
                <Anchor component={Link} to="/movimientos" size="sm">
                  Ver todos
                </Anchor>
              </Group>
            </Group>
            <TxTable rows={d.recent} compact />
          </Card>
        </Grid.Col>

        <Grid.Col span={{ base: 12, md: 5 }}>
          <Stack gap="md">
            <Card>
              <Group justify="space-between" mb="xs">
                <Title order={4}>Gastos compartidos</Title>
                <Anchor component={Link} to="/saldos" size="sm">
                  Detalle
                </Anchor>
              </Group>
              <SharedBalanceText balances={d.balances} />
            </Card>

            <Card>
              <Title order={4} mb="xs">
                Cuentas
              </Title>
              {d.accounts.length === 0 ? (
                <Text c="dimmed" size="sm">
                  Sin cuentas en este tablero.
                </Text>
              ) : (
                <Stack gap={6}>
                  {d.accounts.map((a) => (
                    <Group key={a.id} justify="space-between" wrap="nowrap">
                      <Text size="sm" lineClamp={1}>
                        {a.name}
                      </Text>
                      <Tooltip label={a.currency !== currency ? `${money(a.converted, currency)} al dólar BNA de hoy` : ''} disabled={a.currency === currency}>
                        <Text size="sm" fw={600} className="num" c={a.balance < 0 ? 'red' : undefined}>
                          {money(a.balance, a.currency)}
                        </Text>
                      </Tooltip>
                    </Group>
                  ))}
                </Stack>
              )}
            </Card>

            {d.upcoming_installments.length > 0 && (
              <Card>
                <Title order={4} mb="xs">
                  Cuotas por venir
                </Title>
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
              <Card>
                <Group justify="space-between" mb="xs">
                  <Title order={4}>Metas</Title>
                  <Anchor component={Link} to="/metas" size="sm">
                    Ver metas
                  </Anchor>
                </Group>
                <Stack gap="sm">
                  {scopeGoals.map((g) => (
                    <div key={g.id}>
                      <Group justify="space-between" mb={2}>
                        <Text size="sm" fw={500}>
                          {g.name}
                        </Text>
                        <Badge variant="light" color={g.color ?? 'blue'}>
                          {pct(g.pct, 0)}
                        </Badge>
                      </Group>
                      <Progress value={g.pct} color={g.color ?? 'blue'} size="sm" />
                      <Text size="xs" c="dimmed" mt={2}>
                        {money(g.saved, g.currency)} de {money(g.target_amount, g.currency)}
                        {g.monthly_needed ? ` · ${money(g.monthly_needed, g.currency)}/mes` : ''}
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
