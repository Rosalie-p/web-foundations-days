# Reflection

**The most difficult concept.**
 The hardest idea for me was how a system stays correct when many people act at the same moment, and how the pieces fit together: a cache, replicas, a queue and transactions all solve different problems. I overcame it by turning each question into numbers and small examples. Estimating requests per second showed me which parts really need caching, and writing the booking SQL myself made it clear why a single conditional update stops two people getting the same row. Joining notes and tags through a join table also became clear once I wrote the tables and queries instead of only reading about them. I also found Git confusing when my project sat inside a different repository, and I fixed it by checking where the repository really started before pushing.

**What I would improve.**  Based on the feedback I received, I would explain my diagram more clearly and say why I chose each component, not just what it does. I would also add more detail on failures: what happens when the cache or the database goes down, and how the system recovers.

**What I will learn next.** I want to build a real backend that talks to a database, instead of a practice API, and add login, tests and deployment. After that I want to learn more about databases (indexes, transactions and scaling), and how to monitor a live system.