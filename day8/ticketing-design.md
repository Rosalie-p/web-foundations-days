# TicketHub: System Design

TicketHub is a website that sells tickets for concerts and events. This document follows the six-part framework: requirements, estimates, API, data model, architecture and trade-offs, and it explains how two people are prevented from buying the same seat.

## 1. Requirements

### Functional
- Users can register, log in and log out.
- Users can browse and search events (artist, city, date).
- Users can view an event's seat map and see which seats are available.
- Users can hold one or more seats for a short time (5 minutes) while they pay.
- Users can pay for held seats and receive their tickets and a confirmation email.
- Users can view their own tickets and orders.
- For very popular events, users wait in a queue before they can buy.

### Non-functional
- **Speed:** event pages and seat maps load in under 1 second; holding a seat responds in under 500 ms, even during a big sale.
- **Correctness:** a seat is **never sold to two people**; nobody is charged without receiving a ticket; a payment retried by accident does not charge twice.
- **Fairness:** buyers are served roughly first come, first served; one person cannot grab the whole venue (a limit of 6 tickets per order), and bots are rate limited.
- **Availability:** the site stays up during a big sale (about 99.9%); if parts are overloaded, it slows down gracefully instead of crashing.
- **Scalability:** it must handle a sudden burst hundreds of times above normal traffic.
- **Durability and security:** paid orders are never lost; passwords are hashed; card details are handled by an external payment provider over HTTPS.

## 2. Estimates

Assumptions: 2 million registered users; one day ≈ 100,000 seconds; peak = 5× average on a normal day.

### Normal day
| Measure | Calculation | Result |
|---------|-------------|--------|
| Page views per day | 50,000 visitors × 10 pages | 500,000 |
| **Page views per second** | 500,000 ÷ 100,000 | **5 average, 25 peak** |
| Tickets sold per day | given | 5,000 |
| **Purchases per second** | 5,000 ÷ 100,000 | **0.05 average, 0.25 peak** |

A normal day is tiny: a single database could cope with it easily. The system is very **read-heavy**, because people browse far more than they buy.

### Big sale (200,000 people, 20,000 seats, first 10 minutes = 600 seconds)
Assumption: each person makes about 10 requests in the sale (event page, seat map refreshes, hold attempts, payment).

| Measure | Calculation | Result |
|---------|-------------|--------|
| Users arriving per second | 200,000 ÷ 600 | about **333 users/s** |
| **Requests per second** | 200,000 × 10 ÷ 600 | about **3,300/s** |
| Seat-hold attempts per second | 200,000 × 3 attempts ÷ 600 | about **1,000/s** |
| **Tickets sold per second** | 20,000 ÷ 600 | about **33/s** at most |

The first seconds are even busier than this average, because everyone clicks at once. Demand is 10 people for every seat, so most users will lose, and the system must handle that politely.

### Comparison
| | Normal day | Big sale | Increase |
|---|---|---|---|
| Requests per second | 5 (peak 25) | about 3,300 | about 660× the average, about 130× the normal peak |
| Purchases per second | 0.05 | about 33 | about 660× |

The big sale is hundreds of times busier than normal, and it hits one event and a small group of rows. So we cannot size the system for a normal day: it needs a waiting room, caching and extra servers ready **before** the sale starts. The yearly volume (about 1.8 million tickets a year) is small, so storage is not a concern.

## 3. API

Base path `/api/v1`, JSON, and `Authorization: Bearer <token>` on everything except browsing and login.

| Method | Path | Description | Success |
|--------|------|-------------|---------|
| POST | `/auth/login` | Log in and get a token | 200 |
| GET | `/events?city=&date=&page=` | Browse and search events | 200 |
| GET | `/events/{id}` | Event details | 200 |
| POST | `/events/{id}/queue` | Join the waiting room for a popular event | 202 |
| GET | `/events/{id}/seats` | View the seat map (sections, prices, status) | 200 |
| POST | `/events/{id}/holds` | Hold seats for 5 minutes, body `{ "seatIds": [101, 102] }` | 201 |
| DELETE | `/holds/{holdId}` | Release held seats | 204 |
| POST | `/holds/{holdId}/pay` | Pay for held seats; header `Idempotency-Key` stops double charges | 201 |
| GET | `/me/tickets` | View my tickets | 200 |

Errors: 400 invalid input, 401 not logged in, 403 not allowed (for example not yet admitted from the waiting room), 404 not found, **409 Conflict (a seat was taken by someone else, or the hold expired)**, 429 too many requests, 500 server error.

Example hold request and response:
```json
POST /api/v1/events/7/holds
{ "seatIds": [101, 102] }

201 Created
{ "holdId": "h_9f2", "seatIds": [101, 102], "expiresAt": "2026-10-18T20:05:00Z" }
```

## 4. Data model

