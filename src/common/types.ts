export const ReminderType = {
    CONFIRMATION: 'CONFIRMATION',
    REMINDER: 'REMINDER'
}

export type ReminderType = (typeof ReminderType)[keyof typeof ReminderType];

export const REMINDER_TYPE = Object.values(ReminderType);