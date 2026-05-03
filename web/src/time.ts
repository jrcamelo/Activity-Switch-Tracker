export function roundUpToFiveMinutes(date = new Date()): string {
  const next = new Date(date);
  const rounded = Math.ceil(next.getMinutes() / 5) * 5;

  if (rounded === 60) {
    next.setHours(next.getHours() + 1);
    next.setMinutes(0, 0, 0);
  } else {
    next.setMinutes(rounded, 0, 0);
  }

  return `${String(next.getHours()).padStart(2, '0')}:${String(next.getMinutes()).padStart(2, '0')}`;
}
