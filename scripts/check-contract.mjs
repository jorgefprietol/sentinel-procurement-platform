import SwaggerParser from "@apidevtools/swagger-parser";
const specification = await SwaggerParser.validate(
  new URL("../docs/openapi.yaml", import.meta.url).pathname.replace(
    /^\/([A-Z]:)/,
    "$1",
  ),
);
console.log(
  `Valid OpenAPI ${specification.openapi}: ${Object.keys(specification.paths).length} paths.`,
);
