import { Ref } from 'vue';

interface Resource {
  id: number;
  name: string;
  type: string;
}

interface TemplateContext {
  level: string[];
  currentInput: string;
  templateStart: number;
  isInTemplate: boolean;
}

export function useTemplateAutocomplete(allResources: Ref<Resource[]>) {
  const parseTemplateContext = (text: string, cursorPos: number): TemplateContext => {
    const beforeCursor = text.substring(0, cursorPos);

    const lastTemplateStart = beforeCursor.lastIndexOf('{{');
    const lastTemplateEnd = beforeCursor.lastIndexOf('}}');

    if (lastTemplateStart === -1 || lastTemplateEnd > lastTemplateStart) {
      return {
        level: [],
        currentInput: '',
        templateStart: -1,
        isInTemplate: false
      };
    }

    const templateContent = beforeCursor.substring(lastTemplateStart + 2);
    const parts = templateContent.split('.');

    const level: string[] = [];
    let currentInput = '';

    for (let i = 0; i < parts.length - 1; i++) {
      if (parts[i].trim()) {
        level.push(parts[i].trim());
      }
    }

    currentInput = parts[parts.length - 1] || '';

    return {
      level,
      currentInput,
      templateStart: lastTemplateStart,
      isInTemplate: true
    };
  };

  const getSuggestions = (context: TemplateContext): string[] => {
    const { level, currentInput } = context;

    let suggestions: string[] = [];

    if (level.length === 0) {
      suggestions = ['self', 'resource', 'env', 'project'];
    } else if (level[0] === 'self' && level.length === 1) {
      suggestions = ['url', 'name', 'host'];
    } else if (level[0] === 'resource' && level.length === 1) {
      suggestions = allResources.value.map(r => r.name);
    } else if (level[0] === 'resource' && level.length === 2) {
      const resourceName = level[1];
      const resource = allResources.value.find(r => r.name === resourceName);

      if (resource) {
        if (resource.type === 'mysql-db') {
          suggestions = ['host', 'port', 'database', 'username', 'password', 'name'];
        } else {
          suggestions = ['url', 'host', 'name', 'url.internal'];
        }
      }
    } else if (level[0] === 'env' && level.length === 1) {
      suggestions = ['name', 'id'];
    } else if (level[0] === 'project' && level.length === 1) {
      suggestions = ['baseDomain', 'name'];
    } else if (level[0] === 'resource' && level.length === 3 && level[2] === 'url') {
      suggestions = ['internal'];
    }

    if (currentInput) {
      suggestions = suggestions.filter(s =>
        s.toLowerCase().startsWith(currentInput.toLowerCase())
      );
    }

    return suggestions;
  };

  const buildCompletionText = (context: TemplateContext, selectedSuggestion: string): string => {
    const { level } = context;

    const needsClosing =
      (level[0] === 'self' && level.length === 1) ||
      (level[0] === 'resource' && level.length === 2) ||
      (level[0] === 'env' && level.length === 1) ||
      (level[0] === 'project' && level.length === 1) ||
      (level[0] === 'resource' && level.length === 3 && level[2] === 'url' && selectedSuggestion === 'internal');

    return selectedSuggestion + (needsClosing ? '}}' : '.');
  };

  return {
    parseTemplateContext,
    getSuggestions,
    buildCompletionText
  };
}