### Tables
```sql
CREATE TABLE users (
    id            BIGINT PRIMARY KEY,
    email         TEXT NOT NULL UNIQUE,
    name          TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at    TIMESTAMP NOT NULL
);

CREATE TABLE events (
    id           BIGINT PRIMARY KEY,
    title        TEXT NOT NULL,
    venue        TEXT NOT NULL,
    city         TEXT NOT NULL,
    starts_at    TIMESTAMP NOT NULL,
    on_sale_at   TIMESTAMP NOT NULL
);

CREATE TABLE orders (
    id              BIGINT PRIMARY KEY,
    user_id         BIGINT NOT NULL REFERENCES users (id),
    event_id        BIGINT NOT NULL REFERENCES events (id),
    total_cents     INTEGER NOT NULL,
    status          TEXT NOT NULL,        -- 'paid', 'refunded'
    payment_ref     TEXT UNIQUE,          -- id from the payment provider
    idempotency_key TEXT NOT NULL UNIQUE, -- the same request cannot create two orders
    created_at      TIMESTAMP NOT NULL
);

CREATE TABLE seats (
    id              BIGINT PRIMARY KEY,
    event_id        BIGINT NOT NULL REFERENCES events (id),
    section         TEXT NOT NULL,
    row_label       TEXT NOT NULL,
    seat_number     INTEGER NOT NULL,
    price_cents     INTEGER NOT NULL,
    status          TEXT NOT NULL DEFAULT 'available',  -- 'available', 'held', 'sold'
    held_by         BIGINT REFERENCES users (id),
    hold_expires_at TIMESTAMP,
    order_id        BIGINT REFERENCES orders (id),
    UNIQUE (event_id, section, row_label, seat_number)
);

-- One row per ticket sold. UNIQUE (seat_id) means a seat can be in at most one order, ever.
CREATE TABLE order_items (
    order_id BIGINT NOT NULL REFERENCES orders (id),
    seat_id  BIGINT NOT NULL UNIQUE REFERENCES seats (id),
    PRIMARY KEY (order_id, seat_id)
);

CREATE INDEX idx_seats_event_status ON seats (event_id, status);
```

### Relationships
- **users → orders is one-to-many:** a user places many orders; each order belongs to one user.
- **events → seats is one-to-many:** an event has thousands of seats; each seat row belongs to one event.
- **events → orders is one-to-many:** an event has many orders.
- **orders ↔ seats is many-to-many** over time in principle (an order contains several seats), but because a seat can only be sold once, each seat appears in at most one order. The `order_items` table links them, with `UNIQUE (seat_id)` enforcing that rule.

The index on `(event_id, status)` makes the seat-map query ("available seats for event 7") fast.

## 5. How double-booking is prevented

The guarantee comes from the **database**, not from the cache, the waiting room or the application code. There are three layers.

**1. An atomic conditional update to hold a seat.** Instead of reading "is it free?" and then writing (a race: two people can both read "free"), the check and the change happen in one statement:

```sql
UPDATE seats
SET status = 'held', held_by = :user_id, hold_expires_at = NOW() + INTERVAL '5 minutes'
WHERE id = :seat_id
  AND event_id = :event_id
  AND ( status = 'available'
        OR (status = 'held' AND hold_expires_at < NOW()) );
```

If two people try at the same moment, the database locks the row, runs one update first, and the second then finds the seat no longer matches the condition. The second update changes **0 rows**, so the app returns `409 Conflict`. Only one person can win.

**2. A transaction for several seats.** Holding two or more seats runs inside one transaction, with seats updated in order of id (to avoid deadlocks). If any seat returns 0 rows, the transaction is rolled back, so a user never ends up with half of the seats they asked for.

**3. A conditional update when paying, plus a unique constraint.** Payment only completes the sale if the hold is still the buyer's:

```sql
UPDATE seats
SET status = 'sold', order_id = :order_id
WHERE id = :seat_id AND status = 'held' AND held_by = :user_id AND hold_expires_at > NOW();
```

The order, the seat updates and the `order_items` rows are written in a single transaction, and the payment is only captured if every seat update changed exactly one row. As a final safety net, `UNIQUE (seat_id)` on `order_items` makes the database reject a second order for the same seat even if the code has a bug. An `Idempotency-Key` (unique on `orders`) means a retried payment request cannot create two orders or charge twice.

**Holds expire.** If a user abandons the page, the hold ends after 5 minutes. A worker also sets expired holds back to `available`, and the hold query above allows an expired hold to be taken over.

**The cache is only for display.** The seat map in the cache may be a second or two old, so it can show a seat as free when it was just taken. That only causes a `409` and "seat just taken, please choose another", never a double sale.

## 6. Architecture

