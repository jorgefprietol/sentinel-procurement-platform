import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  api,
  ApiFailure,
  messages,
  type Actor,
  type Engine,
  type Purchase,
  type Audit,
} from "./api";
import "./styles.css";

const controls = [
  [
    "API1",
    "Autorización de objetos",
    "Consultas restringidas por propietario y organización.",
  ],
  [
    "API2",
    "Autenticación",
    "PBKDF2, sesiones con caducidad y bloqueo por frecuencia.",
  ],
  [
    "API3",
    "Protección de propiedades",
    "Contratos estrictos; estado, permisos y organización definidos en el servidor.",
  ],
  [
    "API4",
    "Consumo de recursos",
    "Paginación, tamaño máximo de solicitudes y límites persistentes.",
  ],
  [
    "API5",
    "Permisos por función",
    "Decisiones y auditoría restringidas al perfil de aprobación.",
  ],
  [
    "API6",
    "Flujos de negocio",
    "Cuota diaria, transacciones e idempotencia por operación.",
  ],
  [
    "API7",
    "Destinos de integración",
    "Catálogo cerrado y destino fijo; redirecciones deshabilitadas.",
  ],
  [
    "API8",
    "Configuración segura",
    "Cookies HttpOnly, validación de origen y cabeceras de seguridad.",
  ],
  [
    "API9",
    "Inventario de APIs",
    "Contrato OpenAPI, versión única y rutas documentadas.",
  ],
  [
    "API10",
    "Validación de proveedores",
    "Esquema estricto, tiempo límite y respuesta limitada a 4 KB.",
  ],
];
const currency = (cents: number) =>
  new Intl.NumberFormat("es-EC", { style: "currency", currency: "USD" }).format(
    cents / 100,
  );
