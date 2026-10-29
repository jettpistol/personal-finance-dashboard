# Mercado Pago reports: confirmed reference

Condensed from Mercado Pago's own pages, supplied by the owner on 2026-10-28 (the developer sites can't be reached from cloud sessions). Where this disagrees with [`02-agent-handoff.md`](02-agent-handoff.md), **this file wins**: the brief guessed that both reports share one column list and one set of options, and they don't.

Sources:
- Account money (settlement): *Generate report via API*, mercadopago.com.ar/developers/en/docs/checkout-pro/additional-content/reports/account-money/api
- Released money (release): *Generate report via API*, mercadopago.com.ar/developers/en/docs/reports/released-money/api
- Account money glossary: mercadopago.com.br/developers/en/docs/checkout-api-payments/additional-content/reports/account-money/report-fields (Brazil site: a column may not exist in Argentina)

What the app sends lives in `reportConfig()` in `server/src/lib/mercadopago.ts`.

## Shared behaviour

- `frequency` is only stored. Nothing is generated automatically until `POST {base}/schedule` (not allowed in this app).
- Create a report: `POST {base}` with `{"begin_date": "2019-05-01T00:00:00Z", "end_date": "2019-06-01T00:00:00Z"}`.
  - `202 Accepted`: it's being generated, asynchronously.
  - `203 Non-Authoritative Information`: accepted but **not created**; ask again with the dates the system indicates.
- List: `GET {base}/list` returns a JSON array.
- Download: `GET {base}/{file_name}` returns the raw file.
- Config: `POST {base}/config` answers `201` with the stored config; `GET` and `PUT` answer `200`. `scheduled` is read-only.
- `display_timezone` defaults to `GMT-04`; the app sends `GMT-03` (Argentina).

## Account money (`/v1/account/settlement_report`)

Config body (the documented example; `columns` and `file_name_prefix` and `frequency` are required):

```json
{
  "file_name_prefix": "settlement-report-USER_ID",
  "show_fee_prevision": false,
  "show_chargeback_cancel": true,
  "coupon_detailed": true,
  "include_withdraw": true,
  "shipping_detail": true,
  "refund_detailed": true,
  "display_timezone": "GMT-04",
  "header_language": "en",
  "frequency": { "hour": 0, "type": "monthly", "value": 1 },
  "columns": [{ "key": "TRANSACTION_DATE" }, { "key": "SOURCE_ID" }, { "key": "EXTERNAL_REFERENCE" }]
}
```

