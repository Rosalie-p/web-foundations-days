-- Day 6: School database (SQLite)
PRAGMA foreign_keys = ON;

DROP TABLE IF EXISTS enrolments;
DROP TABLE IF EXISTS courses;
DROP TABLE IF EXISTS students;

-- ---------- TABLES ----------
CREATE TABLE students (
    student_id INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    email      TEXT NOT NULL UNIQUE
);

CREATE TABLE courses (
    course_id INTEGER PRIMARY KEY,
    title     TEXT NOT NULL,
    credits   INTEGER NOT NULL DEFAULT 10
);

CREATE TABLE enrolments (
    enrolment_id INTEGER PRIMARY KEY,
    student_id   INTEGER NOT NULL,
    course_id    INTEGER NOT NULL,
    grade        TEXT,  -- NULL until the student has been graded
    FOREIGN KEY (student_id) REFERENCES students (student_id),
    FOREIGN KEY (course_id)  REFERENCES courses (course_id),
    UNIQUE (student_id, course_id)  -- same student cannot enrol on the same course twice
);

-- ---------- SAMPLE DATA ----------
INSERT INTO students (student_id, name, email) VALUES
    (1, 'Amina Otieno', 'amina@example.com'),
    (2, 'Brian Kiprop', 'brian@example.com'),
    (3, 'Chloe Wanjiru', 'chloe@example.com'),
    (4, 'David Mwangi', 'david@example.com');

INSERT INTO courses (course_id, title, credits) VALUES
    (1, 'Databases', 15),
    (2, 'Web Development', 20),
    (3, 'Algorithms', 15),
    (4, 'Cyber Security', 10);

INSERT INTO enrolments (student_id, course_id, grade) VALUES
    (1, 1, 'A'),
    (1, 2, 'B'),
    (2, 1, 'B'),
    (2, 3, NULL),
    (3, 1, 'C'),
    (3, 2, 'A');
-- David has no enrolments; Cyber Security has no students.

-- ---------- QUERIES ----------

-- 1. All courses for one student (by name)
SELECT s.name, c.title, e.grade
FROM students s
JOIN enrolments e ON e.student_id = s.student_id
JOIN courses c    ON c.course_id  = e.course_id
WHERE s.name = 'Amina Otieno';

-- 2. All students on one course
SELECT c.title, s.name, s.email
FROM courses c
JOIN enrolments e ON e.course_id  = c.course_id
JOIN students s   ON s.student_id = e.student_id
WHERE c.title = 'Databases';

-- 3. Number of students per course (LEFT JOIN keeps courses with 0 students)
SELECT c.title, COUNT(e.enrolment_id) AS student_count
FROM courses c
LEFT JOIN enrolments e ON e.course_id = c.course_id
GROUP BY c.course_id, c.title
ORDER BY student_count DESC;

-- 4. Students who have no enrolments
SELECT s.student_id, s.name
FROM students s
LEFT JOIN enrolments e ON e.student_id = s.student_id
WHERE e.enrolment_id IS NULL;

-- 5. Update one enrolment's grade (Brian's Algorithms grade)
UPDATE enrolments
SET grade = 'B+'
WHERE student_id = (SELECT student_id FROM students WHERE name = 'Brian Kiprop')
  AND course_id  = (SELECT course_id  FROM courses  WHERE title = 'Algorithms');

-- Check the update
SELECT s.name, c.title, e.grade
FROM enrolments e
JOIN students s ON s.student_id = e.student_id
JOIN courses c  ON c.course_id  = e.course_id
WHERE s.name = 'Brian Kiprop';