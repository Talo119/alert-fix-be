export const FrequencyUnit = {
  DAY: 'DAY',
  MONTH: 'MONTH',
} as const;

export type FrequencyUnit = (typeof FrequencyUnit)[keyof typeof FrequencyUnit];

export const FREQUENCY_UNITS = Object.values(FrequencyUnit);
