import type { ZodError } from 'zod';

// Turns schema errors into sentences people can act on ("Falta la descripción"),
// instead of "description: Too small: expected string to have >=1 characters".

const FIELDS: Record<string, string> = {
  description: 'la descripción',
  amount: 'el monto',
  to_amount: 'el monto recibido',
  account_id: 'la cuenta',
  to_account_id: 'la cuenta destino',
  category_id: 'la categoría',
  date: 'la fecha',
  next_date: 'el próximo vencimiento',
  end_date: 'la fecha de fin',
  first_date: 'la fecha de la primera cuota',
  purchase_date: 'la fecha de compra',
  count: 'la cantidad de cuotas',
  interval: 'la frecuencia',
  frequency: 'la frecuencia',
  name: 'el nombre',
  pattern: 'el texto a buscar',
  target_amount: 'el monto objetivo',
  username: 'el usuario',
  display_name: 'el nombre para mostrar',
  password: 'la contraseña',
  split: 'la división',
  values: 'la división',
  month: 'el mes',
  pct: 'el porcentaje',
};

function field(path: PropertyKey[]): string {
  for (let i = path.length - 1; i >= 0; i--) {
    const key = path[i];
    if (typeof key === 'string' && FIELDS[key]) return FIELDS[key];
  }
  const last = path.filter((p) => typeof p === 'string').at(-1);
  return last ? `el campo «${String(last)}»` : 'un dato';
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function validationMessage(err: ZodError): string {
  const issue = err.issues[0];
  if (!issue) return 'Hay datos inválidos.';
  const f = field(issue.path);
  const i = issue as typeof issue & { minimum?: number | bigint; maximum?: number | bigint; origin?: string; input?: unknown };
  switch (issue.code) {
    case 'invalid_type':
      return i.input === undefined || i.input === null ? `Falta ${f}.` : `${capital(f)} no tiene un formato válido.`;
    case 'too_small':
      if (i.origin === 'string') return Number(i.minimum) <= 1 ? `Falta ${f}.` : `${capital(f)} es demasiado corto (mínimo ${i.minimum} caracteres).`;
      if (i.origin === 'array') return `Falta ${f}.`;
      return `${capital(f)} tiene que ser al menos ${i.minimum}.`;
    case 'too_big':
      if (i.origin === 'string') return `${capital(f)} es demasiado largo (máximo ${i.maximum} caracteres).`;
      return `${capital(f)} no puede ser mayor a ${i.maximum}.`;
    case 'invalid_value':
      return `${capital(f)} no es una opción válida.`;
    default:
      // Custom checks already carry a Spanish message ("Fecha inválida", "Solo letras…").
      return issue.message && !/^(Invalid|Too|Expected)/.test(issue.message) ? `${capital(f)}: ${issue.message}` : `${capital(f)} no es válido.`;
  }
}
