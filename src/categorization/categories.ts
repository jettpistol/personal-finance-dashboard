export interface Category {
  id: string
  /** Spanish display name. */
  label: string
}

export const CATEGORIES = [
  { id: 'groceries', label: 'Supermercado y almacén' },
  { id: 'dining', label: 'Restaurantes y cafés' },
  { id: 'delivery', label: 'Delivery' },
  { id: 'transport', label: 'Transporte' },
  { id: 'fuel', label: 'Combustible' },
  { id: 'travel', label: 'Viajes' },
  { id: 'subscriptions', label: 'Suscripciones digitales' },
  { id: 'telecom', label: 'Internet y celular' },
  { id: 'utilities', label: 'Luz, gas y agua' },
  { id: 'housing', label: 'Alquiler y expensas' },
  { id: 'health', label: 'Salud' },
  { id: 'insurance', label: 'Seguros' },
  { id: 'fitness', label: 'Gimnasio' },
  { id: 'entertainment', label: 'Entretenimiento' },
  { id: 'education', label: 'Educación' },
  { id: 'clothing', label: 'Ropa, calzado y deporte' },
  { id: 'home', label: 'Hogar y ferretería' },
  { id: 'electronics', label: 'Electrónica y electrodomésticos' },
  { id: 'shopping', label: 'Compras online y tiendas' },
  { id: 'pets', label: 'Mascotas' },
  { id: 'personal_care', label: 'Cuidado personal' },
  { id: 'government_taxes', label: 'Impuestos y tasas' },
  { id: 'financial_costs', label: 'Intereses e impuestos bancarios' },
  { id: 'cash', label: 'Efectivo' },
] as const satisfies readonly Category[]

export type CategoryId = (typeof CATEGORIES)[number]['id']
