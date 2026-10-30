import { flushPromises } from '@vue/test-utils';
import { nextTick } from 'vue';

async function flushTicks(count = 1): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    await nextTick();
  }
}
export async function flushPromisesAndTicks(tickCount = 1): Promise<void> {
  await flushPromises();
  await flushTicks(tickCount);
}
