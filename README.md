# CG Entitlements Check

Browser UI that compares entitlements from the accounts API vs the capabilities-graph API. Runs over HTTPS at `local.capabilities-graph.api.test-godaddy.com` so your browser’s cookies for `*.test-godaddy.com` are sent automatically.

## Prerequisites

- Node.js 18+
- x-app-key for the test APIs
- TLS certs in `.certs/` for `_.capabilities-graph.api.test-godaddy.com`

## Installation

```bash
cd CG-Entitlements-Check
npm install
```

## Hosts entry

Add this line to `/etc/hosts` (or equivalent) so the hostname resolves:

```
127.0.0.1 local.capabilities-graph.api.test-godaddy.com
```

## Running the app

```bash
npm start
```

Then open **https://local.capabilities-graph.api.test-godaddy.com:3443** in your browser. Be logged into a `*.test-godaddy.com` site in that browser so cookies are set. Enter your **x-app-key** and click **Run compare**. Cookies are sent automatically with the request; no need to paste them.

To use a different port:

```bash
PORT=4443 npm start
```

The app calls these APIs directly (no proxy required):

- `https://websites.accounts.api.test-godaddy.com` for accounts and account entitlements
- `https://capabilities-graph.api.test-godaddy.com` for capabilities-entitlements

## Project layout

| Path               | Purpose                                           |
|--------------------|---------------------------------------------------|
| `server.js`        | HTTPS Express server; serves UI and `POST /api/compare` |
| `public/index.html`| Browser UI (form + results)                       |
| `src/compareLogic.js` | Compare logic (used by API)                    |
| `.certs/`          | TLS key and certs for the local hostname          |
