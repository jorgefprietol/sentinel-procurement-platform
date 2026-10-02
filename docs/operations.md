# Operación

## Entorno reproducible

El comando bootstrap crea secretos aleatorios fuera de Git. Compose usa PostgreSQL 17 y crea un rol `sentinel_app` separado del administrador de inicialización. El SQL de creación de rol parametriza la contraseña. Los servicios inicializan identidades de referencia únicamente si `BOOTSTRAP_ENABLED=true`; no sobrescriben hashes existentes.

```sh
docker compose ps
docker compose logs --tail=80 dotnet java
docker compose down
```

El healthcheck de la interfaz espera que ambos servicios puedan consultar PostgreSQL. Los servicios permanecen sin exposición directa. El puerto de la UI solo es accesible desde el equipo local. Utiliza exactamente el host de `APP_ORIGIN`; `localhost` y `127.0.0.1` son orígenes diferentes.

## Despliegue fuera del equipo local

Esta configuración es un entorno de referencia ejecutable. Para una exposición pública se requiere terminación TLS, `APP_ORIGIN` HTTPS y `COOKIE_SECURE=true`. Deshabilita las identidades de referencia mediante `BOOTSTRAP_ENABLED=false` y aprovisiona cuentas con hashes individuales o adapta autenticación a un IdP con MFA. No expongas las bases ni los endpoints internos del proveedor de referencia. Sustituye el proveedor por una integración real con un destino fijo revisado y TLS.

Los secretos deben provenir del gestor de secretos del entorno; las credenciales de bootstrap no son una estrategia de gestión de usuarios en producción. Define backups, restauración probada, rotación de credenciales, retención de eventos y monitoreo antes de usar datos operativos reales. La auditoría permite únicamente SELECT/INSERT al usuario de aplicación. Para protección frente a administradores de base de datos se requiere un destino externo inmutable.

## Pipeline

Los pull requests ejecutan compilación, OpenAPI, dependencias, pruebas de integración y controles de imágenes. La rama main publica cuatro imágenes en GHCR con etiqueta de commit y latest después de completar esas verificaciones. CodeQL se ejecuta en su propio workflow; su estado debe configurarse como comprobación requerida antes de integrar cambios. El pipeline no despliega a un servidor público.

La publicación también exige que no existan hallazgos CodeQL HIGH/CRITICAL abiertos en la referencia analizada. El análisis usa un modo de compilación específico para cada lenguaje. Los escaneos de Trivy identifican dependencias a partir de los artefactos mediante `--offline-scan`, mientras la base de vulnerabilidades se actualiza normalmente; esto evita resolución de POM externos durante el escaneo.

Las redes reservadas para este proyecto son `10.250.130.0/24` (gateway), `10.250.131.0/24` (datos) y `10.250.132.0/24` (proveedor). Si existe una ruta o red corporativa incompatible, cambia esos valores antes de iniciar el entorno. Los rangos explícitos permiten coexistir con otros proyectos sin agotar el pool predeterminado de Docker.

Los reportes JSON de Trivy conservan vulnerabilidades corregibles y no corregibles. La política bloquea HIGH/CRITICAL corregibles; las demás se revisan en los artefactos. No se omiten hallazgos mediante una lista de excepciones no documentada.

El servicio Java aplica parches compatibles sobre las versiones administradas por Spring Boot 4.0.8: Jackson 2.21.7 y 3.1.7 mediante sus BOM, y Tomcat 11.0.26. Estas versiones corrigen los hallazgos de dependencias detectados por el pipeline. Revisa esos overrides al actualizar Spring Boot, conservando versiones corregidas. Referencias: [BOM de Spring Boot](https://repo.maven.apache.org/maven2/org/springframework/boot/spring-boot-dependencies/4.0.8/spring-boot-dependencies-4.0.8.pom), [BOM de Jackson](https://github.com/FasterXML/jackson-bom) y [avisos de seguridad de Tomcat](https://tomcat.apache.org/security-11.html).

## Datos y recuperación

Las bases viven en los volúmenes `dotnet-data` y `java-data`. `docker compose down` conserva los datos; `down -v` los elimina. Cambiar la contraseña de entorno no cambia las contraseñas dentro de volúmenes existentes; una rotación requiere una operación administrativa en PostgreSQL. Las migraciones de este proyecto inicializan bases nuevas; la evolución del esquema sobre bases existentes necesita una migración versionada adicional.
