/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "domain-no-infra",
      severity: "error",
      from: { path: "^src/domain" },
      to: { path: "^src/infrastructure" },
    },
    {
      name: "domain-no-application",
      severity: "error",
      from: { path: "^src/domain" },
      to: { path: "^src/application" },
    },
    {
      name: "domain-no-nextjs",
      severity: "error",
      from: { path: "^src/domain" },
      to: { path: "^src/app" },
    },
    {
      name: "domain-no-frameworks",
      severity: "error",
      from: { path: "^src/domain" },
      to: { path: "node_modules/(next|@prisma|better-auth|pino)" },
    },
    {
      name: "no-circular",
      severity: "error",
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.json" },
    // `exclude` remove os módulos do grafo por completo (inclusive as arestas
    // que apontam para eles) — com "node_modules" ali, a regra
    // `domain-no-frameworks` nunca conseguia enxergar uma violação. O correto
    // é `doNotFollow`: mantém node_modules como nós do grafo (então as arestas
    // src/domain -> node_modules/... existem e são avaliadas pelas regras),
    // apenas não resolve as dependências *dentro* deles.
    doNotFollow: { path: "node_modules" },
    exclude: { path: "\\.test\\.ts$|\\.integration\\.test\\.ts$" },
  },
};
