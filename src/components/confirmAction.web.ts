export function confirmAction(title: string, message: string, _label: string, action: () => void) {
  if (window.confirm([title, message].filter(Boolean).join('\n\n'))) action();
}
