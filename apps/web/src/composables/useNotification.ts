import { useToast } from "primevue/usetoast";
import { useConfirm } from "primevue/useconfirm";

export function useNotification() {
  const toast = useToast();
  const confirm = useConfirm();

  const showSuccess = (message: string, summary = "Success") => {
    toast.add({
      severity: "success",
      summary,
      detail: message,
      life: 3000,
    });
  };

  const showError = (message: string, summary = "Error") => {
    toast.add({
      severity: "error",
      summary,
      detail: message,
      life: 5000,
    });
  };

  const showWarning = (message: string, summary = "Warning") => {
    toast.add({
      severity: "warn",
      summary,
      detail: message,
      life: 4000,
    });
  };

  const showInfo = (message: string, summary = "Info") => {
    toast.add({
      severity: "info",
      summary,
      detail: message,
      life: 3000,
    });
  };

  const confirmAction = (
    message: string,
    onAccept: () => void,
    onReject?: () => void,
    header = "Confirmation"
  ) => {
    confirm.require({
      message,
      header,
      icon: "pi pi-exclamation-triangle",
      accept: onAccept,
      reject: onReject,
    });
  };

  const confirmDelete = (
    itemName: string,
    onAccept: () => void,
    onReject?: () => void
  ) => {
    confirm.require({
      message: `Are you sure you want to delete "${itemName}"? This action cannot be undone.`,
      header: "Confirm Deletion",
      icon: "pi pi-exclamation-triangle",
      acceptClass: "p-button-danger",
      rejectClass: "p-button-secondary",
      acceptLabel: "Delete",
      rejectLabel: "Cancel",
      accept: onAccept,
      reject: onReject,
    });
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
