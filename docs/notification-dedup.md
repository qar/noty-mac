# Notification Deduplication

## Problem

The original implementation used ntfy.sh's `?poll=1` mode, which makes a one-shot request that returns recent messages and then closes the connection. This meant no real-time delivery — new messages only appeared on app restart. Additionally, `handleNotification` generated a random ID (`crypto.randomBytes`) for each incoming message and hardcoded `read: false` with no deduplication, so every restart produced duplicate unread entries.

## Solution

A two-layer deduplication strategy:

### 1. Streaming connection with `since` — real-time delivery and history recovery

Replaced `?poll=1` (one-shot) with ntfy.sh's streaming `/json` endpoint. This endpoint first delivers all messages after the `since` timestamp, then keeps the connection open for real-time push. On first subscription (no history), `since=all` fetches the full backlog.

```
GET {channel.url}/json?since={lastTimestamp}
```

Source: `src/main/ntfy-client.js` → `startSSEConnection()`

### 2. `ntfyId` check — fallback dedup guard

Every ntfy.sh message carries a unique `id` field. This is persisted as the notification's `ntfyId` property. Before inserting, `handleNotification` checks whether a notification with the same `ntfyId` already exists in the store. If so, it skips the message entirely.

```js
if (data.id && notifications.some(n => n.ntfyId === data.id)) {
  return;
}
```

Source: `src/main/ntfy-client.js` → `handleNotification()`

## Data Model

Notification schema defined in `src/main/store.js`:

| Field | Type | Description |
|-------|------|-------------|
| id | string | Internal app ID (randomly generated) |
| ntfyId | string | Native ntfy.sh message ID, used for dedup |
| channelId | string | ID of the subscribed channel |
| title | string | Notification title |
| message | string | Notification body |
| timestamp | number | Unix timestamp (seconds) |
| read | boolean | Whether the notification has been read |

## Data Flow

```
App launch
  → subscribeToAllChannels()
    → startSSEConnection(channel)
      → compute since = max timestamp of stored notifications for this channel
      → GET /json?since={since}   (streaming — stays open for real-time push)
      → message received
        → handleNotification()
          → ntfyId exists in store? → skip
          → new message → create notification object, write to store
          → show system notification
          → emit('notification')
```

## Files

- `src/main/ntfy-client.js` — dedup logic, `since` parameter
- `src/main/store.js` — `ntfyId` field in notification schema