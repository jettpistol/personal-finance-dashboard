# Feature Questionnaire

Answers here decide the scope of the first version of the dashboard.
Reply with short codes (e.g. `1b, 2a, 3c ...`) and add notes wherever an option doesn't fit.
Questions marked **(multi)** accept more than one answer.

## A. Users and access

1. **Who enters transactions?**
   a) Both of us  b) Mostly one person, the other mostly views
2. **Logins**
   a) One shared login  b) Separate login per person (so we can see who added what)
3. **Phone usage**
   a) View only  b) Quick-add expenses plus viewing  c) Everything, same as PC
4. **Currencies**
   a) A single currency (which?)  b) Two or more currencies (which? e.g. local currency plus USD)
5. **App language**
   a) English  b) Spanish  c) Both, switchable

## B. How your money is organized

6. **Accounts to track (multi)**
   a) Bank/checking  b) Cash  c) Credit cards  d) Savings  e) Investments  f) Crypto  g) Digital wallets (e.g. Mercado Pago, PayPal)
7. **Shared vs. personal money**
   a) Everything is joint  b) Everything is separate, we split shared costs  c) Mix: a joint pot plus personal money
8. **Settling up between you two**
   a) Not needed  b) Track who paid and who owes whom, split 50/50  c) Same, but split by a custom ratio (e.g. proportional to income)
9. **Income tracking**
   a) Not needed, expenses only  b) Fixed salaries  c) Salaries plus irregular/freelance income
10. **Installment purchases** (paying something over several months)
    a) Never  b) Sometimes, I want to see future installments committed per month
11. **Inflation / reference currency**
    a) Not relevant  b) Show totals converted to a stable currency (e.g. USD) at the day's rate  c) Adjust past months for inflation
12. **Transfers between accounts** (e.g. moving money to savings, paying the card)
    a) Don't care  b) Track them so they don't count as spending

## C. Getting data in

13. **Main entry method**
    a) Manual entry  b) CSV/Excel import from bank statements (which banks?)  c) Both
14. **Minimum fields for a quick-add**
    a) Amount + category  b) Amount + category + who paid  c) Amount + category + account + note
15. **Recurring transactions** (rent, subscriptions, utilities)
    a) Enter by hand each time  b) Auto-create them each period  c) Auto-create, but ask me to confirm the amount
16. **Auto-categorization rules** (e.g. "SUPERMARKET X" goes to Groceries)
    a) Not needed  b) Yes
17. **Extras on a transaction (multi)**
    a) Free-text notes  b) Tags (e.g. "vacation 2027")  c) Receipt photo  d) None

## D. Budgeting and goals

18. **Budgeting style**
    a) No budget, just track and look back  b) Monthly spending limit per category  c) Envelope / zero-based (every unit of income gets assigned a job)
19. **Categories**
    a) Start from a default short list (rent, groceries, utilities, going out, subscriptions, health, transport, savings)  b) We'll define our own  c) Default list with subcategories
20. **Savings goals** (emergency fund, trip, future car)
    a) Not needed  b) Yes, with target amount, deadline and progress bar
21. **Budget alerts**
    a) None  b) Visual warning in the app only  c) Notification (email/Telegram/push)
22. **Upcoming bills view**
    a) Not needed  b) List/calendar of bills due this month with paid/unpaid status

## E. Dashboard and reports

23. **Home screen: pick your top 3 (multi)**
    a) Spent this month vs. budget  b) Spending by category  c) Income vs. expenses  d) Balance per account  e) Net worth  f) Who owes whom  g) Recent transactions  h) Goal progress
24. **Reports wanted (multi)**
    a) Month-over-month trend per category  b) Yearly summary  c) Savings rate  d) Net worth over time  e) Spending per person  f) Top merchants
25. **Default time view**
    a) Current month  b) Last 30 days  c) Current year
26. **Monthly review**
    a) Not needed  b) A "month close" page summarizing the month, comparing to the previous one, with space for notes

## F. Tech, hosting and data

27. **Tech stack**
    a) No preference, pick the simplest to maintain  b) I know/want to learn a specific language or framework (which?)
28. **Future hosting target**
    a) Oracle Cloud free VM (Docker)  b) Another free tier / undecided  c) Home server  d) Undecided, keep it portable (single Docker container + SQLite)
29. **Security level**
    a) Simple password login  b) Password + 2FA  c) Private network only (Tailscale), plus login
30. **Data portability (multi)**
    a) Export to CSV/Excel  b) Automatic scheduled backups (where to? Google Drive, second disk...)  c) Import existing history from a spreadsheet or app  d) None for now

## Answers

<!-- Fill in, e.g. "1: a" -->
