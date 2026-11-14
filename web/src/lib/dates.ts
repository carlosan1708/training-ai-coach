/** Local calendar date: UTC conversion can move evening entries to tomorrow. */
export function localDateKey(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function shiftDateKey(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  return localDateKey(new Date(year, month - 1, day + days, 12));
}

export const isDateKey = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  return localDateKey(new Date(year, month - 1, day, 12)) === value;
};
