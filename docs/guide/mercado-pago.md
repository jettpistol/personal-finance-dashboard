# Connect Mercado Pago

Each of you can connect your own personal Mercado Pago account in **Ajustes → Mercado Pago**. For now this only saves the connection and checks what Mercado Pago lets the app read; bringing in the movements comes next.

![Ajustes, Mercado Pago tab with a connected account and the list of data sources](img/mercado-pago.png)

## Before you start

Mercado Pago gives a personal account one key, the **Access Token** of production. It is powerful: anyone who has it can read your whole account **and move money** with it (there is no read-only version). So:

- Never paste it in a chat, an email, a screenshot or a file. Type it only in **Ajustes → Mercado Pago**.
- If you think it leaked, renew it in Mercado Pago (**Credenciales de producción → Renovar**): the old one stops working at once.

How Finanzas keeps it:

- It's checked with Mercado Pago, then stored **encrypted**. The key that opens it is not in the database, so a copy of the database or a backup alone is useless.
- It's **never shown again**, not even to you: the screen only shows the account name and ID.
- It's yours only. Your partner can't see it, use it or even tell whether you connected one.
- The app only **reads** from Mercado Pago, with one exception you approved: it can save the settings of the two history reports and ask for a report. It's built so it can't create payments, refunds, transfers or anything else that moves money.

## Get the token (about 15 minutes, on a computer)

1. Your Mercado Pago identity must be verified (DNI and selfie in the app).
2. Go to **mercadopago.com.ar/developers/panel/app** and log in with your personal account.
3. **Crear aplicación**:
   - **Elegí una solución para integrar**: **Checkout API**.
   - **Nombre de la aplicación**: for example *Finanzas*. Answer the rest with the simplest option.
   - Accept and click **Crear aplicación**.
4. In the app's menu: **Producción → Credenciales de producción**. If asked, activate them (**Industria**: *Servicios* or *Otros*; **Sitio web**: any address of yours, for example your GitHub profile).
5. Copy the **Access Token**. It starts with `APP_USR-`. The **Public Key**, Client ID and Client Secret aren't needed.

Each of you does this with your own Mercado Pago login.

## Connect it

1. In Finanzas: **Ajustes → Mercado Pago**.
2. Paste the token in **Access Token de producción**.
3. Optionally, **Traer movimientos desde**: how far back to bring movements once that's available.
4. Click **Conectar**. The app asks Mercado Pago who the token belongs to, and only saves it if it's valid.

Common messages:

| Message | Fix |
| --- | --- |
| *Es un token de prueba* | You copied the test one. Use **Credenciales de producción**. |
| *El token debe empezar con APP_USR-* | Copy it again, whole. |
| *Mercado Pago rechazó el token* | It's wrong or was renewed. Copy the current one. |
| *No se pudo contactar a Mercado Pago* | No internet on the server, or Mercado Pago is down. Try later. |

## Once connected

- **Cuenta**: your Mercado Pago name, user ID and country (**MLA** is Argentina).
- **Desde**: the start date; the pencil changes it.
- **Datos**: after **Probar conexión**, how many data sources your account allows. Click it for the list:
  - **Datos de la cuenta**: who you are.
  - **Pagos recibidos**: money that came in, almost in real time.
  - **Saldo**: the live balance. Mercado Pago often blocks it for personal accounts; that's normal.
  - **Reporte de dinero liberado** and **Reporte de todas las transacciones**: the full history, in and out. **Sin configurar** means Mercado Pago has no settings for that report yet: click **Configurar reportes** (below).
- **Configurar reportes** (only while a report shows **Sin configurar**): saves the report's settings in Mercado Pago (every column, Argentina's time, no emails, no automatic schedule) and checks again. Reports already set up are left as they are. If Mercado Pago refuses, the message says which report and its code; then try generating one by hand on the website (**Tu negocio → Reportes**) and click **Probar conexión** again.
- **⋯ → Reemplazar token**: after renewing it in Mercado Pago.
- **⋯ → Desconectar**: deletes the token from Finanzas. To cancel it in Mercado Pago too, renew it there.
- **Volvé a conectar** (yellow): the server can no longer open the saved token (its key changed). Paste the token again.

What Mercado Pago doesn't offer to the app at all: the Mercado Pago credit card, Mercado Crédito loans, investment yields and crypto. Those still come in through [Importar](importar.md).

## For whoever runs the server

The encryption key is created on first use as `secret.key` inside the data folder, readable only by the app. For extra protection, set `SECRET_KEY` (64 hexadecimal characters, e.g. from `openssl rand -hex 32`) in the server's settings instead: then the data folder alone can't open the tokens. Changing or losing the key means each person connects again; nothing else is lost. Keep `secret.key` out of any shared copy of the data folder.

See also: [Guide index](README.md) · [Ajustes](ajustes.md) · [Importar](importar.md)
