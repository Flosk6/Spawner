<template>
  <div class="relative w-full">
    <Textarea
      ref="textareaRef"
      :model-value="modelValue"
      @update:model-value="handleInput"
      @keydown="handleKeydown"
      @click="handleClick"
      :rows="rows"
      :placeholder="placeholder"
      :id="id"
      class="font-mono text-sm w-full"
    />

    <div
      v-if="showSuggestions && filteredSuggestions.length > 0"
      ref="dropdownRef"
      class="autocomplete-dropdown"
      :style="dropdownStyle"
    >
      <div
        v-for="(suggestion, index) in filteredSuggestions"
        :key="suggestion"
        :class="['autocomplete-item', { 'selected': index === selectedIndex }]"
        @mousedown.prevent="selectSuggestion(suggestion)"
        @mouseenter="selectedIndex = index"
      >
        {{ suggestion }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue';
import Textarea from 'primevue/textarea';
import { useTemplateAutocomplete } from '../composables/useTemplateAutocomplete';

interface Resource {
  id: number;
  name: string;
  type: string;
}

interface Props {
  modelValue: string;
  allResources: Resource[];
  rows?: number;
  placeholder?: string;
  id?: string;
}

const props = withDefaults(defineProps<Props>(), {
  rows: 10,
  placeholder: '',
  id: ''
});

const emit = defineEmits<{
  'update:modelValue': [value: string];
}>();

const textareaRef = ref<any>(null);
const dropdownRef = ref<HTMLDivElement | null>(null);
const showSuggestions = ref(false);
const selectedIndex = ref(0);
const dropdownStyle = ref({});

const allResourcesRef = computed(() => props.allResources);
const { parseTemplateContext, getSuggestions, buildCompletionText } = useTemplateAutocomplete(allResourcesRef);

const currentContext = ref({
  level: [] as string[],
  currentInput: '',
  templateStart: -1,
  isInTemplate: false
});

const filteredSuggestions = computed(() => {
  if (!currentContext.value.isInTemplate) return [];
  return getSuggestions(currentContext.value);
});

const updateContext = () => {
  const textarea = textareaRef.value?.$el as HTMLTextAreaElement;
  if (!textarea) return;

  const cursorPos = textarea.selectionStart;
  const text = props.modelValue;

  currentContext.value = parseTemplateContext(text, cursorPos);

  if (currentContext.value.isInTemplate && filteredSuggestions.value.length > 0) {
    showSuggestions.value = true;
    selectedIndex.value = 0;
    nextTick(() => {
      updateDropdownPosition();
    });
  } else {
    showSuggestions.value = false;
  }
};

const updateDropdownPosition = () => {
  const textarea = textareaRef.value?.$el as HTMLTextAreaElement;
  if (!textarea) return;

  const cursorPos = textarea.selectionStart;
  const text = props.modelValue.substring(0, cursorPos);

  const lines = text.split('\n');
  const currentLine = lines.length - 1;
  const currentColumn = lines[currentLine].length;

  const lineHeight = 20;
  const charWidth = 7.2;

  const top = (currentLine + 1) * lineHeight + 8;
  const left = currentColumn * charWidth + 12;

  dropdownStyle.value = {
    top: `${top}px`,
    left: `${left}px`
  };
};

const handleInput = (value: string) => {
  emit('update:modelValue', value);

  nextTick(() => {
    const textarea = textareaRef.value?.$el as HTMLTextAreaElement;
    if (!textarea) return;

    const cursorPos = textarea.selectionStart;
    const charBefore = value.charAt(cursorPos - 1);
    const twoCharsBefore = value.substring(cursorPos - 2, cursorPos);

    if (twoCharsBefore === '}}') {
      showSuggestions.value = false;
      return;
    }

    updateContext();
  });
};

const handleClick = () => {
  nextTick(() => {
    updateContext();
  });
};

const handleKeydown = (event: KeyboardEvent) => {
  if (!showSuggestions.value) return;

  if (event.key === 'ArrowDown') {
    event.preventDefault();
    selectedIndex.value = (selectedIndex.value + 1) % filteredSuggestions.value.length;
    scrollToSelected();
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    selectedIndex.value = selectedIndex.value === 0
      ? filteredSuggestions.value.length - 1
      : selectedIndex.value - 1;
    scrollToSelected();
  } else if (event.key === 'Enter' || event.key === 'Tab') {
    if (filteredSuggestions.value.length > 0) {
      event.preventDefault();
      selectSuggestion(filteredSuggestions.value[selectedIndex.value]);
    }
  } else if (event.key === 'Escape') {
    event.preventDefault();
    showSuggestions.value = false;
  }
};

const scrollToSelected = () => {
  nextTick(() => {
    const dropdown = dropdownRef.value;
    if (!dropdown) return;

    const selectedItem = dropdown.children[selectedIndex.value] as HTMLElement;
    if (selectedItem) {
      selectedItem.scrollIntoView({ block: 'nearest' });
    }
  });
};

const selectSuggestion = (suggestion: string) => {
  const textarea = textareaRef.value?.$el as HTMLTextAreaElement;
  if (!textarea) return;

  const cursorPos = textarea.selectionStart;
  const text = props.modelValue;

  const beforeTemplate = text.substring(0, currentContext.value.templateStart + 2);
  const templatePath = currentContext.value.level.join('.') + (currentContext.value.level.length > 0 ? '.' : '');
  const afterCursor = text.substring(cursorPos);

  const completionText = buildCompletionText(currentContext.value, suggestion);
  const newText = beforeTemplate + templatePath + completionText + afterCursor;

  emit('update:modelValue', newText);

  const newCursorPos = beforeTemplate.length + templatePath.length + completionText.length;

  nextTick(() => {
    textarea.focus();
    textarea.setSelectionRange(newCursorPos, newCursorPos);

    if (completionText.endsWith('.')) {
      updateContext();
    } else {
      showSuggestions.value = false;
    }
  });
};

watch(() => props.modelValue, () => {
  nextTick(() => {
    const textarea = textareaRef.value?.$el as HTMLTextAreaElement;
    if (textarea && document.activeElement === textarea) {
      updateContext();
    }
  });
});
</script>

<style scoped>
.autocomplete-dropdown {
  position: absolute;
  background-color: rgb(31 41 55);
  border: 1px solid rgb(55 65 81);
  border-radius: 0.375rem;
  box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05);
  z-index: 50;
  max-height: 15rem;
  overflow-y: auto;
  min-width: 12rem;
}

.autocomplete-item {
  padding: 0.5rem 0.75rem;
  cursor: pointer;
  font-size: 0.875rem;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  transition: background-color 0.15s;
}

.autocomplete-item:hover {
  background-color: rgb(55 65 81);
}

.autocomplete-item.selected {
  background-color: var(--p-primary-500);
  color: white;
}
</style>
