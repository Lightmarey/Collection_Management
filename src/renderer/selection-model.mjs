export function toggleSelection(current, focusedId, itemId) {
  const next = new Set(current.size ? current : focusedId ? [focusedId] : []);
  if (next.has(itemId)) next.delete(itemId);
  else next.add(itemId);
  return next;
}
