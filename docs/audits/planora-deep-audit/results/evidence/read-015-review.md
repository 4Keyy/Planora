# READ-015 - infrastructure services and specifications

Reviewed the three files at `b14cf29d` on 2026-11-20. The source hashes
match the baseline and the audited ranges are in the per-file index.

| File | Review |
| --- | --- |
| `BusinessEventLogger.cs` | The BuildingBlocks registration supplies analytics, Auth, Category and Todo callers. Message strings pass through `LogSanitizer`; the `Data` scope carries caller-supplied objects. The active Auth and Category logging configuration includes the scope in structured file logs. See BE-039 below. |
| `SystemInfoController.cs` | The shared controller returns process and host metadata to the Admin role. The Auth API build includes the BuildingBlocks infrastructure assembly as an MVC application part. The gateway has no explicit system-info route. This review did not exercise a live signed-in Admin route. |
| `SpecificationEvaluator.cs` | The base repository delegates specification filtering, EF includes, sorting, paging and query tracking options to this class. The active service repositories do not call the inherited protected specification methods directly. The application tests verify specification options; the SQL path was outside this review. |

## BE-039 business event payloads

The successful login event included email and IP address. The first-category
event included the category name. The synthetic handler tests reproduced
both payloads. Commit [8027df84](https://github.com/4Keyy/Planora/commit/8027df849008703c7c01027521e45e6e3b5618fd)
keeps the event IDs and removes those fields. Login history and refresh-token
records retain their IP tracking, checked by the login regression. No user
records or existing logs were read. Frontend analytics properties still have
an object and size contract. Their individual fields need separate review.

## Verification

- `dotnet build Planora.sln -c Release --no-restore -m:1 -nr:false` passed.
- The targeted test methods ran in process using the built test assembly
  because VSTest cannot open its local test-host connection in this session.
  The first BE-038 run had 25 passes and one expected regression failure.
  The BE-039 run had 39 passes and two expected regression failures before
  the handler edits. The final run had 41 passes and no failures. The
  selected Collaboration regressions also passed, 59 of 59.
- `python -m unittest discover -s deploy/cloudru -v` passed all four tests.
  They validate the merged Cloud.ru configuration with synthetic values.
- Live log verification, PostgreSQL integration and the Cloud.ru rollout
  remain open.