```
                         +-----------+
                         |  Clients  |
                         +-----+-----+
                               |
                         +-----v-----+
                         |    DNS    |
                         +-----+-----+
                               |
                         +-----v-----+
                         |    CDN    |  static files, event pages and images
                         +-----+-----+
                               | dynamic requests
                       +-------v--------+
                       | Waiting Room   |  admits a controlled number of users
                       | + Rate Limiter |  per second for popular events
                       +-------+--------+
                               |
                       +-------v--------+
                       | Load Balancer  |
                       +---+----+----+--+
                           |    |    |
                    +------+  +-+--+ +------+
                    |App 1|   |App 2|  | App N |   auto-scaled app servers
                    +--+--+   +--+--+  +---+---+
                       |         |         |
        +--------------+---------+---------+---------------+
        |                        |                         |
  +-----v-----+          +-------v--------+         +------v-------+
  |   Cache   |          |   Database     |         |    Queue     |
  |  (Redis)  |          |   (Primary)    |         +------+-------+
  | seat map, |          +-------+--------+                |
  | events    |                  | replication      +------v-------+
  +-----------+          +-------v--------+         |   Workers    |
                         | Read Replicas  |         | payments,    |
                         | (browsing)     |         | emails,      |
                         +----------------+         | hold expiry  |
                                                    +------+-------+
                                                           |
                                                    +------v-------+
                                                    |   Payment    |
                                                    |   Provider   |
                                                    +--------------+
```

### What each component does
- **Clients:** they let people browse, choose seats and pay, and they poll or refresh the seat map.
- **DNS:** it solves finding the service by turning the site name into the address of the CDN.
- **CDN:** it solves load from images, scripts and event pages by serving them from servers near the user, so only real actions reach our servers.
- **Waiting room and rate limiter:** they solve 200,000 people arriving in seconds by letting users in at a rate the system can handle (for example a few hundred per second), in the order they arrived, which also makes the sale fair and blocks bots.
- **Load balancer:** it solves any one server being overwhelmed or failing by spreading requests across many app servers and skipping unhealthy ones.
- **App servers:** they run the API logic (login, holds, payments); they are stateless, so extra servers can be added automatically in minutes.
- **Cache:** it solves the database being hit thousands of times a second for the same event and seat map, by holding that data in memory and refreshing it every second or two.
- **Primary database:** it solves correctness by being the single source of truth where seat updates, holds and orders happen with transactions and constraints.
- **Read replicas:** they solve browsing traffic competing with purchases, by serving event and ticket reads so the primary can focus on writes.
- **Queue:** it solves slow or failing side tasks blocking customers by letting the app hand off jobs and reply immediately.
- **Workers:** they solve background work: confirming payments, sending ticket emails and releasing expired holds, and retrying when something fails.
- **Payment provider:** it solves safely handling card data and money, so we never store card numbers.

### How it survives the big sale
- **Waiting room first.** Instead of 3,300 requests a second hitting the system, only admitted users reach the seat map and hold endpoints, so the load becomes steady and controllable. Everyone else sees their queue position (served from the CDN or cache).
- **Static content from the CDN** and **seat maps from the cache** (refreshed every 1 to 2 seconds) mean most requests never touch the database.
- **The database only gets the important writes.** About 1,000 hold attempts per second, each on a different seat row, is well within a good primary database's limits. Row-level locking means different seats do not block each other.
- **Auto-scaling and pre-warming.** The sale time is known in advance, so we add app servers, cache capacity and replicas before it starts, rather than reacting after the crash.
- **Graceful degradation.** If the system is under heavy load, the waiting room admits fewer people, and emails and non-essential features slow down, while the seat-booking path stays protected.
- **No single point of failure.** There are several app servers, a replicated cache, a database replica that can be promoted, redundant load balancers, and a replicated queue with several workers.

## 7. Trade-offs

1. **Strong consistency vs speed.** Seats are booked in a single primary database with transactions, which guarantees no double sales but limits write scaling. A faster, more scalable setup such as eventual consistency would risk selling a seat twice, which we cannot accept. At about 1,000 attempts per second this is affordable, and if it grew we could shard by event.
2. **Cached seat map: fast but slightly stale.** The cache protects the database, but users may click a seat that was just taken and get a `409` error. We accept that frustration, because the final decision always comes from the database, and we keep the cache refresh very short.
3. **Waiting room: fairness and stability vs user experience.** Making users wait is annoying and adds a component to run, but without it the site would crash for everybody, and a queue is fairer than whoever has the fastest connection or a bot.
4. **Hold time: 5 minutes.** A short hold releases unsold seats quickly for other buyers, but pressures people who are slow to pay. A long hold is friendlier but lets people lock seats they never buy, so fewer real sales happen. Five minutes is a middle choice that can be tuned.
5. **Cost of pre-scaling.** Adding extra servers before a big sale costs money and may be partly unused, but the cost of failing on a major sale (lost revenue and reputation) is much larger.