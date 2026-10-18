# TicketHub - Design Document

**Summary:** 5 requests/s normally, about 3,300/s in a big sale (about 660x). A seat is never sold twice: the database does a conditional update in a transaction, backed by a UNIQUE constraint.

## 1. Requirements
**Functional:** browse events, view seats, hold seats for 5 minutes, pay, view my tickets, waiting room for popular events.
**Non-functional:** *correctness* (a seat is never sold twice, no double charge); *speed* (pages under 1 s, hold under 500 ms); *fairness* (first come first served, max 6 tickets per order, bots rate limited); *availability* (stays up in a big sale, degrades gracefully).

## 2. Estimates (1 day = 100,000 s)
- **Normal:** 50,000 x 10 pages = 500,000 / 100,000 = **5 requests/s** (peak 25); 5,000 sales = 0.05/s.
- **Big sale:** 200,000 people x 10 requests / 600 s = **about 3,300 requests/s**; about 1,000 hold attempts/s; at most 20,000 / 600 = 33 sales/s.
- **Comparison:** about 660x normal, all at once. 180,000 people will lose and must be told quickly.

## 3. API
| Method | Path | Purpose | OK |
|---|---|---|---|
| GET | /events | browse, search | 200 |
| GET | /events/{id}/seats | seat map | 200 |
| POST | /events/{id}/queue | join waiting room | 202 |
| POST | /holds | hold seats `{eventId, seatIds}` | 201 |
| POST | /holds/{id}/pay | pay (Idempotency-Key header) | 201 |
| GET | /me/tickets | my tickets | 200 |

Errors: 400, 401, 403, 404, **409 Conflict (seat taken)**, 429, 500.

## 4. Data model
```sql
CREATE TABLE users (id BIGINT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL);
CREATE TABLE events (id BIGINT PRIMARY KEY, name TEXT NOT NULL, starts_at TIMESTAMP NOT NULL);
CREATE TABLE seats (
  id BIGINT PRIMARY KEY,
  event_id BIGINT NOT NULL REFERENCES events(id),
  section TEXT NOT NULL, row_label TEXT NOT NULL, seat_number INT NOT NULL,
  status TEXT NOT NULL DEFAULT 'available',  -- available | held | sold
  held_by BIGINT REFERENCES users(id),
  hold_expires_at TIMESTAMP,
  UNIQUE (event_id, section, row_label, seat_number));
CREATE TABLE orders (
  id BIGINT PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id),
  event_id BIGINT NOT NULL REFERENCES events(id),
  idempotency_key TEXT NOT NULL UNIQUE);
CREATE TABLE order_seats (
  order_id BIGINT NOT NULL REFERENCES orders(id),
  seat_id BIGINT NOT NULL UNIQUE REFERENCES seats(id),
  PRIMARY KEY (order_id, seat_id));
```
An event has many seats and many orders; a user has many orders (one-to-many). An order has many seats, but each seat is in at most one order (`UNIQUE seat_id`).

## 5. Preventing double-booking
```sql
BEGIN;
UPDATE seats SET status='held', held_by=:user,
       hold_expires_at = NOW() + INTERVAL '5 minutes'
WHERE id IN (101,102) AND event_id=7
  AND (status='available' OR (status='held' AND hold_expires_at < NOW()));
-- fewer than 2 rows changed -> ROLLBACK, reply 409; else COMMIT
```
Check and change happen in one atomic step, so the second of two simultaneous buyers changes 0 rows and gets a 409. The transaction gives all seats or none. Paying uses a second conditional update (`status='held' AND held_by=:user AND hold_expires_at > NOW()`) in the same transaction as the order. `UNIQUE (seat_id)` is the last safety net, and the idempotency key stops double charges. The cache is display-only.

## 6. Architecture
```
Client -> DNS -> CDN -> Waiting room -> Load balancer -> App servers
App servers -> Cache | Primary DB -> Read replicas | Queue -> Workers
App servers -> Payment provider
```
- **CDN:** serves pages and images from the edge so only real actions reach us.
- **Waiting room:** admits users at a rate we can handle, in order, which is fair.
- **Load balancer:** spreads requests across app servers and skips failed ones.
- **App servers:** stateless logic, auto-scaled before a known sale.
- **Cache:** serves the seat map for 1-2 s so views skip the database.
- **Primary DB:** the only place seats are held and sold.
- **Read replicas:** serve browsing so the primary handles writes.
- **Queue + workers:** send emails and free expired holds in the background.
- **Payment provider:** handles cards so we never store them.

**Surviving the sale:** pre-scale servers, throttle with the waiting room, absorb views with CDN and cache; the primary sees only about 1,000 hold attempts/s on different rows. No single point of failure: several servers, replicated cache, promotable replica.

## 7. Trade-offs
1. **Correctness over availability:** purchases always hit the single primary, so some users wait; a double sale is worse.
2. **Cache freshness vs speed:** a seat may look free when taken, giving a 409; the database decides.
3. **Fairness vs simplicity:** the waiting room adds complexity but stops bots and overload.