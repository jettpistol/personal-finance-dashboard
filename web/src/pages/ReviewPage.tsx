import { useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, Group, List, Loader, SimpleGrid, Stack, Table, Text, Textarea, Title } from '@mantine/core';
import { IconBrandTelegram, IconCheck, IconDownload } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MonthSelect, PageHeader } from '../components/Layout';
import { Delta, Kpi, MissingRatesAlert, RealPct, change } from '../components/ReportBits';
import type { Inflation } from '../components/ReportTabs';
import { api, download, qs } from '../lib/api';
import { scopeName, useApp } from '../lib/app-state';
import { addMonths, currentMonth, date, money, monthName, pct } from '../lib/format';
import { notifyError, notifyOk } from '../lib/queries';
import type { MonthSummary } from '../lib/types';

type Review = { month: string; scope: string; notes: string; closed_at: string | null; sent_at: string | null };

const QUESTIONS = [
  '¿Qué categoría se pasó del presupuesto y por qué?',
  '¿Hubo gastos que no esperábamos? ¿Se van a repetir?',
  '¿Hay suscripciones o servicios que podamos cancelar o renegociar?',
  '¿Cuánto apartamos para los objetivos? ¿Vamos al ritmo necesario?',
  '¿Quedó alguna deuda entre nosotros sin saldar?',
  '¿Cambiamos algún presupuesto para el mes que viene (por ejemplo, por inflación)?',
];

function defaultMonth() {
  return new Date().getDate() <= 10 ? addMonths(currentMonth(), -1) : currentMonth();
}

