import type { HistoryEntry } from "./historyTypes";

const STORAGE_KEY = "style-builder-history";
const MAX_ENTRIES = 100;

// Get all history entries
export function getHistory(): HistoryEntry[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return [];
    return JSON.parse(stored) as HistoryEntry[];
  } catch {
    return [];
  }
}

// Save a new history entry
export function saveHistoryEntry(entry: Omit<HistoryEntry, "id" | "timestamp">): HistoryEntry {
  const history = getHistory();
  const newEntry: HistoryEntry = {
    ...entry,
    id: crypto.randomUUID(),
    timestamp: Date.now(),
  };

  // Add to front
  history.unshift(newEntry);

  // Keep only last MAX_ENTRIES
  const trimmed = history.slice(0, MAX_ENTRIES);

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch (e) {
    console.error("Failed to save history:", e);
  }

  return newEntry;
}

// Delete a history entry
export function deleteHistoryEntry(id: string): void {
  const history = getHistory();
  const filtered = history.filter((e) => e.id !== id);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
  } catch (e) {
    console.error("Failed to delete history entry:", e);
  }
}

// Clear all history
export function clearHistory(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (e) {
    console.error("Failed to clear history:", e);
  }
}

