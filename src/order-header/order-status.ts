export const OrderStatus = {
  OPEN: 'OPEN', // creada, pendiente de realizar
  COMPLETED: 'COMPLETED', // servicio realizado
  CANCELLED: 'CANCELLED', // cancelada: no aparece en los GET
} as const;

export type OrderStatus = (typeof OrderStatus)[keyof typeof OrderStatus];

export const ORDER_STATUSES = Object.values(OrderStatus);
