import type { AgentKind } from './types';

export interface IntentMeta {
  label: string;
  icon: string;        // emoji icon
  badgeColor: string;  // Tailwind bg/text classes
}

export const intentMeta: Record<AgentKind, IntentMeta> = {
  vision: {
    label: 'Vision',
    icon: '👁',
    badgeColor: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300',
  },
  coding: {
    label: 'Code',
    icon: '</>',
    badgeColor: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  },
  architecture: {
    label: 'Architecture',
    icon: '🗺',
    badgeColor: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  },
  imageGeneration: {
    label: 'Image Gen',
    icon: '🎨',
    badgeColor: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300',
  },
  general: {
    label: 'General',
    icon: '💬',
    badgeColor: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  },
};
