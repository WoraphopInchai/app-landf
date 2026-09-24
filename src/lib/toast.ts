export interface ToastItem {
  id: number;
  message: string;
  type: "success" | "error" | "info";
}

let toastId = 0;
let toasts: ToastItem[] = [];
const listeners: ((toasts: ToastItem[]) => void)[] = [];

export function getToastStore() {
  return toasts;
}

export function subscribeToasts(fn: (toasts: ToastItem[]) => void) {
  listeners.push(fn);
  return () => {
    const idx = listeners.indexOf(fn);
    if (idx !== -1) listeners.splice(idx, 1);
  };
}

function notify() {
  listeners.forEach((fn) => fn([...toasts]));
}

export function showToast(message: string, type: ToastItem["type"] = "success") {
  const item: ToastItem = { id: ++toastId, message, type };
  toasts = [...toasts, item];
  notify();
  setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== item.id);
    notify();
  }, 3500);
}

export function dismissToast(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  notify();
}