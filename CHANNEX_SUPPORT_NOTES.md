# Channex support notes

## Gate A — channel screen isolation (9.5 B), 2026-11-02

Setup: staging, two tenants in the same Channex organisation ("Abimael Wilmort Organization"):
`test-property` (property 55a3f3c8-…, 2 room types, 3 rooms) and `test-property-2` (property feb2e42c-…, 1 room type,
2 rooms, USD). Tenant 2 exists only for this test; its owner e-mail is a placeholder, nobody can log in as it.

How the channel screen works (read from Channex's app bundle, not documented): the frame URL is
`/auth/exchange?oauth_session_key=<one-time token>&redirect_to=…&property_id=…`. The app swaps the key for a session with
`GET /api/v1/auth/exchange?oauth_session_key=…`, which returns a bearer token for a temporary Channex user
(`<uuid>@temp.channex.io`, role `user`, member of the organisation), then calls the normal Channex API with it.
`redirect_to`, `property_id` and `group_id` in the URL are only UI hints; what the session may read is decided by the token.

Server-side probes (bearer token from tenant 1's session, then tenant 2's), all through the real `createIframeSession`:

| Request | Tenant 1 session | Tenant 2 session |
|---|---|---|
| `GET /properties` | only its own property | only its own property |
| `GET /properties/<other tenant's id>` | 404 | 404 |
| `GET /groups` | only its own group | only its own group |
| `/bookings`, `/channels`, `/booking_revisions/feed` filtered by the other property | empty | empty |
| `/room_types`, `/rate_plans` filtered by the other property | empty | (own: returned) |
| `/availability`, `/restrictions` for the other property (same dates the org API key reads with data) | `{}` | — |
| `/webhooks`, `/api_keys` | 403 | — |
| `/signing_keys`, `/users`, `/billing_accounts`, `/me` | 422 / 404 | — |

Outcome (API level): **isolated in both directions**. The session reads its own property's data and nothing of the
other tenant's, even though both sit in one organisation.

Browser check (owner, 2026-11-02, tenant 1, **Abrir pantalla de canales**): the frame has no link that leaves the
channels screen; nothing from the other tenant is reachable; no Channex branding (logo, name, channex.io links) and no
chat bubble seen.

Decision: **Channel screen is platform-only by default stays OFF**; tenants connect their own OTAs. No email to Channex
support is needed for isolation. (Open question for support, not blocking: whether the temporary session users, which
belong to our organisation, are cleaned up on their side.)
