
A serverless pastebin API with expiration, password protection, and authentication, powered by Workers KV.

---

## 🌐 Base URL

```
https://pastebin.peme969.dev
```

---

## 🔐 Authentication

Authentication uses **Bearer** tokens:

- `Authorization: Bearer <API_KEY>` for read-only endpoints
- `Authorization: Bearer <SUPER_KEY>` for administrative actions

`GET /api/view/:slug` is public unless the paste is password protected.

---

## 🔁 CORS Support

CORS is fully supported with appropriate preflight handling.

---

## 📂 Endpoints

---

### `GET /`

**Returns**:  
The static HTML homepage.

**Example:**
```bash
curl https://pastebin.peme969.dev/
```

---

### `POST /api/create`

Create a new paste.

**Headers:**
- `Authorization: Bearer <SUPER_KEY>`
- `Content-Type: application/json`

**Body:**
```json
{
  "text": "Hello, world!",
  "password": "mypassword",                // Optional
  "expiration": "2025-08-01T12:00:00",     // Optional ISO-8601
  "slug": "customid"                       // Optional
}
```

**Response:**
```json
{
  "slug": "customid",
  "formattedExpiration": "Aug 1, 2025, 12:00 PM"
}
```

**Example:**
```bash
curl -X POST https://pastebin.peme969.dev/api/create \
  -H "Authorization: Bearer YOUR_SUPER_KEY" \
  -H "Content-Type: application/json" \
  -d '{"text":"My paste","expiration":"2025-08-01T10:00:00","password":"1234"}'
```

---

### `GET /api/pastes`

List pastes.

**Headers:**
- `Authorization: Bearer <API_KEY>` for public pastes
- `Authorization: Bearer <SUPER_KEY>` to include password-protected ones

**Example:**
```bash
curl -H "Authorization: Bearer YOUR_API_KEY" https://pastebin.peme969.dev/api/pastes
```

**Response:**
```json
[
  {
    "slug": "abc123",
    "created": "Jul 28, 2025, 7:30 AM",
    "expiration": "Aug 1, 2025, 12:00 PM"
  }
]
```

When using the super key, each entry may also include a `password` field.

---

### `GET /api/view/:slug`

Fetch a specific paste.

**Response:**
```json
{
  "text": "Hello, world!",
  "metadata": {
    "created": "2025-07-28T07:30:00.000Z",
    "expiration": "2025-08-01T17:00:00.000Z",
    "password": null
  }
}
```

**Note:** If password-protected, include:
```http
X-Paste-Password: <password>
```

**Example:**
```bash
curl -H "X-Paste-Password: 1234" https://pastebin.peme969.dev/api/view/my-paste
```

---

### `DELETE /api/delete`

Delete a paste by slug.

**Headers:**
- `Authorization: Bearer <SUPER_KEY>`
- `Content-Type: application/json`

**Body:**
```json
{ "slug": "abc123" }
```

**Response:**
```json
{ "success": true }
```

**Example:**
```bash
curl -X DELETE https://pastebin.peme969.dev/api/delete \
  -H "Authorization: Bearer YOUR_SUPER_KEY" \
  -H "Content-Type: application/json" \
  -d '{"slug":"abc123"}'
```

---

### `GET /:slug`

Fetch paste for public viewing (HTML).  
- If password-protected: prompts user for password via browser.
- If expired: returns `410 Gone`.

**Example:**
```bash
curl https://pastebin.peme969.dev/abc123
```

---

### `GET /api/auth`

Verify API key.

**Headers:**
- `Authorization: Bearer <API_KEY>`

**Response:**
- `200 OK`: Authorized
- `401 Unauthorized`: Invalid key

**Example:**
```bash
curl -H "Authorization: Bearer YOUR_API_KEY" https://pastebin.peme969.dev/api/auth
```

---

## ⚠️ Expiration Format

Use ISO-8601 strings in your local time zone:

```
YYYY-MM-DDTHH:mm:ss
```

---

## 🛑 Status Codes

| Code | Meaning                     |
|------|-----------------------------|
| 200  | OK                          |
| 204  | No Content (for OPTIONS)    |
| 400  | Bad Request (e.g., missing slug) |
| 401  | Unauthorized (invalid API key) |
| 404  | Not Found                   |
| 410  | Gone (expired paste)        |

---

## 🧾 Example Paste Object

```json
{
  "text": "Secret note here...",
  "metadata": {
    "created": "2025-07-28T08:00:00.000Z",
    "expiration": "2025-08-01T12:00:00.000Z",
    "password": "optional"
  }
}
```