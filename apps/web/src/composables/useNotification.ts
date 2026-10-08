import { useConfirm } from 'primevue/useconfirm';
import { useToast } from 'primevue/usetoast';

export interface ConfirmOptions {
  /** Title of the dialog, and label of its button unless `acceptLabel` says otherwise. */
  header?: string;
  acceptLabel?: string;
  /** A destructive action: its button is red. */
  danger?: boolean;
  onReject?: () => void;
}

/** Toasts, and the confirmation dialog of App.vue. */
export function useNotification() {
  const toast = useToast();
  const confirm = useConfirm();

  /** A toast: the message alone, or under a short summary. */
  function notify(severity: 'success' | 'error' | 'warn' | 'info', life: number, message: string, summary?: string) {
    toast.add(summary ? { severity, summary, detail: message, life } : { severity, summary: message, life });
  }

  const showSuccess = (message: string, summary?: string) => notify('success', 3000, message, summary);
  const showError = (message: string, summary?: string) => notify('error', 6000, message, summary);
  const showWarning = (message: string, summary?: string) => notify('warn', 5000, message, summary);
  const showInfo = (message: string, summary?: string) => notify('info', 3000, message, summary);

  /** Asks before an action; the message says what it does and what cannot come back. */
  const confirmAction = (message: string, onAccept: () => void, options: ConfirmOptions = {}) => {
    confirm.require({
      message,
      header: options.header ?? 'Please confirm',
      acceptLabel: options.acceptLabel ?? options.header ?? 'Confirm',
      rejectLabel: 'Cancel',
      acceptClass: options.danger ? 'danger' : undefined,
      accept: onAccept,
      reject: options.onReject,
    });
  };

  const confirmDelete = (itemName: string, onAccept: () => void, consequence = 'This cannot be undone.') => {
    confirmAction(consequence, onAccept, { header: `Delete ${itemName}?`, acceptLabel: 'Delete', danger: true });
  };

  return {
    showSuccess,
    showError,
    showWarning,
    showInfo,
    confirmAction,
    confirmDelete,
  };
}
