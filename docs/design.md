# Design notes

How the questionnaire answers turned into the model. Read this before changing money logic.

## Money and currencies

- Amounts are **integer cents**. Every transaction is in its account's currency (ARS or USD).
- A transfer between accounts in different currencies stores both amounts (`amount`, `to_amount`). Buying dollars is a transfer, not spending.
- Display conversion uses the **BNA quote of the transaction's own day**. Days without a quote, such as weekends and holidays, use the closest previous quote. Quotes come from dolarapi.com (today) and argentinadatos.com (history), and can be entered by hand. The household picks the sell, buy or average quote.

## Scopes (dashboards)

| Scope | Income and expense | Accounts and net worth |
| --- | --- | --- |
| `household` (*Hogar*) | Joint-account transactions, plus **shared** expenses from any account at full amount | Joint accounts (net worth: every account the viewer can see) |
| `user:<id>` (*Mío*) | Own accounts, but shared expenses only at **the user's share**, wherever they were paid from | The user's accounts |

Joint-account spending that isn't marked shared counts only in *Hogar*.

## Privacy

- An account can be **private**: the partner doesn't see it, its balance or its transactions.
- A single transaction on a personal account can be private.
- Shared expenses and settlements can't be private. If one is paid from a private account, the partner still sees it, with the account hidden.
- A user can hide their whole personal dashboard (`share_dashboard = 0`).
- Every report filters out what the viewer can't see. Server-side backups contain everything; they're for whoever runs the server.

## Shared expenses (Splitwise model)

- A shared expense stores one split per user (`transaction_splits`), adding up exactly to the total. Split methods: household default ratio (Ajustes), equal, percent, or exact amounts.
- The payer is the account owner. Paid from a joint account: no debt, because the joint pot is already shared.
- Balance per currency = what you paid for shared expenses − your shares ± settlements. A **settlement** is a transfer between two people's personal accounts. These are flagged as settlements by default.
- Transfers into the joint account are contributions. They don't create debt.

## Installments, recurring, rules

- **Installments**: one plan with N expense rows dated month by month. Future rows don't affect balances until their date, but they show as committed spending.
- **Recurring**: on each due date a **pending** transaction is created. Pending rows are excluded from totals until someone confirms them, usually adjusting the amount.
- **Rules**: the first matching rule (highest priority) sets fields during import and suggests a category while typing. Without a rule match, the category used last time for the same description is suggested.

## Inflation features

Monthly CPI (INDEC, via argentinadatos.com, or entered by hand) gives a price index.

1. **Constant pesos**: past ARS amounts × (index today / index that month).
2. **Real change**: `(1 + nominal change) / (1 + CPI over the same period) − 1`, per category and in total, vs last month and vs a year ago.
3. **Budget indexing**: multiply ARS budgets by the latest monthly CPI, on demand or automatically when a new CPI is published.

## Automation (in-process scheduler, every 15 min)

Recurring generation; BNA quotes every 3 h; CPI daily; daily backup with rotation; automatic budget indexing (opt-in); on days 1–3, sends last month's review .docx per dashboard by Telegram.

## Security

- scrypt password hashes; random session tokens stored hashed; `HttpOnly`, `SameSite=Lax` cookies, plus `Secure` with `SECURE_COOKIES=true`.
- Lockout per username after 3 failures (30 s, then 1, 5, 15 and 60 min). Per IP the threshold is higher, so partners sharing an IP don't block each other.
- Unknown usernames take as long to reject as known ones.
