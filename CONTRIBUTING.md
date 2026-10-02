# Contribuir

Propón cambios enfocados y documenta el comportamiento esperado. Mantén equivalencia entre las implementaciones C# y Java cuando modifiques el contrato. Ejecuta las pruebas pertinentes y describe evidencia y límites en el pull request.

Para nuevos endpoints: actualiza OpenAPI y el inventario, aplica autenticación/autorización, fija límites de entradas y respuestas y añade pruebas de la invariante de seguridad afectada. No registres cuerpos de autenticación, cookies ni tokens. Las pruebas de seguridad se ejecutan exclusivamente contra entornos propios.
