# Arquitectura y decisiones

## Dos implementaciones del mismo servicio

Las versiones C# y Java son alternativas comparables del mismo dominio. Cada una mantiene sus datos y sesiones. La aplicación React comparte tipos, flujos y contrato, y enruta al servicio seleccionado mediante NGINX. Esto permite revisar decisiones de seguridad equivalentes sin introducir llamadas entre backends ni duplicación de una misma compra entre bases.

React + TypeScript proporciona una interfaz compacta para solicitudes, aprobaciones, auditoría y controles. NestJS añadiría un tercer backend sin una responsabilidad necesaria. La aplicación mantiene datos de sesión solo en memoria; la credencial permanece en una cookie que JavaScript no puede leer.

## Transacciones y permisos

Las entradas no aceptan organización, propietario, estado ni rol. El actor se obtiene mediante el hash de la cookie y una sesión no expirada. Todas las consultas comerciales filtran el tenant; los solicitantes también filtran su identidad. Los aprobadores ven compras de su organización y no pueden crear compras.

C# vincula la autenticación al grupo de endpoints privados y la validación de origen a cada mutación mediante filtros de endpoints. Java usa metadata de métodos de Spring MVC, con acceso privado por defecto y tres endpoints públicos explícitos. Las decisiones sobre ejecutar autenticación no comparan rutas ni métodos obtenidos del cliente. El framework selecciona el endpoint y sus controles se ejecutan antes del flujo comercial.

Crear una compra bloquea la fila del solicitante, consulta una idempotencia previa, verifica la cuota UTC, inserta compra y auditoría y confirma una única transacción. Una restricción única protege `(owner_id, idempotency_key)`. La decisión bloquea la compra, valida PENDING y escribe estado y evento en una transacción. No se usa estado en memoria para controlar estas invariantes.

## Autenticación y CSRF

Se usan sesiones opacas revocables para evitar tokens en localStorage y permitir invalidación inmediata. El KDF se ejecuta también para cuentas desconocidas. El login limita por cuenta y globalmente; las peticiones autenticadas se limitan por ID de usuario, compartiendo el presupuesto entre sesiones.

Las mutaciones requieren `Origin == APP_ORIGIN` y `X-Sentinel-Client: web`. La aplicación opera bajo un solo origen, no habilita CORS y usa SameSite Strict. La cabecera no es un secreto; evita solicitudes simples de otros orígenes. Los clientes automatizados pueden enviar estos valores, por lo que los permisos se validan siempre en el servidor.

## Integraciones y despliegue

No existe un endpoint que acepte URLs de usuario. Los destinos de red son constantes de despliegue, el catálogo es cerrado y las redirecciones están deshabilitadas. C# impone un plazo total de tres segundos; Java aplica hasta tres segundos para recepción de cabeceras y hasta tres para lectura limitada del cuerpo. El proveedor está en una red interna y no tiene puerto público.

Las capas de contenedores usan builds multietapa. Las imágenes de ejecución son mínimas y operan sin root; las aplicaciones usan filesystem de solo lectura, `/tmp` temporal, límites de memoria/PID y capabilities eliminadas. Los builds se identifican por commit en el registry y se acompañan de SBOM y procedencia.
