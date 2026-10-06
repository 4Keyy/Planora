# XML Cryptography Security Override — 2026-10-06

A fresh GitHub Actions restore rejected `System.Security.Cryptography.Xml`
10.0.8 with `NU1903`. Auth Infrastructure receives this package through
ASP.NET Core Data Protection; Auth API, Migrator and the unit-test project
inherit the affected dependency graph.

The central package version is pinned to **10.0.12**, with a direct reference
in Auth Infrastructure. Central package management alone does not replace a
transitive version, so the direct reference is intentional. The override keeps
the .NET 10 package line and leaves NuGet auditing and severity gates enabled.

The relevant Microsoft advisories identify **10.0.10** as the first patched
.NET 10 version:

- [GHSA-cvvh-rhrc-wg4q](https://github.com/advisories/GHSA-cvvh-rhrc-wg4q)
- [GHSA-g8r8-53c2-pm3f](https://github.com/advisories/GHSA-g8r8-53c2-pm3f)
- [GHSA-23rf-6693-g89p](https://github.com/advisories/GHSA-23rf-6693-g89p)
- [GHSA-8q5v-6pqq-x66h](https://github.com/advisories/GHSA-8q5v-6pqq-x66h)
- [GHSA-mmjf-rqrv-855v](https://github.com/advisories/GHSA-mmjf-rqrv-855v)

Before removing the direct reference and central pin, confirm that an upstream
Data Protection update resolves a patched XML package throughout the solution.
Validate with a forced restore, Release build, full backend tests and a fresh
transitive vulnerability scan. A scanner finding describes the package graph;
this correction does not assert that an exploit was reproduced in Planora.
