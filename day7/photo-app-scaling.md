# SnapShare Scaling Plan

## 1. Assumptions
10M registered users, 10% active daily, each uploads 1 photo and views 50 feed pages per day; photo 2 MB + 50 KB thumbnail; 1 day = 100,000 s; peak = 5x.
**Daily active users** = 10,000,000 x 10% = **1,000,000**.

## 2. Estimates
- **Uploads:** 1,000,000 / 100,000 = **10/s average, 50/s peak**.
- **Feed views:** 1,000,000 x 50 = 50M / 100,000 = **500/s average, 2,500/s peak**.
- **Storage/year:** (2 TB photos + 50 GB thumbnails) = 2.05 TB/day x 365 = **about 750 TB**.

## 3. Read-heavy or write-heavy?
**Read-heavy** (500 reads vs 10 writes per second, 50:1). So: cache and CDN first, send reads to a replica, and keep slow work (thumbnails) off the upload path.

## 4. Where photos go
Not in the database: 750 TB/year would make it huge, slow and costly to back up. Photos go in **object storage** (e.g. S3); the database holds only each photo's URL and metadata; a CDN serves the files.

## 5. Architecture
```
Users -> CDN -> (miss) Object Storage
Users -> Load Balancer -> App Servers -> Cache
                          App Servers -> DB Primary -> Read Replica
                          App Servers -> Object Storage
                          App Servers -> Queue -> Worker -> Object Storage + DB
```

## 6. Components 
- **CDN:** solves slow image loading far from our servers by serving photos from nearby locations.
- **Load balancer:** solves one server being a bottleneck by spreading requests and skipping failed servers.
- **App servers:** run the logic (login, upload, feed) and scale out because they are stateless.
- **Cache:** solves repeated database reads by keeping popular feeds in memory.
- **Database (primary):** solves reliable storage of users, follows and photo metadata, and takes all writes.
- **Read replica:** solves read overload by serving reads from a copy so the primary stays free.
- **Object storage:** solves where to keep 750 TB/year of files cheaply and durably.
- **Queue:** solves slow uploads by letting the server hand off thumbnail jobs and reply at once.
- **Worker:** solves heavy image processing by making thumbnails in the background.

## 7. Upload flow
1. User uploads a photo; the load balancer sends it to an app server.
2. The server checks login and validates type and size.
3. The server saves the original to **object storage**.
4. It inserts a row in the primary DB (`thumbnail_status = pending`).
5. It puts a "make thumbnail" job on the **queue**.
6. It replies "upload successful" immediately.
7. A **worker** takes the job, reads the original, makes a 50 KB thumbnail.
8. The worker saves it to object storage and sets `thumbnail_status = ready`.
9. Followers' cached feeds are refreshed; the CDN serves the thumbnail.

While pending, the original is safe, the uploader sees a placeholder, and followers see it once `ready`. Failed jobs are retried.

## 8. Trade-offs
1. **Cache speed vs freshness:** feeds may be seconds old; we accept that for speed.
2. **Replica lag:** a read may miss a just-written photo; the uploader's own view reads the primary.
3. **Async thumbnails:** fast uploads, but more parts to run and a short placeholder period.