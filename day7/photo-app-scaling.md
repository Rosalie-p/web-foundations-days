# SnapShare Scaling Plan

SnapShare is a photo-sharing app where users upload photos and scroll a feed of photos from people they follow.

## 1. Assumptions

- 10,000,000 registered users.
- 10% of them are active each day.
- Each active user uploads 1 photo per day.
- Each active user views 50 feed pages per day.
- An average photo is 2 MB; each photo also gets a 50 KB thumbnail.
- One day is about 100,000 seconds (the real figure is 86,400, so this slightly underestimates).
- Peak traffic is 5× the average.

**Daily active users (DAU)** = 10,000,000 × 10% = **1,000,000**

## 2. Estimates

### Uploads per second

- Uploads per day = 1,000,000 users × 1 photo = 1,000,000
- Average = 1,000,000 ÷ 100,000 = **10 uploads/second**
- Peak = 10 × 5 = **50 uploads/second**

### Feed views per second

- Feed views per day = 1,000,000 users × 50 = 50,000,000
- Average = 50,000,000 ÷ 100,000 = **500 feed views/second**
- Peak = 500 × 5 = **2,500 feed views/second**

### Photo storage per year

- Originals per day = 1,000,000 × 2 MB = 2,000,000 MB = 2 TB
- Thumbnails per day = 1,000,000 × 50 KB = 50,000,000 KB = 50 GB
- Total per day = 2 TB + 0.05 TB = 2.05 TB
- Per year = 2.05 TB × 365 ≈ **750 TB** (about 730 TB of originals plus 18 TB of thumbnails)

### Upload bandwidth (extra check)

- Average = 10 uploads/s × 2 MB = 20 MB/s; peak = 50 × 2 MB = 100 MB/s.

## 3. Read-heavy or write-heavy?

SnapShare is **read-heavy**. There are 500 feed views per second against 10 uploads per second, a ratio of about **50 reads to 1 write**.

What this means for the design:

- Optimise the read path first: cache hot data, serve images through a CDN, and send reads to a read replica.
- Reads can be scaled by adding copies (cache nodes, replicas, CDN locations), so the design leans on that.
- Writes are rare, so one primary database can handle them for now. Slow work on the write path (thumbnails) is moved into the background so uploads stay fast.

## 4. Why photos should not be stored inside the database

At 750 TB a year, photos would make the database enormous. Large binary blobs slow queries, backups and replication, and they take up expensive database storage. Databases are built for small structured rows, not for streaming big files.

Photos go in **object storage** (for example Amazon S3), which is cheap, very durable and built for huge files. The database stores only the **URL or key** of each photo plus its metadata (owner, caption, time, thumbnail URL). A CDN then serves the files to users.

## 5. Architecture diagram

```
                              +-----------+
                              |   Users   |
                              | (web/app) |
                              +-----+-----+
                                    |
              +---------------------+----------------------+
              | images / thumbnails                        | API requests
              v                                            v
        +-----------+                              +---------------+
        |    CDN    |                              | Load Balancer |
        +-----+-----+                              +-------+-------+
              | cache miss                          |       |       |
              v                                     v       v       v
     +------------------+                      +-------+ +-------+ +-------+
     |  Object Storage  |<---------------------|  App  | |  App  | |  App  |
     | (photos + thumbs)|   store / read files | Server| | Server| | Server|
     +--------+---------+                      +---+---+ +---+---+ +---+---+
              ^                                     |         |         |
              |                    +----------------+---------+---------+
              |                    |                |                   |
              |                    v                v                   v
              |              +-----------+   +--------------+     +-----------+
              |              |   Cache   |   |   Database   |     |   Queue   |
              |              |  (Redis)  |   |   (primary)  |     |           |
              |              +-----------+   +------+-------+     +-----+-----+
              |                                     |                   |
              |                                     | replication       | jobs
              |                                     v                   v
              |                              +--------------+     +-----------+
              |                              | Read Replica |     |  Worker   |
              |                              | (feed reads) |     | (thumbs)  |
              |                              +--------------+     +-----+-----+
              |                                                         |
              +---------------- saves thumbnail <-----------------------+
                                (worker also updates the database)
```

Reads of the feed go: App server → Cache → (on a miss) Read Replica.
Writes go: App server → Primary database.

## 6. What each component does

- **CDN:** it solves slow image loading for users far from our servers by serving cached photos and thumbnails from locations close to them, which also takes load off our own servers.
- **Load balancer:** it solves a single server being a bottleneck and a single point of failure by spreading incoming requests across several app servers and skipping any that are down.
- **App servers:** they run the application logic (login, upload, feed building) and are stateless, so we can add more of them as traffic grows.
- **Cache:** it solves the database being hit by the same feed queries over and over by keeping popular results in fast memory, which cuts both latency and database load.
- **Database (primary):** it solves the need for reliable, structured storage of users, follows, photo metadata and comments, and it is the one place that accepts writes.
- **Read replica:** it solves the database being overloaded by 50× more reads than writes by holding a copy of the data that serves read queries, leaving the primary free for writes.
- **Object storage:** it solves where to put 750 TB a year of photo files by providing cheap, durable storage built for large files, so the database stays small and fast.
- **Queue:** it solves slow uploads and traffic spikes by letting the app server hand off slow work (thumbnail creation) as a job and respond immediately.
- **Worker:** it solves the cost of image processing on the request path by picking jobs off the queue, creating the 50 KB thumbnails in the background, and scaling independently of the app servers.

## 7. Upload flow, step by step

1. The user picks a photo in the app and sends the upload request.
2. The request reaches the **load balancer**, which forwards it to a healthy **app server**.
3. The app server checks the user is logged in and validates the file (type and size limit).
4. The app server saves the original 2 MB photo to **object storage** and gets back its key/URL.
5. The app server inserts a row in the **primary database** (photo id, owner, URL, time, `thumbnail_status = pending`).
6. The app server puts a "create thumbnail for photo #id" job on the **queue**.
7. The app server immediately replies "upload successful" to the user, so the upload feels fast.
8. A **worker** takes the job from the queue, downloads the original from object storage and creates a 50 KB thumbnail.
9. The worker saves the thumbnail to object storage and updates the database row with the thumbnail URL and `thumbnail_status = ready`.
10. The worker (or app server) invalidates or updates the cached feeds of the uploader's followers, so the new photo can appear.
11. When followers scroll their feed, they load the thumbnail through the **CDN**, which fetches it from object storage on the first miss and caches it afterwards.

If the worker fails, the job stays in the queue and is retried, so the thumbnail is not lost.

## 8. Trade-offs

1. **Cache speed vs freshness.** Caching feeds makes the app much faster and protects the database, but a cached feed can be a few seconds or minutes out of date, so a new photo may not appear straight away. We accept this because feeds do not need to be instant. A shorter cache lifetime gives fresher data but less benefit.
2. **Read replica lag (eventual consistency).** The replica copies data from the primary a moment after it is written, so a read from the replica may not include a just-uploaded photo. We gain read capacity but lose strict consistency. The uploader's own recent photos can be read from the primary or cache to avoid confusion.
3. **Asynchronous thumbnails vs simplicity.** Using a queue and worker keeps uploads fast and handles spikes, but it adds more moving parts to run and monitor, and a new photo briefly has no thumbnail (the app shows a placeholder). Making thumbnails inside the upload request would be simpler but slower and fragile under load.
4. **Cost vs performance.** A CDN, replicas and 750 TB of yearly storage cost money. They buy speed and reliability, so we can reduce cost by moving old photos to cheaper storage tiers or compressing images, at the cost of slower access to old photos.