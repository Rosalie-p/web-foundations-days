let notes = [
  { id: 1, text: "Buy milk and bread", category: "personal" },
  { id: 2, text: "Finish the Day 3 assignment", category: "study" },
  { id: 3, text: "Email the project report to Grace", category: "work" },
  { id: 4, text: "Revise JavaScript arrays", category: "study" },
  { id: 5, text: "Call mum", category: "personal" },
];

const CATEGORIES = ["personal", "work", "study"];

function searchNotes(word) {
  const target = word.toLowerCase();
  return notes.filter(function (note) {
    return note.text.toLowerCase().includes(target);
  });
}

function longestNote() {
  if (notes.length === 0) {
    return null;
  }
  let longest = notes[0];
  for (const note of notes) {
    if (note.text.length > longest.text.length) {
      longest = note;
    }
  }
  return longest;
}

function countByCategory() {
  const counts = {};
  for (const note of notes) {
    if (counts[note.category] === undefined) {
      counts[note.category] = 1;
    } else {
      counts[note.category]++;
    }
  }
  return counts;
}

function getSummary() {
  const total = notes.length;
  const word = total === 1 ? "note" : "notes";
  if (total === 0) {
    return `0 ${word}.`;
  }
  const counts = countByCategory();
  const parts = [];
  for (const category of CATEGORIES) {
    if (counts[category]) {
      parts.push(`${counts[category]} ${category}`);
    }
  }
  return `${total} ${word}: ${parts.join(", ")}.`;
}

function normalise(text) {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

function isDuplicate(text) {
  const target = normalise(text);
  return notes.some(function (note) {
    return normalise(note.text) === target;
  });
}

function addNote(text, category) {
  const cleaned = text.trim();

  if (cleaned.length < 1 || cleaned.length > 200) {
    console.log("Not added: text must be 1-200 characters.");
    return false;
  }
  if (isDuplicate(cleaned)) {
    console.log("Not added: duplicate note.");
    return false;
  }
  if (!CATEGORIES.includes(category)) {
    console.log("Not added: category must be personal, work or study.");
    return false;
  }

  let maxId = 0;
  for (const note of notes) {
    if (note.id > maxId) {
      maxId = note.id;
    }
  }
  notes.push({ id: maxId + 1, text: cleaned, category: category });
  return true;
}

// Tests
const backup = notes;

console.log(searchNotes("milk")); // [{ id: 1, "Buy milk and bread" }]
console.log(searchNotes("JAVASCRIPT")); // [{ id: 4, "Revise JavaScript arrays" }]
console.log(searchNotes("zebra")); // []

console.log(longestNote()); // { id: 3, "Email the project report to Grace" }
notes = [];
console.log(longestNote()); // null
notes = backup;

console.log(countByCategory()); // { personal: 2, study: 2, work: 1 }
notes = [];
console.log(countByCategory()); // {}
notes = backup;

console.log(getSummary()); // "5 notes: 2 personal, 1 work, 2 study."
notes = [backup[0]];
console.log(getSummary()); // "1 note: 1 personal."
notes = backup;

console.log(isDuplicate("Buy milk and bread")); // true
console.log(isDuplicate("  BUY   milk  AND bread ")); // true
console.log(isDuplicate("Walk the dog")); // false

console.log(addNote("Walk the dog", "personal")); // true
console.log(addNote("walk the dog", "personal")); // "Not added: duplicate note." then false
console.log(addNote("   ", "work")); // "Not added: text must be 1-200 characters." then false
console.log(addNote("Plan a trip", "holiday")); // "Not added: category must be personal, work or study." then false
console.log(getSummary()); // "6 notes: 3 personal, 1 work, 2 study."