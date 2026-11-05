/** Design tokens — minimalist: white/grey surfaces, one blue primary, green only for success, red only for errors. */
export const Colors = {
  primary: '#2563EB',
  primaryLight: '#EFF6FF',
  primaryDark: '#1D4ED8',
  success: '#16A34A',
  successLight: '#F0FDF4',
  error: '#DC2626',
  errorLight: '#FEF2F2',
  warning: '#D97706',
  warningLight: '#FFFBEB',

  surface: '#FFFFFF',
  bg: '#F3F4F6',
  bgSecondary: '#E5E7EB',
  border: '#E5E7EB',
  borderFocus: '#2563EB',

  textPrimary: '#111827',
  textSecondary: '#6B7280',
  textDisabled: '#9CA3AF',
  textInverse: '#FFFFFF',
  textLink: '#2563EB',
} as const;

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

/** Minimum 48dp touch target as per Material and iOS HIG guidelines. */
export const MIN_TOUCH_TARGET = 48;

export const Radius = {
  sm: 6,
  md: 10,
  lg: 16,
  full: 999,
} as const;

export const FontSize = {
  xs: 11,
  sm: 13,
  md: 15,
  lg: 17,
  xl: 20,
  xxl: 24,
  h1: 30,
} as const;

export const FontWeight = {
  regular: '400' as const,
  medium: '500' as const,
  semibold: '600' as const,
  bold: '700' as const,
};

export const Shadow = {
  sm: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  md: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 3,
  },
} as const;
