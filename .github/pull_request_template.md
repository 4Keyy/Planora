## Problem and resulting behavior

<!-- Describe the concrete trigger, the previous behavior and the resulting behavior. -->

## Type of change

- [ ] Bug fix
- [ ] New feature
- [ ] Refactor / code quality
- [ ] Documentation
- [ ] CI / infrastructure

## Related issue

<!-- Link an actual issue when one exists. Use Closes #N only when this change closes it. -->

## Verification

<!-- Record the commands, source revision, results and unexecuted checks.
Do not check an item when it was skipped or failed. Remove inapplicable items. -->

- [ ] Applicable backend/frontend build passes
- [ ] Backend suite passes (`dotnet test Planora.sln`)
- [ ] Frontend lint and types pass (`npm --prefix frontend run lint`, `npm --prefix frontend run type-check`)
- [ ] Frontend coverage passes (`npm --prefix frontend run test:coverage`, all configured thresholds >=85%)
- [ ] Affected behavior has meaningful regression coverage
- [ ] Applicable integration/e2e flows were exercised; limitations are recorded
- [ ] Changed documentation passes Markdown and local-link checks

## Documentation and change hygiene

- [ ] Topic references and actual API/DTO examples match the implementation
- [ ] Schema/key/constraint and migration documentation is updated when relevant
- [ ] CHANGELOG entry is included for a user-visible, breaking or performance change
- [ ] `.env.example` is updated when configuration keys change
- [ ] Diff contains no credentials, personal data or local assistant configuration
- [ ] Every selected path was checked against `.gitignore`; no forced staging

## Risks and rollout

<!-- Document actual compatibility/migration/deployment implications and remaining findings.
For a docs-only change, describe the limits of the verified claims. -->
