import { computed, onScopeDispose, ref, type Ref } from 'vue';

const DEFAULT_HOLD_MS = 1200;

export function makeCopyBadgeKey(...parts: Array<string | number | null | undefined>): string {
  return parts.map((part) => String(part ?? '')).join(':');
}

export function useCopyBadgeFeedback(holdMs = DEFAULT_HOLD_MS) {
  const copiedKey = ref<string | null>(null);
  let timer: ReturnType<typeof setTimeout> | null = null;

  function clearTimer(): void {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
  }

  function markCopied(key: string): void {
    clearTimer();
    copiedKey.value = key;
    timer = setTimeout(() => {
      copiedKey.value = null;
      timer = null;
    }, holdMs);
  }

  function isCopied(key: string): boolean {
    return copiedKey.value === key;
  }

  function useIsCopied(key: Ref<string>) {
    return computed(() => copiedKey.value === key.value);
  }

  onScopeDispose(clearTimer);

  return {
    copiedKey,
    markCopied,
    isCopied,
    useIsCopied,
  };
}
