// There are no accounts: anyone who opens a link joins as a guest. The name
// is kept in this browser so it survives a refresh. The color is not kept
// here; the server hands each person on a board a different one.
const KEY = 'whiteboard-guest-name';

function loadName() {
  try {
    const saved = window.localStorage.getItem(KEY);
    if (saved) return saved;
  } catch {
    // Storage can be blocked (private windows); a fresh name is fine.
  }
  const name = `Guest ${Math.floor(Math.random() * 1000)}`;
  try {
    window.localStorage.setItem(KEY, name);
  } catch {
    // Not saved; it will be a new name next time.
  }
  return name;
}

export const me = { name: loadName() };
