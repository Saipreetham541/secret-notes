// The everyday notes app: stored only in this browser, never synced.
const KEY = 'notes:v1';

const DAY = 86400000;
function seed() {
  const now = Date.now();
  return [
    {
      id: 'n1',
      title: 'Groceries',
      body: 'Groceries\n\n- eggs\n- spinach\n- greek yogurt\n- rice (basmati)\n- onions, tomatoes\n- coffee filters\n- dish soap',
      updated: now - 2 * 3600000,
    },
    {
      id: 'n2',
      title: 'Weekend',
      body: 'Weekend\n\nSat: laundry, call the plumber about the sink\nSun: farmers market in the morning, meal prep\n\nMaybe try the new ramen place?',
      updated: now - DAY,
    },
    {
      id: 'n3',
      title: 'Books to read',
      body: 'Books to read\n\n1. The Pragmatic Programmer\n2. Atomic Habits\n3. Project Hail Mary\n4. Sapiens',
      updated: now - 4 * DAY,
    },
    {
      id: 'n4',
      title: 'Workout plan',
      body: 'Workout plan\n\nMon – push\nWed – pull\nFri – legs\n\n20 min walk on other days',
      updated: now - 9 * DAY,
    },
  ].map((n) => ({ ...n, body: n.body.split('\n').slice(2).join('\n') }));
}

export function loadNotes() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  const notes = seed();
  saveNotes(notes);
  return notes;
}

export function saveNotes(notes) {
  try {
    localStorage.setItem(KEY, JSON.stringify(notes));
  } catch {}
}