export function ReviewPage() {
  const { scope, currency, users, me } = useApp();
  const qc = useQueryClient();
  const [month, setMonth] = useState(defaultMonth);
  const prev = addMonths(month, -1);
  const canEdit = scope === 'household' || scope === `user:${me.id}`;

  const cur = useQuery({ queryKey: ['reports', 'summary', scope, month, currency], queryFn: () => api.get<MonthSummary>(`/reports/summary${qs({ scope, month, currency })}`) });
  const before = useQuery({ queryKey: ['reports', 'summary', scope, prev, currency], queryFn: () => api.get<MonthSummary>(`/reports/summary${qs({ scope, month: prev, currency })}`) });
  const infl = useQuery({ queryKey: ['reports', 'inflation', scope, month], queryFn: () => api.get<Inflation>(`/reports/inflation${qs({ scope, month })}`) });
  const review = useQuery({ queryKey: ['reviews', month, scope], queryFn: () => api.get<Review>(`/reviews/${month}${qs({ scope })}`) });

  const [notes, setNotes] = useState('');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (review.data) {
      setNotes(review.data.notes);
      setDirty(false);
    }
  }, [review.data]);

  const saveNotes = async (closed?: boolean) => {
    if (!canEdit) return;
    setSaving(true);
    try {
      await api.put(`/reviews/${month}`, { scope, notes, closed });
      setDirty(false);
      await qc.invalidateQueries({ queryKey: ['reviews', month, scope] });
      if (closed) notifyOk('Mes cerrado');
    } catch (e) {
      notifyError(e);
    } finally {
      setSaving(false);
    }
  };

  const send = async () => {
    setSending(true);
    try {
      if (dirty) await saveNotes();
      await api.post(`/reviews/${month}/send`, { scope });
      notifyOk('Resumen enviado por Telegram');
      qc.invalidateQueries({ queryKey: ['reviews', month, scope] });
    } catch (e) {
      notifyError(e);
    } finally {
      setSending(false);
    }
  };

  const s = cur.data;
  const p = before.data;
  const r = review.data;

  const categories = (() => {
    if (!s || !p) return [];
    const prevBy = new Map(p.by_category.map((c) => [c.name, c.amount]));
    const names = new Set([...s.by_category.map((c) => c.name), ...p.by_category.map((c) => c.name)]);
    return [...names]
      .map((name) => ({ name, amount: s.by_category.find((c) => c.name === name)?.amount ?? 0, previous: prevBy.get(name) ?? 0 }))
      .sort((a, b) => b.amount - a.amount);
  })();

  return (
    <>
      <PageHeader
        title="Cierre de mes"
        description={`${scopeName(scope, users, me.id)} · ${monthName(month)}`}
        actions={
          <>
            <MonthSelect value={month} onChange={setMonth} />
            <Button size="xs" variant="default" leftSection={<IconDownload size={14} />} onClick={() => download(`/reviews/${month}/docx${qs({ scope, currency })}`)}>
              Descargar DOCX
            </Button>
            <Button size="xs" variant="light" leftSection={<IconBrandTelegram size={14} />} loading={sending} onClick={send}>
              Enviar por Telegram
            </Button>
          </>
        }
      />

      {!s || !p ? (
        <Group justify="center" py="xl">
          <Loader />
        </Group>
      ) : (
        <Stack>
          <MissingRatesAlert show={s.missing_rates || p.missing_rates} />
          <Group gap="xs">
            {r?.closed_at ? (
              <Badge color="teal" variant="light" leftSection={<IconCheck size={12} />}>
                Cerrado el {date(r.closed_at.slice(0, 10))}
              </Badge>
            ) : (
              <Badge color="gray" variant="light">
                Mes abierto
              </Badge>
            )}
            {r?.sent_at && (
              <Badge color="blue" variant="light">
                Enviado el {date(r.sent_at.slice(0, 10))}
              </Badge>
            )}
          </Group>

          <SimpleGrid cols={{ base: 2, sm: 4 }}>
            <Kpi
              label={s.contributions > 0 ? 'Ingresos y aportes' : 'Ingresos'}
              value={money(s.income + Math.max(0, s.contributions), currency)}
              hint={s.contributions ? `${s.contributions > 0 ? 'Aportes al pozo común' : 'Aportes al hogar'}: ${money(s.contributions, currency)}` : undefined}
            >
              <Delta value={change(s.income + Math.max(0, s.contributions), p.income + Math.max(0, p.contributions))} goodWhenUp suffix={`vs ${monthName(prev, true)}`} />
            </Kpi>
            <Kpi label="Gastos" value={money(s.expense, currency)}>
              <Delta value={change(s.expense, p.expense)} goodWhenUp={false} suffix={`vs ${monthName(prev, true)}`} />
            </Kpi>
            <Kpi label="Ahorro" value={money(s.net, currency)}>
              <Delta value={change(s.net, p.net)} goodWhenUp suffix={`vs ${monthName(prev, true)}`} />
            </Kpi>
            <Kpi label="Tasa de ahorro" value={pct(s.savings_rate)}>
              <Text size="xs" c="dimmed">
                {monthName(prev, true)}: {pct(p.savings_rate)}
              </Text>
            </Kpi>
          </SimpleGrid>

          {infl.data?.cpi_latest_month && (
            <Card padding="md">
              <Group wrap="wrap" gap="sm" style={{ columnGap: 48 }}>
                <div>
                  <Text fw={700}>Inflación</Text>
                  <Text size="xs" c="dimmed">
                    Gasto en pesos comparado con el mes anterior{infl.data.cpi_month == null ? ' (IPC del mes todavía no publicado; se usa el último dato)' : ''}.
                  </Text>
                </div>
                <Group gap="xl">
                  <Stat label="Variación del gasto" value={pct(infl.data.total.nominal_vs_prev, 1, true)} />
                  <Stat label="IPC" value={pct(infl.data.cpi_vs_prev, 1, true)} />
                  <div>
                    <Text size="xs" c="dimmed">
                      Variación real
                    </Text>
                    <RealPct value={infl.data.total.real_vs_prev} />
                  </div>
                </Group>
              </Group>
            </Card>
          )}

          <SimpleGrid cols={{ base: 1, md: 2 }}>
            <Card>
              <Title order={5} mb="md">
                Categorías vs {monthName(prev)}
              </Title>
              {!categories.length ? (
                <Text c="dimmed" size="sm">
                  Sin gastos en estos meses.
                </Text>
              ) : (
                <Table.ScrollContainer minWidth={380}>
                  <Table verticalSpacing={6} fz="sm">
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>Categoría</Table.Th>
                        <Table.Th ta="right">{monthName(month, true)}</Table.Th>
                        <Table.Th ta="right">{monthName(prev, true)}</Table.Th>
                        <Table.Th ta="right">Cambio</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {categories.map((c) => (
                        <Table.Tr key={c.name}>
                          <Table.Td fw={500}>{c.name}</Table.Td>
                          <Table.Td ta="right" className="num">
                            {money(c.amount, currency)}
                          </Table.Td>
                          <Table.Td ta="right" className="num" c="dimmed">
                            {money(c.previous, currency)}
                          </Table.Td>
                          <Table.Td>
                            <Group justify="flex-end">
                              <Delta value={change(c.amount, c.previous)} goodWhenUp={false} />
                            </Group>
                          </Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </Table.ScrollContainer>
              )}
            </Card>

            <Card>
              <Title order={5} mb="md">
                Dónde más gastaron
              </Title>
              {!s.top_merchants.length ? (
                <Text c="dimmed" size="sm">
                  Sin gastos este mes.
                </Text>
              ) : (
                <Stack gap={8}>
                  {s.top_merchants.slice(0, 8).map((m) => (
                    <Group key={m.name} justify="space-between" wrap="nowrap">
                      <div style={{ minWidth: 0 }}>
                        <Text size="sm" fw={500} lineClamp={1}>
                          {m.name}
                        </Text>
                        <Text size="xs" c="dimmed">
                          {m.count} {m.count === 1 ? 'vez' : 'veces'}
                        </Text>
                      </div>
                      <Text size="sm" fw={600} className="num">
                        {money(m.amount, currency)}
                      </Text>
                    </Group>
                  ))}
                </Stack>
              )}
            </Card>
          </SimpleGrid>

          <SimpleGrid cols={{ base: 1, md: 2 }}>
            <Card>
              <Group justify="space-between" mb="sm">
                <Title order={5}>Notas del mes</Title>
                {dirty && (
                  <Text size="xs" c="dimmed">
                    Sin guardar
                  </Text>
                )}
              </Group>
              {!canEdit && (
                <Alert color="gray" mb="sm">
                  Solo podés editar las notas del hogar o las tuyas.
                </Alert>
              )}
              <Textarea
                autosize
                minRows={6}
                maxRows={16}
                placeholder="Qué salió bien, qué cambiar, decisiones para el mes que viene…"
                value={notes}
                disabled={!canEdit}
                onChange={(e) => {
                  setNotes(e.currentTarget.value);
                  setDirty(true);
                }}
                onBlur={() => dirty && saveNotes()}
              />
              <Group justify="flex-end" mt="sm" gap="xs">
                <Button size="xs" variant="default" onClick={() => saveNotes()} loading={saving} disabled={!canEdit || !dirty}>
                  Guardar notas
                </Button>
                {!r?.closed_at && (
                  <Button size="xs" leftSection={<IconCheck size={14} />} onClick={() => saveNotes(true)} loading={saving} disabled={!canEdit}>
                    Marcar mes como cerrado
                  </Button>
                )}
              </Group>
            </Card>
            <Card>
              <Title order={5} mb="sm">
                Preguntas para repasar juntos
              </Title>
              <List spacing={6} size="sm">
                {QUESTIONS.map((q) => (
                  <List.Item key={q}>{q}</List.Item>
                ))}
              </List>
              <Text size="xs" c="dimmed" mt="md">
                El resumen en DOCX incluye estos números, los presupuestos, los saldos entre ustedes y las notas. Se envía solo por Telegram los primeros días de cada mes.
              </Text>
            </Card>
          </SimpleGrid>
        </Stack>
      )}
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      <Text size="sm" fw={600} className="num">
        {value}
      </Text>
    </div>
  );
}
