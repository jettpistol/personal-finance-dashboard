# Set up email notifications

The app can email you about budgets, recurring items to confirm and the monthly review. It sends them from a Gmail account that you set up once for the household. After that, each person types their own address and picks which alerts they want.

## What you need

- A Google account to send the alerts from. It can be one of your own or a new one just for the app.
- 2-Step Verification turned on in that account. Google only offers app passwords when it is on.

## Set up the sending account

Whoever runs the app does this once.

1. Sign in to the Google account that will send the alerts and turn on **2-Step Verification** (Google Account → Security).
2. Open [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords), type a name such as *Finanzas* and create the password. Google shows 16 letters; copy them.
3. In the app, open **Ajustes → Notificaciones**.
4. In the **Cuenta que envía los avisos** card, type the Gmail address in **Correo de Gmail** and the 16 letters in **Contraseña de aplicación**.
5. Click **Guardar**, then **Probar**. The app connects to Gmail and tells you whether it worked.

The app password isn't your Google password. It only lets the app send mail, and you can revoke it any time from the same Google page. If you revoke it, alerts stop until you create a new one and save it here.

## Receive the alerts

Each person does this in their own session.

1. In **Ajustes → Notificaciones**, type your address in **Tu correo** and click **Guardar**.
2. Click **Enviar prueba** and check that the message arrives.
3. In **Qué avisos recibir**, turn on the alerts you want. Each switch saves as soon as you flip it.

The alerts themselves are described in [Ajustes](ajustes.md#notificaciones).

## If it doesn't work

- **Gmail rejects the password.** Create a new app password and paste it again. Spaces don't matter: `abcd efgh ijkl mnop` and `abcdefghijklmnop` are the same. Check that 2-Step Verification is still on and that **Correo de Gmail** is the account where you created the password.
- **The test says it was sent, but nothing arrives.** Look in the spam folder and mark the message as not spam, so later alerts land in the inbox. Check **Tu correo** for typos.
- **You don't use Gmail.** Choose **Otro proveedor** and fill in **Servidor** (the host) and **Puerto** from your email provider's help page, along with that account's address and password. Then **Guardar** and **Probar** as above.

## Tips

- A separate Google account just for the app keeps your own inbox and password out of it.
- Telegram alerts are set up on the same tab; see [Ajustes](ajustes.md#notificaciones).

See also: [Guide index](README.md) · [Ajustes](ajustes.md) · [Presupuestos](presupuestos.md) · [Recurrentes](recurrentes.md) · [Cierre de mes](cierre-de-mes.md)