function Icon({
  kind,
}: {
  kind: "shield" | "grid" | "list" | "lock" | "activity";
}) {
  const paths = {
    shield: "M12 3l8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3zm-4 9 3 3 5-6",
    grid: "M3 3h7v7H3zm11 0h7v7h-7zM3 14h7v7H3zm11 0h7v7h-7z",
    list: "M8 5h13M8 12h13M8 19h13M3 5h1M3 12h1M3 19h1",
    lock: "M6 10h12v11H6zm3 0V6a3 3 0 0 1 6 0v4",
    activity: "M2 12h4l3-8 6 16 3-8h4",
  };
  return (
    <svg
      width="21"
      height="21"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[kind]} />
    </svg>
  );
}
function App() {
  const [engine, setEngine] = useState<Engine>("dotnet");
  const [actor, setActor] = useState<Actor | null>(null);
  const [rows, setRows] = useState<Purchase[]>([]);
  const [audit, setAudit] = useState<Audit[]>([]);
  const [tab, setTab] = useState("overview");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [risk, setRisk] = useState<{
    vendor: string;
    score: number;
    rating: string;
  } | null>(null);
  const [online, setOnline] = useState<Record<Engine, boolean>>({
    dotnet: false,
    java: false,
  });
  function clearSession() {
    setActor(null);
    setRows([]);
    setAudit([]);
    setRisk(null);
    setTab("overview");
    setShowCreate(false);
    setNotice("");
  }
  function fail(e: unknown) {
    if (e instanceof ApiFailure) {
      setError(messages[e.code] || "No se pudo completar la operación.");
      if (e.status === 401) clearSession();
    } else setError("No fue posible conectar con el servicio.");
  }
  async function refresh(current = engine) {
    const purchases = await api<Purchase[]>(current, "/purchases?limit=50");
    setRows(purchases);
  }
  useEffect(() => {
    let active = true;
    clearSession();
    setError("");
    setLoading(true);
    api<Actor>(engine, "/me")
      .then(async (user) => {
        const data = await api<Purchase[]>(engine, "/purchases?limit=50");
        if (active) {
          setActor(user);
          setRows(data);
        }
      })
      .catch((e) => {
        if (active && !(e instanceof ApiFailure && e.status === 401)) fail(e);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [engine]);
  useEffect(() => {
    for (const service of ["dotnet", "java"] as Engine[])
      api(service, "/meta")
        .then(() => setOnline((previous) => ({ ...previous, [service]: true })))
        .catch(() =>
          setOnline((previous) => ({ ...previous, [service]: false })),
        );
  }, []);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }
  async function signIn(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await run(async () => {
      await api(engine, "/auth/login", {
        username: data.get("username"),
        password: data.get("password"),
      });
      const user = await api<Actor>(engine, "/me");
      const purchases = await api<Purchase[]>(engine, "/purchases?limit=50");
      clearSession();
      setRows(purchases);
      setActor(user);
    });
  }
  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    // Retain the operation key and payload until success, including after a network failure.
    if (!form.dataset.key) form.dataset.key = crypto.randomUUID();
    const body = {
      title: data.get("title"),
      amountCents: Math.round(Number(data.get("amount")) * 100),
      vendor: data.get("vendor"),
    };
    if (form.dataset.payload && form.dataset.payload !== JSON.stringify(body)) {
      form.dataset.key = crypto.randomUUID();
    }
    form.dataset.payload = JSON.stringify(body);
    await run(async () => {
      await api(engine, "/purchases", body, form.dataset.key);
      setShowCreate(false);
      await refresh();
      setNotice("Solicitud creada y registrada en auditoría.");
    });
  }
  async function decide(row: Purchase, decision: string) {
    await run(async () => {
      await api(engine, `/purchases/${row.id}/decision`, { decision });
      await refresh();
      setNotice("Decisión registrada correctamente.");
    });
  }
  async function selectTab(value: string) {
    setTab(value);
    setError("");
    if (value === "audit" && actor)
      await run(async () => setAudit(await api<Audit[]>(engine, "/audit")));
  }
  const pending = rows.filter((row) => row.status === "PENDING");
  return (
    <div className="shell">
      <aside className="sidebar">
        <a className="brand" href="/" aria-label="Sentinel inicio">
          <span className="brand-mark">
            <Icon kind="shield" />
          </span>
          <span>
            SENTINEL<small>PROCUREMENT PLATFORM</small>
          </span>
        </a>
        <div className="workspace">
          <span className="workspace-symbol">S</span>
          <div>
            Workspace
            <small>
              {actor ? `Organización ${actor.tenant}` : "Operaciones seguras"}
            </small>
          </div>
          <span className="workspace-arrow">⌄</span>
        </div>
        <p className="nav-caption">OPERACIONES</p>
        <nav aria-label="Navegación principal">
          <button
            className={tab === "overview" ? "selected" : ""}
            onClick={() => selectTab("overview")}
          >
            <Icon kind="grid" />
            Resumen<span>01</span>
          </button>
          <button
            className={tab === "purchases" ? "selected" : ""}
            onClick={() => selectTab("purchases")}
          >
            <Icon kind="list" />
            Solicitudes{actor && <span>{rows.length}</span>}
          </button>
          <button
            className={tab === "security" ? "selected" : ""}
            onClick={() => selectTab("security")}
          >
            <Icon kind="lock" />
            Controles de API<span>10</span>
          </button>
          {actor?.role === "APPROVER" && (
            <button
              className={tab === "audit" ? "selected" : ""}
              onClick={() => selectTab("audit")}
            >
              <Icon kind="activity" />
              Auditoría
            </button>
          )}
        </nav>
        <div className="sidebar-bottom">
          <div className="security-stamp">
            <Icon kind="shield" />
            <div>
              Seguridad desde el diseño
              <small>Aislamiento por organización</small>
            </div>
          </div>
          <span className="version">SENTINEL / V1.0</span>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <div className="breadcrumb">
            Workspace <span>/</span>{" "}
            {tab === "security"
              ? "Seguridad"
              : tab === "audit"
                ? "Auditoría"
                : "Operaciones"}
          </div>
          <div className="top-right">
            <span className="live">
              <i />
              API {online[engine] ? "disponible" : "sin conexión"}
            </span>
            {actor ? (
              <button
                className="profile"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await api(engine, "/auth/logout", {});
                    clearSession();
                  })
                }
              >
                <span>{actor.username.slice(0, 2).toUpperCase()}</span>
                {actor.username} · Salir
              </button>
            ) : (
              <span className="tag">ACCESO PRIVADO</span>
            )}
          </div>
        </header>
        <main>
          <div className="heading">
            <div>
              <p className="eyebrow">CONTROL · TRAZABILIDAD · CONFIANZA</p>
              <h1>
                {tab === "security"
                  ? "Seguridad de APIs"
                  : tab === "audit"
                    ? "Registro de auditoría"
                    : tab === "purchases"
                      ? "Solicitudes de compra"
                      : "Operaciones, bajo control."}
              </h1>
              <p className="subtitle">
                {tab === "security"
                  ? "Diez riesgos. Controles implementados. Evidencia reproducible."
                  : "Gestiona compras y aprobaciones con límites claros y decisiones trazables."}
              </p>
            </div>
            <a
              className="contract-link"
              href="/openapi.yaml"
              target="_blank"
              rel="noreferrer"
            >
              Contrato API ↗
            </a>
          </div>
          <div className="engine-bar">
            <div>
              <span className="mini-label">IMPLEMENTACIÓN ACTIVA</span>
              <strong>
                {engine === "dotnet"
                  ? "ASP.NET Core · C#"
                  : "Spring Boot · Java"}
              </strong>
            </div>
            <div
              className="engine-switch"
              role="group"
              aria-label="Seleccionar backend"
            >
              <button
                disabled={busy || loading}
                aria-pressed={engine === "dotnet"}
                onClick={() => setEngine("dotnet")}
              >
                .NET
              </button>
              <button
                disabled={busy || loading}
                aria-pressed={engine === "java"}
                onClick={() => setEngine("java")}
              >
                Java
              </button>
            </div>
            <p>Contrato compartido. Persistencia independiente.</p>
          </div>
          {error && (
            <div className="alert error" role="alert">
              {error}
              <button onClick={() => setError("")} aria-label="Cerrar error">
                ×
              </button>
            </div>
          )}
          {notice && (
            <div className="alert success" role="status">
              {notice}
            </div>
          )}
          {tab === "security" ? (
            <>
              <section className="security-banner">
                <Icon kind="shield" />
                <div>
                  <h2>Controles verificables</h2>
                  <p>
                    La matriz describe el diseño. La evidencia de ejecución se
                    genera en el pipeline de integración.
                  </p>
                </div>
                <a
                  href="https://api-security.owasp.org/editions/2023/en/0x11-t10/"
                  target="_blank"
                  rel="noreferrer"
                >
                  OWASP API 2023 ↗
                </a>
              </section>
              <div className="controls-grid">
                {controls.map(([id, title, detail]) => (
                  <article className="control-card" key={id}>
                    <span>{id}:2023</span>
                    <Icon kind="lock" />
                    <h3>{title}</h3>
                    <p>{detail}</p>
                    <div className="control-footer">
                      Implementado <span>↗</span>
                    </div>
                  </article>
                ))}
              </div>
            </>
          ) : loading ? (
            <section className="panel empty" role="status">
              Conectando con el servicio…
            </section>
          ) : !actor ? (
            <div className="welcome-grid">
              <section className="welcome">
                <span className="pill">SECURE OPERATIONS</span>
                <h2>
                  Cada solicitud.
                  <br />
                  Cada decisión.
                  <br />
                  <em>En su lugar.</em>
                </h2>
                <p>
                  Un espacio para gestionar recursos, separar responsabilidades
                  y mantener la trazabilidad de tu operación.
                </p>
                <div className="welcome-features">
                  <span>
                    <Icon kind="shield" />
                    Permisos por organización
                  </span>
                  <span>
                    <Icon kind="activity" />
                    Auditoría de decisiones
                  </span>
                  <span>
                    <Icon kind="lock" />
                    Sesiones de 30 minutos
                  </span>
                </div>
                <div className="welcome-footer">
                  <span>01 / 10</span> OWASP API SECURITY CONTROLS
                </div>
              </section>
              <section className="login panel">
                <div className="login-icon">
                  <Icon kind="lock" />
                </div>
                <p className="eyebrow">ACCESO AL WORKSPACE</p>
                <h2>Bienvenido a Sentinel</h2>
                <p>Inicia sesión con tu cuenta de operaciones.</p>
                <form onSubmit={signIn}>
                  <label>
                    Usuario
                    <input
                      name="username"
                      autoComplete="username"
                      placeholder="Tu usuario"
                      required
                      maxLength={80}
                    />
                  </label>
                  <label>
                    Contraseña
                    <input
                      name="password"
                      type="password"
                      autoComplete="current-password"
                      placeholder="Tu contraseña"
                      required
                      maxLength={256}
                    />
                  </label>
                  <button className="primary" disabled={busy}>
                    {busy ? "Conectando…" : "Entrar al workspace"}
                    <span>→</span>
                  </button>
                </form>
                <p className="login-note">
                  Las credenciales iniciales se generan localmente durante la
                  configuración del entorno.
                </p>
              </section>
            </div>
          ) : tab === "audit" && actor.role === "APPROVER" ? (
            <section className="panel">
              <div className="panel-heading">
                <h2>Últimos eventos</h2>
                <span>Organización {actor.tenant} · máximo 50</span>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Evento</th>
                      <th>Actor</th>
                      <th>Referencia</th>
                      <th>Fecha</th>
                    </tr>
                  </thead>
                  <tbody>
                    {audit.map((event) => (
                      <tr key={event.id}>
                        <td>{event.action}</td>
                        <td>{event.actor}</td>
                        <td className="mono">{event.objectId.slice(0, 8)}</td>
                        <td>
                          {new Date(event.createdAt).toLocaleString("es-EC")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {audit.length === 0 && (
                  <div className="empty">
                    Aún no hay eventos en esta organización.
                  </div>
                )}
              </div>
            </section>
          ) : (
            <>
              <div className="metrics">
                <article>
                  <span>SOLICITUDES VISIBLES</span>
                  <strong>{rows.length.toString().padStart(2, "0")}</strong>
                  <small>Hasta 50 solicitudes recientes</small>
                  <Icon kind="list" />
                </article>
                <article>
                  <span>PENDIENTES</span>
                  <strong>{pending.length.toString().padStart(2, "0")}</strong>
                  <small>Esperando una decisión</small>
                  <Icon kind="activity" />
                </article>
                <article>
                  <span>IMPORTE VISIBLE</span>
                  <strong className="amount">
                    {currency(
                      rows.reduce((sum, row) => sum + row.amountCents, 0),
                    )}
                  </strong>
                  <small>USD · organización {actor.tenant}</small>
                  <Icon kind="grid" />
                </article>
              </div>
              <section className="panel requests">
                <div className="panel-heading">
                  <div>
                    <p className="eyebrow">GESTIÓN DE COMPRAS</p>
                    <h2>Solicitudes recientes</h2>
                  </div>
                  <div className="actions">
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() => run(() => refresh())}
                    >
                      Actualizar
                    </button>
                    {actor.role === "REQUESTER" && (
                      <button
                        className="primary"
                        onClick={() => setShowCreate(true)}
                      >
                        + Nueva solicitud
                      </button>
                    )}
                  </div>
                </div>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Solicitud</th>
                        <th>Proveedor</th>
                        <th>Importe</th>
                        <th>Estado</th>
                        <th>Acciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => (
                        <tr key={row.id}>
                          <td>
                            <strong>{row.title}</strong>
                            <small className="reference">
                              #{row.id.slice(0, 8)} ·{" "}
                              {new Date(row.createdAt).toLocaleDateString(
                                "es-EC",
                              )}
                            </small>
                          </td>
                          <td className="vendor">{row.vendor}</td>
                          <td className="money">{currency(row.amountCents)}</td>
                          <td>
                            <span
                              className={`status ${row.status.toLowerCase()}`}
                            >
                              {
                                (
                                  {
                                    PENDING: "Pendiente",
                                    APPROVED: "Aprobada",
                                    REJECTED: "Rechazada",
                                  } as Record<string, string>
                                )[row.status]
                              }
                            </span>
                          </td>
                          <td>
                            <div className="row-actions">
                              <button
                                disabled={busy}
                                onClick={() =>
                                  run(async () =>
                                    setRisk(
                                      await api(
                                        engine,
                                        `/vendors/${row.vendor}/risk`,
                                      ),
                                    ),
                                  )
                                }
                              >
                                Evaluar proveedor ↗
                              </button>
                              {actor.role === "APPROVER" &&
                                row.status === "PENDING" && (
                                  <>
                                    <button
                                      disabled={busy}
                                      onClick={() => decide(row, "APPROVED")}
                                    >
                                      Aprobar
                                    </button>
                                    <button
                                      disabled={busy}
                                      onClick={() => decide(row, "REJECTED")}
                                    >
                                      Rechazar
                                    </button>
                                  </>
                                )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {rows.length === 0 && (
                    <div className="empty">
                      <Icon kind="list" />
                      <h3>Tu operación empieza aquí</h3>
                      <p>
                        {actor.role === "REQUESTER"
                          ? "Crea una solicitud de compra para iniciar el flujo de aprobación."
                          : "Las solicitudes de tu organización aparecerán aquí."}
                      </p>
                    </div>
                  )}
                </div>
                <footer className="panel-footer">
                  <span>
                    Acceso:{" "}
                    {actor.role === "APPROVER"
                      ? "aprobación de la organización"
                      : "solicitudes propias"}
                  </span>
                  <span>
                    Auditoría habilitada <i />
                  </span>
                </footer>
              </section>
              <div className="bottom-grid">
                <section className="policy">
                  <span className="mini-label">POLÍTICA OPERATIVA</span>
                  <h3>Responsabilidades separadas.</h3>
                  <p>
                    El perfil de solicitud crea compras. El perfil de aprobación
                    revisa y decide dentro de su organización.
                  </p>
                  <span>
                    5 solicitudes / día · máximo $10.000 por solicitud
                  </span>
                </section>
                <section className="policy dark">
                  <Icon kind="shield" />
                  <h3>Seguridad que puedes revisar.</h3>
                  <p>
                    Explora los controles y su relación con los diez riesgos de
                    seguridad de APIs.
                  </p>
                  <button onClick={() => selectTab("security")}>
                    Ver controles implementados →
                  </button>
                </section>
              </div>
            </>
          )}
          <footer className="page-footer">
            <span>SENTINEL PROCUREMENT</span>
            <span>Diseñado para decisiones con trazabilidad.</span>
          </footer>
        </main>
      </div>
      {showCreate && (
        <div className="modal-backdrop">
          <section
            className="modal panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-title"
          >
            <div className="modal-top">
              <p className="eyebrow">NUEVA OPERACIÓN</p>
              <button
                aria-label="Cerrar formulario"
                disabled={busy}
                onClick={() => setShowCreate(false)}
              >
                ×
              </button>
            </div>
            <h2 id="create-title">Crear solicitud de compra</h2>
            <p>La organización y el propietario se asignan desde tu sesión.</p>
            <form onSubmit={create}>
              <label>
                Título
                <input
                  autoFocus
                  name="title"
                  required
                  minLength={3}
                  maxLength={120}
                  placeholder="Ej. Licencias de productividad"
                />
              </label>
              <div className="form-row">
                <label>
                  Importe en USD
                  <input
                    name="amount"
                    type="number"
                    required
                    min="0.01"
                    max="10000"
                    step="0.01"
                    placeholder="250.00"
                  />
                </label>
                <label>
                  Proveedor
                  <select name="vendor">
                    <option value="acme">Acme</option>
                    <option value="globex">Globex</option>
                  </select>
                </label>
              </div>
              {error && (
                <p className="form-error" role="alert">
                  {error}
                </p>
              )}
              <button disabled={busy} className="primary">
                {busy ? "Guardando…" : "Crear solicitud"}
                <span>→</span>
              </button>
            </form>
          </section>
        </div>
      )}
      {risk && (
        <div className="modal-backdrop">
          <section
            className="modal panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="risk-title"
          >
            <div className="modal-top">
              <p className="eyebrow">EVALUACIÓN DE PROVEEDOR</p>
              <button
                onClick={() => setRisk(null)}
                aria-label="Cerrar evaluación"
              >
                ×
              </button>
            </div>
            <h2 id="risk-title" className="vendor">
              {risk.vendor}
            </h2>
            <div className="risk-score">
              {risk.score}
              <span>/ 100</span>
            </div>
            <p>
              Clasificación de riesgo: <strong>{risk.rating}</strong>
            </p>
            <small>
              Evaluación del proveedor de referencia; no representa una
              certificación ni una decisión automática.
            </small>
          </section>
        </div>
      )}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