- Withdrawals flag: **`include_withdraw`** (not `include_withdrawal`).
- Other optional fields: `separator` (default `,`), `report_translation` / `header_language` (`en`, `es`, `pt`), `sftp_info` (never used here).
- The date column is **`TRANSACTION_DATE`** (`DATE` is the release report's).

List item:

```json
{ "id": 12345678, "user_id": 123, "begin_date": "2015-05-01T00:00:00Z", "end_date": "2015-06-01T23:59:59Z",
  "file_name": "settlement-report-USER_ID-2016-01-20-131015.csv", "created_from": "manual", "date_created": "2016-01-20T10:07:53.000-04:00" }
```

Sample report header (its real output; `;` separated, `.` decimals, fees negative):

```
EXTERNAL_REFERENCE;SOURCE_ID;USER_ID;PAYMENT_METHOD_TYPE;PAYMENT_METHOD;SITE;TRANSACTION_TYPE;TRANSACTION_AMOUNT;TRANSACTION_CURRENCY;TRANSACTION_DATE;FEE_AMOUNT;SETTLEMENT_NET_AMOUNT;SETTLEMENT_CURRENCY;SETTLEMENT_DATE;REAL_AMOUNT;COUPON_AMOUNT;METADATA;MKP_FEE_AMOUNT;FINANCING_FEE_AMOUNT;SHIPPING_FEE_AMOUNT;TAXES_AMOUNT;INSTALLMENTS;ORDER_ID;SHIPPING_ID;SHIPMENT_MODE;PACK_ID
2112818453;5067634447;123456789;account_money;account_money;MLB;SETTLEMENT;79.00;BRL;2019-08-11T22:20:19.000-04:00;-8.85;70.15;BRL;2019-08-11T22:20:19.000-04:00;70.15;0.00;[{}];-8.85;0.00;0.00;0.00;1;2112818453;28067695419;me1;2E+15
```

Glossary highlights for a household ledger:

| Column | Meaning |
| --- | --- |
| `SOURCE_ID` | Mercado Pago transaction ID: the dedupe key (same as a payment's `id`). |
| `TRANSACTION_TYPE` | `SETTLEMENT` (approved payment), `REFUND`, `CHARGEBACK`, `DISPUTE`, `WITHDRAWAL` (to a bank account), `WITHDRAWAL_CANCEL`, `PAYOUT` (cash withdrawal). |
| `TRANSACTION_AMOUNT` / `SETTLEMENT_NET_AMOUNT` / `REAL_AMOUNT` | Amount; net amount that hit the balance (after fees); net after refunds and chargebacks. |
| `FEE_AMOUNT`, `MKP_FEE_AMOUNT`, `FINANCING_FEE_AMOUNT`, `SHIPPING_FEE_AMOUNT`, `TAXES_AMOUNT`, `TAX_DETAIL`, `TAXES_DISAGGREGATED` | Fees and withheld taxes (for "Impuestos y comisiones"). |
| `TRANSACTION_DATE` / `SETTLEMENT_DATE` / `MONEY_RELEASE_DATE` / `IS_RELEASED` | Created / approved / released, and whether the money is available. `*_SHORT` variants give YYYY-MM-DD. |
| `PAYMENT_METHOD_TYPE`, `PAYMENT_METHOD` | `account_money`, `credit_card`, `debit_card`, `bank_transfer`, `ticket`, `atm`, `prepaid_card`; and the specific method. |
| `DESCRIPTION`, `STORE_NAME`, `POS_NAME`, `POI_WALLET_NAME`, `POI_BANK_NAME` | Text and where it happened (store, cashier, wallet or bank behind a QR payment): input for Comercio and rules. |
| `INSTALLMENTS`, `INSTALLMENT_NUMBER`, `INSTALLMENT_NET_AMOUNT` | Installments. |
| `METADATA`, `OPERATION_TAGS` | JSON extras (partial refunds, payment channel). |

Full glossary also lists `SELLER_AMOUNT`, `POS_ID`, `EXTERNAL_POS_ID`, `STORE_ID`, `EXTERNAL_STORE_ID`, `SHIPPING_ID`, `SHIPMENT_MODE`, `PACK_ID`, `POI_ID`, `CARD_INITIAL_NUMBER`, `BUSINESS_UNIT`, `SUB_UNIT`, `PRODUCT_SKU`, `SALE_DETAIL`, `TIP_AMOUNT`, `FRANCHISE`, `LAST_FOUR_DIGITS`, `ORDER_MP`, `TRANSACTION_INTENT_ID`, `INVOICING_PERIOD`, `ISSUER_NAME`, `PAY_BANK_TRANSFER_ID`, `PURCHASE_ID`, `SHIPPING_ORDER_ID`, `APPLICATION_ID`, `AUTHORIZATION_CODE`, `CARD_ENTRY_MODE`, `SEGMENT_DETAIL`, `AUTHENTICATED_PAYER`.

## Released money (`/v1/account/release_report`)

Config body (the documented example):

```json
{
  "file_name_prefix": "release-report-USER_ID",
  "include_withdrawal_at_end": true,
  "execute_after_withdrawal": false,
  "display_timezone": "GMT-04",
  "notification_email_list": ["example@email.com"],
  "frequency": { "hour": 0, "type": "monthly", "value": 1 },
  "columns": [{ "key": "DATE" }, { "key": "SOURCE_ID" }, { "key": "EXTERNAL_REFERENCE" }]
}
```

- Withdrawals flag: **`include_withdrawal_at_end`**. Also `execute_after_withdrawal`.
- Optional: `separator`, `report_translation` (`en`, `es`, `pt`; this report has no `header_language`), `notification_email_list` (the app sends none), `check_available_balance` (balance before and after a withdrawal, informational), `compensate_detail` (blocks and unblocks that cancel out).
- Columns glossary: "released-money/glossary" page (not supplied yet).

List item (no `file_name` in the documented example; check a real response):

```json
{ "id": 99336983670, "account_id": 167345291, "begin_date": "2022-08-01T03:00:00Z", "end_date": "2022-08-08T02:59:59Z",
  "created_from": "manual", "currency_id": "ARS", "generation_date": "2024-02-16T15:55:22.258-04:00", "is_reserve": false,
  "is_test": false, "report_id": 17012160, "retries": 0, "status": "processed", "sub_type": "release", "user_id": 123456789, "format": "CSV" }
```

Sample report (`,` separated):

```
DATE,SOURCE_ID,EXTERNAL_REFERENCE,RECORD_TYPE,DESCRIPTION,NET_CREDIT_AMOUNT,NET_DEBIT_AMOUNT,GROSS_AMOUNT,MP_FEE_AMOUNT,FINANCING_FEE_AMOUNT,SHIPPING_FEE_AMOUNT,TAXES_AMOUNT,COUPON_AMOUNT,INSTALLMENTS,PAYMENT_METHOD
2018-04-17T15:07:53.000-04:00,,,initial_available_balance,,813439.19,0.00,813439.19,0.00,0.00,0.00,0.00,0.00,1,
2018-04-17T15:07:53.000-04:00,,,release,withdrawal,0.00,813363.45,-813360.45,-3.00,0.00,0.00,0.00,0.00,1,
2018-04-17T15:11:12.000-04:00,,,release,payment,225.96,0.00,269.00,-43.04,0.00,0.00,0.00,0.00,1,account_money
```

- **Status in a real account (2026-10-29):** a finished release report was listed with `status: "enabled"`, not the documented `"processed"`. The app downloads any listed report that has a `file_name` unless its status says it's still being made (`pending`, `processing`…) or failed (`error`, `failed`…).
- **Balance:** the first row, `RECORD_TYPE = initial_available_balance`, is the available balance at the start of the range. With the rows after it, that gives the balance at any point, so the blocked balance endpoint isn't needed.
- `RECORD_TYPE` `release` rows carry `DESCRIPTION` (`payment`, `withdrawal`, …) and credit or debit amounts.
