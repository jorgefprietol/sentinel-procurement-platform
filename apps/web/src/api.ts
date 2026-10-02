export type Engine = "dotnet" | "java";
export type Actor = {
  id: string;
  username: string;
  tenant: string;
  role: "REQUESTER" | "APPROVER";
};
export type Purchase = {
  id: string;
  title: string;
  amountCents: number;
  vendor: string;
  status: string;
  createdAt: string;
  ownerId: string;
};
export type Audit = {
  id: number;
  actor: string;
  action: string;
  objectId: string;
  createdAt: string;
};
export class ApiFailure extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}
export async function api<T>(
  engine: Engine,
  path: string,
  body?: unknown,
  key?: string,
): Promise<T> {
  const response = await fetch(`/${engine}/api/v1${path}`, {
    method: body === undefined ? "GET" : "POST",
    credentials: "same-origin",
    headers: {
      "X-Sentinel-Client": "web",
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(key ? { "Idempotency-Key": key } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ code: "unavailable" }));
    throw new ApiFailure(response.status, error.code);
  }
  return response.status === 204 ? (undefined as T) : response.json();
}
export const messages: Record<string, string> = {
  invalid_credentials: "Usuario o contraseña incorrectos.",
  unauthenticated: "Inicia sesión para continuar.",
  rate_limited: "Demasiadas solicitudes. Espera un minuto antes de continuar.",
  daily_quota: "Alcanzaste el límite diario de cinco solicitudes.",
  forbidden: "Tu perfil no tiene permisos para esta acción.",
  already_decided: "Esta solicitud ya tiene una decisión. Actualiza la lista.",
  invalid_purchase:
    "Revisa el título, el proveedor y el importe (máximo $10.000).",
  invalid_origin:
    "El origen de la aplicación no coincide con la configuración del servidor.",
  partner_unavailable: "El servicio de evaluación no está disponible.",
  invalid_partner_response:
    "El proveedor devolvió una respuesta que no pasó la validación.",
  idempotency_conflict: "La operación ya fue utilizada con otros datos.",
  not_found: "La solicitud no está disponible para tu organización.",
};
