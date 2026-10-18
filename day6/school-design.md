# School Database Design

## Tables

- **students** – one row per student: `student_id` (primary key), `name` and a `UNIQUE` `email`, both required.
- **courses** – one row per course: `course_id` (primary key), `title` and `credits`.
- **enrolments** – one row per student-on-a-course: its own `enrolment_id` primary key, foreign keys `student_id` and `course_id`, and the `grade`. A `UNIQUE (student_id, course_id)` constraint stops the same student enrolling on the same course twice. The grade is allowed to be NULL because it is unknown until the student is marked.

## Relationships

- **students → enrolments is one-to-many**: one student can have many enrolments, but each enrolment belongs to exactly one student.
- **courses → enrolments is one-to-many**: one course has many enrolments, but each enrolment is for exactly one course.
- **students ↔ courses is many-to-many**: a student takes many courses and a course has many students.

A relational table cannot store a many-to-many relationship directly. Putting a list of course IDs in a student row (or student IDs in a course row) would break the one-value-per-column rule, make queries awkward and make updates error-prone. The `enrolments` join table solves this by turning the many-to-many into two one-to-many relationships. It is also the natural home for data about the relationship itself, which is the grade: it belongs to neither the student nor the course alone, only to the pair.

## Index

I would add an index on `enrolments(course_id)`:

```sql
CREATE INDEX idx_enrolments_course_id ON enrolments (course_id);
```

The `UNIQUE (student_id, course_id)` constraint already creates an index that helps lookups by student, but not lookups by course alone. Queries like "all students on one course" and "number of students per course" filter and join on `course_id`, so without this index the database must scan the whole enrolments table as it grows.

## SQL or NoSQL?

I would choose SQL (a relational database) for this system. The data is highly structured and consists of clearly related entities, and the rules I care about, such as unique emails, no duplicate enrolments and enrolments that must point to real students and courses, are exactly what primary keys, foreign keys and UNIQUE constraints enforce. Queries across relationships (joins, counts per course, finding students with no enrolments) are simple in SQL, and transactions keep records like grades consistent. A NoSQL document store could be faster to start with or scale horizontally for huge volumes, but it would push integrity checks into application code and make cross-entity queries harder. A school's data is small enough that scaling is not a concern, so the strong consistency and flexible querying of SQL win.