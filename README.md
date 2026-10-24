# personal-finance-dashboard

Dashboard de finanzas personales para una pareja. Por ahora contiene la base de datos: leer los
resúmenes del Banco Galicia (cuenta y tarjetas), entender qué es cada movimiento y clasificar los gastos.

## Qué lee hoy

| Archivo | Cómo se obtiene | Qué contiene |
|---|---|---|
| Extracto `.xlsx` de la Caja de Ahorro | Home banking, descarga de movimientos | Fuente principal de la cuenta |
| Resumen mensual de la Caja de Ahorro (PDF) | Home banking | Alternativa al Excel |
| Resumen de tarjeta Visa o American Express (PDF) | Home banking | Única fuente de las tarjetas |

Los PDF se leen con `pdftotext -layout` (paquete `poppler-utils`).

```bash
npm install
npm test                                  # tests y datos de prueba sintéticos
npm run typecheck
npm run inspect -- ruta/al/archivo.pdf    # resumen de un archivo real
npm run inspect -- ruta/al/extracto.xlsx --unclassified   # además, comercios sin categoría
```

`inspect` muestra si el archivo cuadra (ver "Controles de integridad"), el gasto por categoría y,
con `--unclassified`, los comercios que las reglas no conocen.

> **Privacidad:** los resúmenes reales traen nombre, CUIL, CBU y número de tarjeta. `*.pdf`, `*.xlsx`
> y las carpetas `samples/` y `private/` están en `.gitignore`. Los tests usan archivos inventados
> en `tests/fixtures`. Los parsers guardan solo los últimos dígitos de cuentas y tarjetas.

## Decisiones de diseño

- **Montos en centavos enteros** (`amountMinor`) y con su moneda. Nunca se convierten: un gasto en USD
  queda en USD, tal cual lo informa el resumen. La cotización que imprime el banco se guarda solo como dato.
- **Signo:** gasto o salida de plata = negativo; ingreso, devolución o pago recibido = positivo.
  Los resúmenes de tarjeta imprimen los cargos en positivo; los parsers lo invierten.
- **Cuotas:** cada compra trae `installment: { number, total }` ("cuota 3 de 9") y la fecha original
  de compra. El monto es el de esa cuota.
- **Mes de reporte "por resumen"** (`reportingMonth`): los gastos de tarjeta cuentan en el mes de la
  fecha de **cierre** del resumen; los de la cuenta, en su mes calendario. Ojo: un resumen que cierra
  el 1 de octubre se informa en octubre aunque tenga sobre todo gastos de septiembre.
- **Ninguna cuenta es "la principal".** Un resumen es un origen de datos intercambiable
  (`source`), así que se puede sumar Mercado Pago, Naranja X, Ualá, etc. sin tocar el resto.
- **Pareja:** las personas se identifican por CUIL, no por nombre (el mismo nombre aparece en distinto
  orden según el archivo). Ver `src/household.ts`.
- **Transferencias entre cuentas propias** (`own_transfer`) y las transferencias entre integrantes
  de la pareja no son ni gasto ni ingreso. Los parsers solo las identifican; excluirlas de los
  totales es tarea de la capa de reportes.

## Controles de integridad

Cada parser verifica que lo leído cuadre con lo que imprime el banco, y lo informa en
`statement.integrity`. Si algo no cuadra, el archivo no debe confiarse.

- Cuenta: el saldo corrido de cada movimiento y, en el PDF, los totales de créditos, débitos y saldo final.
- Tarjeta (en pesos y en dólares): `saldo anterior + pagos + consumos + cargos = TOTAL A PAGAR`, y
  que la suma de las compras sea igual a "Total Consumos".

## Categorías

`src/categorization/rules.ts` trae reglas para un hogar argentino típico: supermercados, Rappi y
PedidosYa, Uber/Cabify/DiDi/SUBE, Netflix/Spotify/YouTube, Farmacity, Edenor/Metrogas, etc.
Reglas y limitaciones:

- **Lo que no se conoce queda sin clasificar** (`category: null`). No se adivina.
- Gana la primera regla que coincide; las específicas van antes que las genéricas
  (`UBER EATS` es delivery, `UBER` es transporte).
- Se compara por palabra completa (`UBER` no coincide con `UBERLANDIA`). Para nombres que los
  procesadores pegan o truncan (`MERPAGO*BURGERKING`, `SPORTCLU`) hay `contains`.
- Solo se clasifican compras, devoluciones y reintegros, por comercio, así que una devolución
  cae en la misma categoría que la compra. Transferencias, sueldo y pagos de tarjeta no son gasto.
- Efectivo, impuestos e intereses se clasifican por tipo de movimiento.
- Los ajustes manuales (`overrides`, por `merchantKey`) siempre ganan sobre las reglas.
- La regla más agresiva es `SUPER` como palabra suelta (supermercados de barrio). Si da falsos
  positivos, se saca de la lista.

## Pendiente

- Cruzar los pagos de tarjeta de la cuenta con los pagos del resumen (el resumen indica en el texto el
  total pagado en pesos cuando el pago incluye dólares).
- Significado de las marcas `*`, `K` y `F` que el resumen Visa imprime antes del comercio: hoy se
  guardan sin interpretar (`flag`).
- Resúmenes con más de una tarjeta física: el código supone que las compras de cada tarjeta van
  seguidas de su línea "Total Consumos", pero solo se probó con datos sintéticos.
- Capa de reportes (totales por mes, por persona y de la pareja), base de datos e interfaz.

## Estructura

```
src/domain/              tipos, montos (centavos) y fechas
src/parsing/galicia/     extracto xlsx, resumen de cuenta PDF, resumen de tarjeta
src/parsing/xlsx-reader  lector mínimo de .xlsx (el Excel de Galicia no es estándar)
src/categorization/      categorías, reglas por defecto y clasificador
src/household.ts         integrantes de la pareja y rol de cada contraparte
scripts/inspect.ts       revisar un archivo real desde la terminal
```
