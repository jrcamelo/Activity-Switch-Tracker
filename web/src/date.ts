function pad(value: number): string {
  return String(value).padStart(2, '0');
}

export function formatDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function formatDisplayDate(dateText: string): string {
  const date = new Date(`${dateText}T12:00:00`);
  const weekday = date.toLocaleDateString(undefined, { weekday: 'long' });

  return `${weekday}, ${pad(date.getDate())}-${pad(date.getMonth() + 1)}-${date.getFullYear()}`;
}

export function todayString(): string {
  return formatDate(new Date());
}

export function addDays(dateText: string, amount: number): string {
  const date = new Date(`${dateText}T12:00:00`);
  date.setDate(date.getDate() + amount);
  return formatDate(date);
}
