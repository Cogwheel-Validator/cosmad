# Notifications

Enabled notifiers (Telegram, Discord, PagerDuty) all receive every alert event:
**opened**, **repeated** and **closed**. A send that keeps failing is retried until
it succeeds, see [Delivery and retries](#delivery-and-retries). A notifier is only
used if its table exists and has `enabled = true`.

Configure them once globally in `config.toml`, and optionally override per chain
inside `alert_config`. A per-chain table **replaces** the global one for that
chain entirely, so repeat all fields.

## Delivery and retries

Every notification is written to the database (the `notification_outbox` table,
one row per notifier) before it is sent, so it is not lost when a notifier is
down or Cosmad restarts.

- A **round** is 3 quick attempts (0.5 s, then 1 s apart). If all fail, the notification waits and
  a new round starts after a pause: `notify_retry_pause` (default 5 minutes), doubled after every
  failed round (5, 10, 20, 40 minutes ...) up to `notify_retry_max_pause` (default 1 hour). It keeps
  going until delivered.
- Notifiers are tracked separately: a Discord outage never causes duplicate Telegram messages.
- For one alert and notifier, messages are delivered in order (opened, repeat, closed).
- An opened/repeat message that is still undelivered when its alert closes is dropped, since it
  would only mislead. The closed message is still delivered.
- Pending notifications are picked up again after a restart, and delivered ones are deleted after
  7 days.

Both pauses are set per chain in `alert_config`:

```toml
alert_config = { notify_retry_pause = "2m", notify_retry_max_pause = "30m" }
```

## Telegram

```toml
[telegram]
enabled = true
bot_token = "123456:ABC..."     # from @BotFather
chat_id = "-100123456789"       # string; negative for groups/channels
```

Create a bot with @BotFather, add it to the chat, then get the `chat_id` from
`https://api.telegram.org/bot<token>/getUpdates` after sending the bot a message.

## Discord

```toml
[discord]
enabled = true
webhook_url = "https://discord.com/api/webhooks/<id>/<token>"
```

Channel settings -> Integrations -> Webhooks.

## PagerDuty

```toml
[pagerduty]
enabled = true
service_key = "<events API v2 integration key>"
```

## Per-chain override

```toml
# config/chains/atomone-1.toml
alert_config = {
  alert_if_inactive = true,
  stalled_alert = { enabled = true, stalled_threshold = "1m" },
  consecutive_miss_alert = { enabled = true, threshold = 50, repeat = false, repeat_interval = "5m" },
  percentage_missed_blocks_alert = { enabled = false, threshold = 10.0, repeat = false },
  telegram = { enabled = true, bot_token = "...", chat_id = "-100999" }
}
```

## Healthchecks (dead man's switch)

Alerts can't tell you that Cosmad itself died. Point a [Healthchecks](https://healthchecks.io)-style
service at it and get paged when the pings stop:

```toml
[health_check]
enabled = true
endpoint = "https://hc-ping.com/<uuid>"   # no trailing slash
ping = "1m"                                # time between success pings
```

Cosmad calls `<endpoint>/start` once on boot and `<endpoint>/success` every `ping`. Set the
check's period/grace in the service slightly above `ping`. This one is global only.
It runs inside the ingestion process, so it also stops if ingestion dies.
