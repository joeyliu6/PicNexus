<script setup lang="ts">
import { ref, computed } from 'vue';

export interface TimeGroup {
  id: string; // unique id (e.g., '2023-10')
  label: string; // display label (e.g., '10月')
  year: number;
  month: number;
  date: Date;
  count: number;
}

const props = defineProps<{
  groups: TimeGroup[];
}>();

const emit = defineEmits<{
  (e: 'scroll-to', groupId: string): void;
}>();

// Group by year for the sidebar display
const years = computed(() => {
  const yearsMap = new Map<number, TimeGroup[]>();
  props.groups.forEach(group => {
    if (!yearsMap.has(group.year)) {
      yearsMap.set(group.year, []);
    }
    yearsMap.get(group.year)?.push(group);
  });
  
  // Sort years descending
  return Array.from(yearsMap.keys()).sort((a, b) => b - a).map(year => ({
    year,
    months: yearsMap.get(year)?.sort((a, b) => b.month - a.month) || []
  }));
});

const hoveredGroup = ref<string | null>(null);

const handleClick = (groupId: string) => {
  emit('scroll-to', groupId);
};

</script>

<template>
  <div class="timeline-sidebar">
    <div class="timeline-track">
      <div 
        v-for="yearData in years" 
        :key="yearData.year" 
        class="year-segment"
      >
        <!-- Year Label -->
        <div class="year-label">{{ yearData.year }}</div>
        
        <!-- Months dots -->
        <div class="months-container">
          <div 
            v-for="group in yearData.months" 
            :key="group.id"
            class="month-dot-wrapper"
            @mouseenter="hoveredGroup = group.id"
            @mouseleave="hoveredGroup = null"
            @click="handleClick(group.id)"
          >
            <div class="month-dot"></div>
            
            <!-- Tooltip (visible on hover) -->
            <div class="month-tooltip" :class="{ visible: hoveredGroup === group.id }">
              <span class="tooltip-month">{{ group.label }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.timeline-sidebar {
  width: 48px;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 20px 0;
  overflow-y: auto;
  overflow-x: visible; /* Allow tooltips to overflow */
  user-select: none;
  /* Hide scrollbar but allow scrolling if needed (though typically it fits) */
  scrollbar-width: none; 
}

.timeline-sidebar::-webkit-scrollbar {
  display: none;
}

.timeline-track {
  display: flex;
  flex-direction: column;
  gap: 16px;
  width: 100%;
  align-items: center;
}

.year-segment {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  width: 100%;
}

.year-label {
  font-size: 10px;
  font-weight: bold;
  color: var(--text-secondary);
  opacity: 0.8;
  writing-mode: horizontal-tb;
}

.months-container {
  display: flex;
  flex-direction: column;
  gap: 4px; /* Space between dots */
  width: 100%;
  align-items: center;
}

.month-dot-wrapper {
  position: relative;
  width: 100%;
  height: 12px; /* Hit area height */
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.month-dot {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background-color: var(--text-muted);
  transition: all 0.2s ease;
  opacity: 0.5;
}

/* Hover effects */
.month-dot-wrapper:hover .month-dot {
  width: 8px;
  height: 8px;
  background-color: var(--primary);
  opacity: 1;
}

/* Tooltip */
.month-tooltip {
  position: absolute;
  right: 24px; /* Position to the left of the sidebar */
  top: 50%;
  transform: translateY(-50%) translateX(10px);
  background: rgba(0, 0, 0, 0.8);
  backdrop-filter: blur(4px);
  padding: 4px 8px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  gap: 6px;
  opacity: 0;
  pointer-events: none;
  transition: all 0.2s ease;
  white-space: nowrap;
  z-index: 100;
  box-shadow: 0 2px 8px rgba(0,0,0,0.2);
}

.month-tooltip.visible {
  opacity: 1;
  transform: translateY(-50%) translateX(0);
}

.tooltip-month {
  color: white;
  font-size: 12px;
  font-weight: 600;
}

.tooltip-count {
  color: rgba(255, 255, 255, 0.7);
  font-size: 10px;
}
</style>
