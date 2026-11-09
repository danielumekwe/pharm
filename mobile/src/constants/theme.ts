// PharmaERP colours (the web app's greens and lime), in light and dark variants.
import { Platform } from 'react-native';

export const Colors = {
  light: {
    text: '#0F1A14',
    textSecondary: '#5B6B62',
    background: '#F2F6F3',
    card: '#FFFFFF',
    border: '#DDE5E0',
    primary: '#0D6A33',
    primaryPressed: '#0A4D29',
    onPrimary: '#FFFFFF',
    accent: '#A3E635',
    danger: '#B42318',
    dangerSoft: '#FDECEA',
    warning: '#B54708',
    warningSoft: '#FEF3E2',
    success: '#067647',
    successSoft: '#E6F4EA',
    inputBackground: '#FFFFFF',
  },
  dark: {
    text: '#EEF4F0',
    textSecondary: '#9DB0A5',
    background: '#0B1410',
    card: '#14211A',
    border: '#24362C',
    primary: '#22A04F',
    primaryPressed: '#1B8642',
    onPrimary: '#FFFFFF',
    accent: '#A3E635',
    danger: '#F97066',
    dangerSoft: '#3A1916',
    warning: '#FDB022',
    warningSoft: '#3A2A10',
    success: '#47CD89',
    successSoft: '#123222',
    inputBackground: '#0F1A14',
  },
} as const;

export type Palette = { [K in keyof typeof Colors.light]: string };

export const Spacing = { one: 4, two: 8, three: 12, four: 16, five: 24, six: 32 } as const;
export const Radius = { small: 10, medium: 14, large: 20 } as const;
export const Fonts = Platform.select({ ios: { mono: 'Menlo' }, default: { mono: 'monospace' } });
