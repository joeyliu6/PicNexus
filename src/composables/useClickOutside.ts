import { ref, onMounted, onUnmounted, type Ref } from 'vue';

export interface ClickOutsideOptions {
  /** 是否立即启用监听（默认 true） */
  immediate?: boolean;
}

export function useClickOutside(
  callback: () => void,
  options: ClickOutsideOptions = {}
) {
  const { immediate = true } = options;

  const target = ref<HTMLElement | null>(null);
  const isActive = ref(immediate);

  function handleClick(event: MouseEvent) {
    if (!isActive.value || !target.value) return;

    const clickTarget = event.target as Node;
    if (!target.value.contains(clickTarget)) {
      callback();
    }
  }

  function start() {
    isActive.value = true;
  }

  function stop() {
    isActive.value = false;
  }

  onMounted(() => {
    document.addEventListener('click', handleClick);
  });

  onUnmounted(() => {
    document.removeEventListener('click', handleClick);
  });

  return {
    target,
    start,
    stop,
    isActive: isActive as Ref<boolean>
  };
}

export function useMultiClickOutside(
  targets: Ref<HTMLElement | null>[],
  callback: () => void
) {
  const isActive = ref(true);

  function handleClick(event: MouseEvent) {
    if (!isActive.value) return;

    const clickTarget = event.target as Node;
    const isOutside = targets.every(target => {
      return !target.value || !target.value.contains(clickTarget);
    });

    if (isOutside) {
      callback();
    }
  }

  function start() {
    isActive.value = true;
  }

  function stop() {
    isActive.value = false;
  }

  onMounted(() => {
    document.addEventListener('click', handleClick);
  });

  onUnmounted(() => {
    document.removeEventListener('click', handleClick);
  });

  return {
    start,
    stop,
    isActive: isActive as Ref<boolean>
  };
}
