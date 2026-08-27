export type ShortcutAction = 'start' | 'continue' | 'end' | 'delete' | 'undo' | 'previous-page' | 'next-page' | 'cancel';

export function getShortcutAction(input: { key: string; ctrlKey?: boolean; metaKey?: boolean; editable?: boolean }): ShortcutAction | null {
  if (input.editable) return null;
  const key = input.key.toLowerCase();
  if ((input.ctrlKey || input.metaKey) && key === 'z') return 'undo';
  if (key === 's') return 'start';
  if (key === 'c') return 'continue';
  if (key === 'e') return 'end';
  if (key === 'x' || key === 'delete' || key === 'backspace') return 'delete';
  if (key === 'arrowleft') return 'previous-page';
  if (key === 'arrowright') return 'next-page';
  if (key === 'escape') return 'cancel';
  return null;
}
