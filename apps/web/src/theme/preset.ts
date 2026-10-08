import { definePreset } from '@primevue/themes';
import Aura from '@primevue/themes/aura';

/** A toast: the card of the interface; style.css gives its icon the tone of the severity. */
const TOAST = {
  background: 'var(--overlay)',
  borderColor: 'var(--border)',
  color: 'var(--text)',
  detailColor: 'var(--text-2)',
  shadow: 'var(--shadow-md)',
  closeButton: { hoverBackground: 'var(--overlay-hover)', focusRing: { color: 'var(--ring)', shadow: 'none' } },
};

/**
 * Aura in the colors of styles/tokens.css. Both surface scales run from light
 * to dark, as Aura expects in each scheme: its dark scheme takes the darkest
 * steps for backgrounds and the lightest for text.
 */
export const SpawnerPreset = definePreset(Aura, {
  primitive: {
    borderRadius: { none: '0', xs: '4px', sm: '6px', md: '8px', lg: '10px', xl: '14px' },
  },
  semantic: {
    primary: {
      50: '#f4f3fa',
      100: '#ebe8f6',
      200: '#d6d0ee',
      300: '#b9afe0',
      400: '#9a8cd4',
      500: '#7a6bc0',
      600: '#574b89',
      700: '#4b4079',
      800: '#3d3463',
      900: '#2f284c',
      950: '#1d1830',
    },
    focusRing: { width: '2px', style: 'solid', color: 'var(--ring)', offset: '1px', shadow: 'none' },
    formField: {
      paddingX: '0.625rem',
      paddingY: '0.3125rem',
      borderRadius: '8px',
      focusRing: { width: '0', style: 'none', color: 'transparent', offset: '0', shadow: '0 0 0 3px var(--ring)' },
    },
    colorScheme: {
      light: {
        surface: {
          0: '#ffffff',
          50: '#f6f6f9',
          100: '#f0f0f4',
          200: '#e4e4ea',
          300: '#d4d4dc',
          400: '#a3a2ae',
          500: '#6b6a76',
          600: '#4b4a55',
          700: '#33323c',
          800: '#24232c',
          900: '#17161d',
          950: '#0e0d13',
        },
        primary: { color: '#574b89', contrastColor: '#ffffff', hoverColor: '#4b4079', activeColor: '#413869' },
        highlight: { background: '#f1effa', focusBackground: '#e9e7f4', color: '#4b4079', focusColor: '#3d3463' },
        mask: { background: 'rgba(23, 22, 29, 0.36)', color: '{surface.200}' },
        formField: {
          background: '#ffffff',
          borderColor: '#d4d4dc',
          hoverBorderColor: '#a3a2ae',
          color: '#17161d',
          placeholderColor: '#6b6a76',
          iconColor: '#6b6a76',
          shadow: '0 1px 2px rgba(23, 22, 29, 0.06)',
        },
        text: { color: '#17161d', hoverColor: '#17161d', mutedColor: '#6b6a76', hoverMutedColor: '#4b4a55' },
        content: { background: '#ffffff', hoverBackground: '#f7f7fa', borderColor: '#e4e4ea', color: '#17161d', hoverColor: '#17161d' },
        overlay: {
          select: { background: '#ffffff', borderColor: '#e4e4ea', color: '#17161d' },
          popover: { background: '#ffffff', borderColor: '#e4e4ea', color: '#17161d' },
          modal: { background: '#ffffff', borderColor: '#e4e4ea', color: '#17161d' },
        },
        list: { option: { focusBackground: '#f2f2f6' } },
        navigation: { item: { focusBackground: '#f2f2f6', activeBackground: '#f2f2f6' } },
      },
      dark: {
        surface: {
          0: '#ffffff',
          50: '#f4f3f8',
          100: '#e8e7ee',
          200: '#d4d3dc',
          300: '#b6b5c2',
          400: '#8d8c9b',
          500: '#6f6e7d',
          600: '#35343f',
          700: '#26252e',
          800: '#1b1a22',
          900: '#15141b',
          950: '#0e0d13',
        },
        primary: { color: '#6e54ff', contrastColor: '#ffffff', hoverColor: '#5f45f0', activeColor: '#5139e0' },
        highlight: { background: 'rgba(110, 84, 255, 0.16)', focusBackground: 'rgba(110, 84, 255, 0.24)', color: '#d4cfff', focusColor: '#ffffff' },
        mask: { background: 'rgba(4, 3, 8, 0.62)', color: '{surface.200}' },
        formField: {
          background: '#15141b',
          borderColor: '#35343f',
          hoverBorderColor: '#4a4956',
          color: '#edecf3',
          placeholderColor: '#8d8c9b',
          iconColor: '#8d8c9b',
          shadow: 'none',
        },
        text: { color: '#edecf3', hoverColor: '#ffffff', mutedColor: '#8d8c9b', hoverMutedColor: '#b6b5c2' },
        content: { background: '#15141b', hoverBackground: '#1b1a22', borderColor: '#26252e', color: '#edecf3', hoverColor: '#ffffff' },
        overlay: {
          select: { background: '#1c1b24', borderColor: '#26252e', color: '#edecf3' },
          popover: { background: '#1c1b24', borderColor: '#26252e', color: '#edecf3' },
          modal: { background: '#1c1b24', borderColor: '#26252e', color: '#edecf3' },
        },
        list: { option: { focusBackground: '#272630' } },
        navigation: { item: { focusBackground: '#272630', activeBackground: '#272630' } },
      },
    },
  },
  components: {
    dialog: {
      header: { padding: '1.125rem 1.25rem 0.75rem' },
      title: { fontSize: 'var(--fs-md)', fontWeight: '600' },
      content: { padding: '0 1.25rem 1.25rem' },
      footer: { padding: '0 1.25rem 1.25rem' },
    },
    toast: {
      colorScheme: {
        light: { root: { blur: '0' }, info: TOAST, success: TOAST, warn: TOAST, error: TOAST, secondary: TOAST },
        dark: { root: { blur: '0' }, info: TOAST, success: TOAST, warn: TOAST, error: TOAST, secondary: TOAST },
      },
    },
    tooltip: {
      colorScheme: {
        light: { root: { background: '#17161d', color: '#ffffff' } },
        dark: { root: { background: '#2a2933', color: '#edecf3' } },
      },
    },
  },
});
