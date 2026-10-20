# NuGet Vulnerable Packages — Tracking Report

Generated: 2026-10-20T08:04:41Z
Workflow run: https://github.com/4Keyy/Planora/actions/runs/39390718019

Apply fixes by bumping the affected package versions in `Directory.Packages.props`.

```
  Determining projects to restore...
/home/runner/work/Planora/Planora/tests/Planora.UnitTests/Planora.UnitTests.csproj : warning NU1902: Package 'MessagePack' 2.5.302 has a known moderate severity vulnerability, https://github.com/advisories/GHSA-qhrr-8q5h-9q3h [/home/runner/work/Planora/Planora/Planora.sln]
/home/runner/work/Planora/Planora/Services/RealtimeApi/Planora.Realtime.Api/Planora.Realtime.Api.csproj : warning NU1902: Package 'MessagePack' 2.5.302 has a known moderate severity vulnerability, https://github.com/advisories/GHSA-qhrr-8q5h-9q3h [/home/runner/work/Planora/Planora/Planora.sln]
  All projects are up-to-date for restore.

The following sources were used:
   https://api.nuget.org/v3/index.json

The given project `Planora.ApiGateway` has no vulnerable packages given the current sources.
The given project `Planora.Auth.Api` has no vulnerable packages given the current sources.
The given project `Planora.Auth.Application` has no vulnerable packages given the current sources.
The given project `Planora.Auth.Domain` has no vulnerable packages given the current sources.
The given project `Planora.Auth.Infrastructure` has no vulnerable packages given the current sources.
The given project `Planora.BuildingBlocks.Domain` has no vulnerable packages given the current sources.
The given project `Planora.BuildingBlocks.Application` has no vulnerable packages given the current sources.
The given project `Planora.BuildingBlocks.Infrastructure` has no vulnerable packages given the current sources.
The given project `Planora.Messaging.Domain` has no vulnerable packages given the current sources.
The given project `Planora.Messaging.Application` has no vulnerable packages given the current sources.
The given project `Planora.Messaging.Infrastructure` has no vulnerable packages given the current sources.
The given project `Planora.Messaging.Api` has no vulnerable packages given the current sources.
The given project `Planora.Realtime.Domain` has no vulnerable packages given the current sources.
The given project `Planora.Realtime.Application` has no vulnerable packages given the current sources.
The given project `Planora.Realtime.Infrastructure` has no vulnerable packages given the current sources.
Project `Planora.Realtime.Api` has the following vulnerable packages
   [net10.0]: 
   Top-level Package      Requested   Resolved   Severity   Advisory URL                                     
   > MessagePack          2.5.302     2.5.302    Moderate   https://github.com/advisories/GHSA-qhrr-8q5h-9q3h

The given project `GrpcContracts` has no vulnerable packages given the current sources.
The given project `Planora.Todo.Application` has no vulnerable packages given the current sources.
The given project `Planora.Todo.Domain` has no vulnerable packages given the current sources.
The given project `Planora.Todo.Infrastructure` has no vulnerable packages given the current sources.
The given project `Planora.Todo.Api` has no vulnerable packages given the current sources.
The given project `Planora.Category.Application` has no vulnerable packages given the current sources.
The given project `Planora.Category.Domain` has no vulnerable packages given the current sources.
The given project `Planora.Category.Infrastructure` has no vulnerable packages given the current sources.
The given project `Planora.Category.Api` has no vulnerable packages given the current sources.
The given project `Planora.Collaboration.Application` has no vulnerable packages given the current sources.
The given project `Planora.Collaboration.Domain` has no vulnerable packages given the current sources.
The given project `Planora.Collaboration.Infrastructure` has no vulnerable packages given the current sources.
The given project `Planora.Collaboration.Api` has no vulnerable packages given the current sources.
Project `Planora.UnitTests` has the following vulnerable packages
   [net10.0]: 
   Transitive Package      Resolved   Severity   Advisory URL                                     
   > MessagePack           2.5.302    Moderate   https://github.com/advisories/GHSA-qhrr-8q5h-9q3h

The given project `Planora.ErrorHandlingTests` has no vulnerable packages given the current sources.
The given project `Planora.Migrator` has no vulnerable packages given the current sources.
```
