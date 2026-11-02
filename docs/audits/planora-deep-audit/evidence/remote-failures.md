# GitHub failures at baseline

Read via GitHub connector, 2026-11-02. Only redacted rule/path metadata and test diagnostics retained; no secret values or full logs.

## Gitleaks

Run [GitHub evidence](https://github.com/4Keyy/Planora/actions/runs/41416485392); job 125181481709. Scanner reports 66 matches. This is not proof of 66 live credentials; fixture/history classification remains T12.

```text
2026-11-02T08:54:54.1760646Z Commit: 21505ad2541d5be6135ed84fc33697146cf75b8e
2026-11-02T08:54:59.3934138Z gitleaks cmd: gitleaks detect --redact -v --exit-code=2 --report-format=sarif --report-path=results.sarif --log-level=debug
2026-11-02T08:54:59.3954263Z [command]/tmp/gitleaks-8.24.3/gitleaks detect --redact -v --exit-code=2 --report-format=sarif --report-path=results.sarif --log-level=debug
2026-11-02T08:55:00.1082209Z RuleID:      planora-postgres-connection-string-literal
2026-11-02T08:55:00.1084353Z File:        docs/testing.md
2026-11-02T08:55:00.1085279Z Commit:      b11e73f7762b4f15910c3c634c317f4a52fb9bb7
2026-11-02T08:55:00.1088211Z Fingerprint: b11e73f7762b4f15910c3c634c317f4a52fb9bb7:docs/testing.md:planora-postgres-connection-string-literal:521
2026-11-02T08:55:00.4442380Z RuleID:      planora-postgres-connection-string-literal
2026-11-02T08:55:00.4472679Z File:        .github/workflows/ci.yml
2026-11-02T08:55:00.4473594Z Commit:      99ad134a7808c9373844cabac52af3b8de272aa9
2026-11-02T08:55:00.4476048Z Fingerprint: 99ad134a7808c9373844cabac52af3b8de272aa9:.github/workflows/ci.yml:planora-postgres-connection-string-literal:50
2026-11-02T08:55:00.4481063Z RuleID:      planora-postgres-connection-string-literal
2026-11-02T08:55:00.4483194Z File:        tests/Planora.UnitTests/Services/AuthApi/Infrastructure/AuthDeletionOutboxTests.cs
2026-11-02T08:55:00.4484468Z Commit:      0fd486add085950450b96920466f666a6b127cfa
2026-11-02T08:55:00.4487209Z Fingerprint: 0fd486add085950450b96920466f666a6b127cfa:tests/Planora.UnitTests/Services/AuthApi/Infrastructure/AuthDeletionOutboxTests.cs:planora-postgres-connection-string-literal:34
2026-11-02T08:55:00.4612322Z RuleID:      planora-postgres-connection-string-literal
2026-11-02T08:55:00.4614847Z File:        tests/Planora.UnitTests/BuildingBlocks/Retention/Postgres/PostgresRetention.cs
2026-11-02T08:55:00.4616125Z Commit:      99ad134a7808c9373844cabac52af3b8de272aa9
2026-11-02T08:55:00.4618911Z Fingerprint: 99ad134a7808c9373844cabac52af3b8de272aa9:tests/Planora.UnitTests/BuildingBlocks/Retention/Postgres/PostgresRetention.cs:planora-postgres-connection-string-literal:18
2026-11-02T08:55:00.4862219Z RuleID:      planora-postgres-connection-string-literal
2026-11-02T08:55:00.4937134Z File:        .github/workflows/migrations.yml
2026-11-02T08:55:00.5002221Z Commit:      7a11a875cbddedb19a72072a143b6cf92c9e24e2
2026-11-02T08:55:00.5092798Z Fingerprint: 7a11a875cbddedb19a72072a143b6cf92c9e24e2:.github/workflows/migrations.yml:planora-postgres-connection-string-literal:92
2026-11-02T08:55:01.0142276Z RuleID:      planora-postgres-connection-string-literal
2026-11-02T08:55:01.0221124Z File:        .github/workflows/migrations.yml
2026-11-02T08:55:01.0222473Z Commit:      7115c1c6d83c7ff4ee3833206bd7ddcabceb8c5e
2026-11-02T08:55:01.0337779Z Fingerprint: 7115c1c6d83c7ff4ee3833206bd7ddcabceb8c5e:.github/workflows/migrations.yml:planora-postgres-connection-string-literal:81
2026-11-02T08:55:01.3242325Z RuleID:      planora-postgres-connection-string-literal
2026-11-02T08:55:01.3333601Z File:        Start-Planora-Local.ps1
2026-11-02T08:55:01.3334482Z Commit:      c9186acda024a874899a0959f3c6317191a67a8e
2026-11-02T08:55:01.3351852Z Fingerprint: c9186acda024a874899a0959f3c6317191a67a8e:Start-Planora-Local.ps1:planora-postgres-connection-string-literal:244
2026-11-02T08:55:01.4244935Z RuleID:      planora-postgres-connection-string-literal
2026-11-02T08:55:01.4246762Z File:        Services/CollaborationApi/Planora.Collaboration.Api/appsettings.Docker.json
2026-11-02T08:55:01.4247962Z Commit:      da090fe84f6ab35304a4c9daede3eb84ff769a75
2026-11-02T08:55:01.4250830Z Fingerprint: da090fe84f6ab35304a4c9daede3eb84ff769a75:Services/CollaborationApi/Planora.Collaboration.Api/appsettings.Docker.json:planora-postgres-connection-string-literal:11
2026-11-02T08:55:01.4302090Z RuleID:      planora-postgres-connection-string-literal
2026-11-02T08:55:01.4372468Z File:        Services/CollaborationApi/Planora.Collaboration.Api/appsettings.json
2026-11-02T08:55:01.4428104Z Commit:      da090fe84f6ab35304a4c9daede3eb84ff769a75
2026-11-02T08:55:01.4542784Z Fingerprint: da090fe84f6ab35304a4c9daede3eb84ff769a75:Services/CollaborationApi/Planora.Collaboration.Api/appsettings.json:planora-postgres-connection-string-literal:11
2026-11-02T08:55:01.4595684Z RuleID:      planora-postgres-connection-string-literal
2026-11-02T08:55:01.4612079Z File:        Services/CollaborationApi/Planora.Collaboration.Api/Properties/launchSettings.json
2026-11-02T08:55:01.4613666Z Commit:      da090fe84f6ab35304a4c9daede3eb84ff769a75
2026-11-02T08:55:01.4617218Z Fingerprint: da090fe84f6ab35304a4c9daede3eb84ff769a75:Services/CollaborationApi/Planora.Collaboration.Api/Properties/launchSettings.json:planora-postgres-connection-string-literal:12
2026-11-02T08:55:01.4625238Z RuleID:      planora-postgres-connection-string-literal
2026-11-02T08:55:01.4653421Z File:        Services/CollaborationApi/Planora.Collaboration.Infrastructure/DesignTime/CollaborationDbContextFactory.cs
2026-11-02T08:55:01.4655186Z Commit:      da090fe84f6ab35304a4c9daede3eb84ff769a75
2026-11-02T08:55:01.4735312Z Fingerprint: da090fe84f6ab35304a4c9daede3eb84ff769a75:Services/CollaborationApi/Planora.Collaboration.Infrastructure/DesignTime/CollaborationDbContextFactory.cs:planora-postgres-connection-string-literal:18
2026-11-02T08:55:01.5341900Z RuleID:      planora-postgres-connection-string-literal
2026-11-02T08:55:01.5402333Z File:        tests/Planora.UnitTests/Services/AuthApi/Infrastructure/AuthJwtStampWiringTests.cs
2026-11-02T08:55:01.5432566Z Commit:      1c0b9b16acfaf60c56771e4c7da64ce433b37d55
2026-11-02T08:55:01.5523597Z Fingerprint: 1c0b9b16acfaf60c56771e4c7da64ce433b37d55:tests/Planora.UnitTests/Services/AuthApi/Infrastructure/AuthJwtStampWiringTests.cs:planora-postgres-connection-string-literal:21
2026-11-02T08:55:01.5941975Z RuleID:      planora-rabbit-password
2026-11-02T08:55:01.6001990Z File:        deploy/fly/README.md
2026-11-02T08:55:01.6059720Z Commit:      a25999f7b90fc56d73354b31a41f785296d1fa5b
2026-11-02T08:55:01.6142529Z Fingerprint: a25999f7b90fc56d73354b31a41f785296d1fa5b:deploy/fly/README.md:planora-rabbit-password:53
2026-11-02T08:55:01.6281925Z RuleID:      planora-rabbit-password
2026-11-02T08:55:01.6342446Z File:        .github/workflows/perf-smoke.yml
2026-11-02T08:55:01.6343622Z Commit:      804c7a3d9db72785f016432d2045f51d33cb4a7c
2026-11-02T08:55:01.6373928Z Fingerprint: 804c7a3d9db72785f016432d2045f51d33cb4a7c:.github/workflows/perf-smoke.yml:planora-rabbit-password:43
2026-11-02T08:55:01.6377986Z RuleID:      planora-jwt-secret
2026-11-02T08:55:01.6379224Z File:        .github/workflows/openapi.yml
2026-11-02T08:55:01.6380404Z Commit:      2488c9b56e5164f4a8dcc8c419e0540dd45fab34
2026-11-02T08:55:01.6382784Z Fingerprint: 2488c9b56e5164f4a8dcc8c419e0540dd45fab34:.github/workflows/openapi.yml:planora-jwt-secret:136
2026-11-02T08:55:01.6386890Z RuleID:      planora-grpc-service-key
2026-11-02T08:55:01.6388150Z File:        .github/workflows/openapi.yml
2026-11-02T08:55:01.6389035Z Commit:      2488c9b56e5164f4a8dcc8c419e0540dd45fab34
2026-11-02T08:55:01.6391182Z Fingerprint: 2488c9b56e5164f4a8dcc8c419e0540dd45fab34:.github/workflows/openapi.yml:planora-grpc-service-key:139
2026-11-02T08:55:01.6396310Z RuleID:      planora-postgres-connection-string-literal
2026-11-02T08:55:01.6397724Z File:        .github/workflows/openapi.yml
2026-11-02T08:55:01.6398548Z Commit:      2488c9b56e5164f4a8dcc8c419e0540dd45fab34
2026-11-02T08:55:01.6400841Z Fingerprint: 2488c9b56e5164f4a8dcc8c419e0540dd45fab34:.github/workflows/openapi.yml:planora-postgres-connection-string-literal:150
2026-11-02T08:55:01.6419947Z RuleID:      planora-grpc-service-key
2026-11-02T08:55:01.6421718Z File:        .github/workflows/migrations.yml
2026-11-02T08:55:01.6422591Z Commit:      f47c283e5459d196c487f42a8d32ebf70f6adb3c
2026-11-02T08:55:01.6424768Z Fingerprint: f47c283e5459d196c487f42a8d32ebf70f6adb3c:.github/workflows/migrations.yml:planora-grpc-service-key:73
2026-11-02T08:55:01.6429544Z RuleID:      planora-postgres-connection-string-literal
2026-11-02T08:55:01.6430982Z File:        .github/workflows/migrations.yml
2026-11-02T08:55:01.6432042Z Commit:      f47c283e5459d196c487f42a8d32ebf70f6adb3c
2026-11-02T08:55:01.6434553Z Fingerprint: f47c283e5459d196c487f42a8d32ebf70f6adb3c:.github/workflows/migrations.yml:planora-postgres-connection-string-literal:68
2026-11-02T08:55:01.6439539Z RuleID:      planora-postgres-connection-string-literal
2026-11-02T08:55:01.6440952Z File:        .github/workflows/migrations.yml
2026-11-02T08:55:01.6442034Z Commit:      f47c283e5459d196c487f42a8d32ebf70f6adb3c
2026-11-02T08:55:01.6444344Z Fingerprint: f47c283e5459d196c487f42a8d32ebf70f6adb3c:.github/workflows/migrations.yml:planora-postgres-connection-string-literal:69
2026-11-02T08:55:01.6449062Z RuleID:      planora-postgres-connection-string-literal
2026-11-02T08:55:01.6450469Z File:        .github/workflows/migrations.yml
2026-11-02T08:55:01.6451328Z Commit:      f47c283e5459d196c487f42a8d32ebf70f6adb3c
2026-11-02T08:55:01.6453822Z Fingerprint: f47c283e5459d196c487f42a8d32ebf70f6adb3c:.github/workflows/migrations.yml:planora-postgres-connection-string-literal:70
2026-11-02T08:55:01.6458816Z RuleID:      planora-postgres-connection-string-literal
2026-11-02T08:55:01.6460237Z File:        .github/workflows/migrations.yml
2026-11-02T08:55:01.6461094Z Commit:      f47c283e5459d196c487f42a8d32ebf70f6adb3c
2026-11-02T08:55:01.6463911Z Fingerprint: f47c283e5459d196c487f42a8d32ebf70f6adb3c:.github/workflows/migrations.yml:planora-postgres-connection-string-literal:71
2026-11-02T08:55:01.6467773Z RuleID:      planora-jwt-secret
2026-11-02T08:55:01.6469213Z File:        .github/workflows/migrations.yml
2026-11-02T08:55:01.6470084Z Commit:      f47c283e5459d196c487f42a8d32ebf70f6adb3c
2026-11-02T08:55:01.6472439Z Fingerprint: f47c283e5459d196c487f42a8d32ebf70f6adb3c:.github/workflows/migrations.yml:planora-jwt-secret:72
2026-11-02T08:55:01.6802042Z RuleID:      planora-generic-secret-assignment
2026-11-02T08:55:01.6862456Z File:        tests/Planora.UnitTests/BuildingBlocks/Grpc/ServiceKeyInterceptorTests.cs
2026-11-02T08:55:01.6892612Z Commit:      d4d05a034a14f3b9655b483651f26e1ba1324a47
2026-11-02T08:55:01.6928054Z Fingerprint: d4d05a034a14f3b9655b483651f26e1ba1324a47:tests/Planora.UnitTests/BuildingBlocks/Grpc/ServiceKeyInterceptorTests.cs:planora-generic-secret-assignment:10
2026-11-02T08:55:01.8103376Z RuleID:      planora-rabbit-password
2026-11-02T08:55:01.8162849Z File:        .github/workflows/e2e.yml
2026-11-02T08:55:01.8169369Z Commit:      8925bf59c4bb494ff51fdbf253af90a67994d362
2026-11-02T08:55:01.8172963Z Fingerprint: 8925bf59c4bb494ff51fdbf253af90a67994d362:.github/workflows/e2e.yml:planora-rabbit-password:37
2026-11-02T08:55:01.8392145Z RuleID:      planora-postgres-connection-string-literal
2026-11-02T08:55:01.8498060Z File:        Planora.ApiGateway/appsettings.json
2026-11-02T08:55:01.8525559Z Commit:      8925bf59c4bb494ff51fdbf253af90a67994d362
2026-11-02T08:55:01.8647058Z Fingerprint: 8925bf59c4bb494ff51fdbf253af90a67994d362:Planora.ApiGateway/appsettings.json:planora-postgres-connection-string-literal:17
2026-11-02T08:55:01.8658479Z RuleID:      planora-postgres-connection-string-literal
2026-11-02T08:55:01.8660562Z File:        Services/AuthApi/Planora.Auth.Api/Properties/launchSettings.json
2026-11-02T08:55:01.8691928Z Commit:      8925bf59c4bb494ff51fdbf253af90a67994d362
2026-11-02T08:55:01.8694618Z Fingerprint: 8925bf59c4bb494ff51fdbf253af90a67994d362:Services/AuthApi/Planora.Auth.Api/Properties/launchSettings.json:planora-postgres-connection-string-literal:12
2026-11-02T08:55:01.8700587Z RuleID:      planora-postgres-connection-string-literal
2026-11-02T08:55:01.8702566Z File:        Services/AuthApi/Planora.Auth.Api/Properties/launchSettings.json
2026-11-02T08:55:01.8703686Z Commit:      8925bf59c4bb494ff51fdbf253af90a67994d362
2026-11-02T08:55:01.8706342Z Fingerprint: 8925bf59c4bb494ff51fdbf253af90a67994d362:Services/AuthApi/Planora.Auth.Api/Properties/launchSettings.json:planora-postgres-connection-string-literal:31
2026-11-02T08:55:01.8718024Z RuleID:      planora-postgres-connection-string-literal
2026-11-02T08:55:01.8719551Z File:        Services/AuthApi/Planora.Auth.Api/appsettings.json
2026-11-02T08:55:01.8720521Z Commit:      8925bf59c4bb494ff51fdbf253af90a67994d362
2026-11-02T08:55:01.8723126Z Fingerprint: 8925bf59c4bb494ff51fdbf253af90a67994d362:Services/AuthApi/Planora.Auth.Api/appsettings.json:planora-postgres-connection-string-literal:12
2026-11-02T08:55:01.8736415Z RuleID:      planora-postgres-connection-string-literal
2026-11-02T08:55:01.8738279Z File:        Planora.ApiGateway/Properties/launchSettings.json
2026-11-02T08:55:01.8739303Z Commit:      8925bf59c4bb494ff51fdbf253af90a67994d362
2026-11-02T08:55:01.8742007Z Fingerprint: 8925bf59c4bb494ff51fdbf253af90a67994d362:Planora.ApiGateway/Properties/launchSettings.json:planora-postgres-connection-string-literal:12
2026-11-02T08:55:01.8747459Z RuleID:      planora-postgres-connection-string-literal
2026-11-02T08:55:01.8749065Z File:        Planora.ApiGateway/Properties/launchSettings.json
2026-11-02T08:55:01.8750113Z Commit:      8925bf59c4bb494ff51fdbf253af90a67994d362
2026-11-02T08:55:01.8753034Z Fingerprint: 8925bf59c4bb494ff51fdbf253af90a67994d362:Planora.ApiGateway/Properties/launchSettings.json:planora-postgres-connection-string-literal:30
2026-11-02T08:55:01.8758609Z RuleID:      planora-postgres-connection-string-literal
2026-11-02T08:55:01.8760251Z File:        Services/AuthApi/Planora.Auth.Api/appsettings.Docker.json
2026-11-02T08:55:01.8763256Z Commit:      8925bf59c4bb494ff51fdbf253af90a67994d362
2026-11-02T08:55:01.8765924Z Fingerprint: 8925bf59c4bb494ff51fdbf253af90a67994d362:Services/AuthApi/Planora.Auth.Api/appsettings.Docker.json:planora-postgres-connection-string-literal:12
2026-11-02T08:55:01.8770672Z RuleID:      planora-rabbit-password
2026-11-02T08:55:01.8772274Z File:        README.md
2026-11-02T08:55:01.8773065Z Commit:      8925bf59c4bb494ff51fdbf253af90a67994d362
2026-11-02T08:55:01.8775033Z Fingerprint: 8925bf59c4bb494ff51fdbf253af90a67994d362:README.md:planora-rabbit-password:68
2026-11-02T08:55:01.9095309Z RuleID:      planora-postgres-connection-string-literal
2026-11-02T08:55:01.9133795Z File:        Services/CategoryApi/Planora.Category.Api/appsettings.Docker.json
2026-11-02T08:55:01.9135555Z Commit:      8925bf59c4bb494ff51fdbf253af90a67994d362
2026-11-02T08:55:01.9138455Z Fingerprint: 8925bf59c4bb494ff51fdbf253af90a67994d362:Services/CategoryApi/Planora.Category.Api/appsettings.Docker.json:planora-postgres-connection-string-literal:11
2026-11-02T08:55:01.9145035Z RuleID:      planora-postgres-connection-string-literal
2026-11-02T08:55:01.9146628Z File:        Services/CategoryApi/Planora.Category.Api/appsettings.json
2026-11-02T08:55:01.9147681Z Commit:      8925bf59c4bb494ff51fdbf253af90a67994d362
2026-11-02T08:55:01.9150305Z Fingerprint: 8925bf59c4bb494ff51fdbf253af90a67994d362:Services/CategoryApi/Planora.Category.Api/appsettings.json:planora-postgres-connection-string-literal:14
2026-11-02T08:55:01.9186222Z RuleID:      planora-postgres-connection-string-literal
2026-11-02T08:55:01.9187920Z File:        Services/CategoryApi/Planora.Category.Api/Properties/launchSettings.json
2026-11-02T08:55:01.9189104Z Commit:      8925bf59c4bb494ff51fdbf253af90a67994d362
2026-11-02T08:55:01.9191986Z Fingerprint: 8925bf59c4bb494ff51fdbf253af90a67994d362:Services/CategoryApi/Planora.Category.Api/Properties/launchSettings.json:planora-postgres-connection-string-literal:12
2026-11-02T08:55:01.9223033Z RuleID:      planora-postgres-connection-string-literal
2026-11-02T08:55:01.9224697Z File:        Services/CategoryApi/Planora.Category.Api/Properties/launchSettings.json
2026-11-02T08:55:01.9225899Z Commit:      8925bf59c4bb494ff51fdbf253af90a67994d362
2026-11-02T08:55:01.9228557Z Fingerprint: 8925bf59c4bb494ff51fdbf253af90a67994d362:Services/CategoryApi/Planora.Category.Api/Properties/launchSettings.json:planora-postgres-connection-string-literal:30
2026-11-02T08:55:01.9234691Z RuleID:      planora-postgres-connection-string-literal
2026-11-02T08:55:01.9236436Z File:        Services/AuthApi/Planora.Auth.Infrastructure/DesignTime/AuthDbContextFactory.cs
2026-11-02T08:55:01.9237652Z Commit:      8925bf59c4bb494ff51fdbf253af90a67994d362
2026-11-02T08:55:01.9240382Z Fingerprint: 8925bf59c4bb494ff51fdbf253af90a67994d362:Services/AuthApi/Planora.Auth.Infrastructure/DesignTime/AuthDbContextFactory.cs:planora-postgres-connection-string-literal:18
2026-11-02T08:55:01.9246798Z RuleID:      planora-postgres-connection-string-literal
2026-11-02T08:55:01.9248900Z File:        Services/CategoryApi/Planora.Category.Infrastructure/DesignTime/CategoryDbContextFactory.cs
2026-11-02T08:55:01.9250194Z Commit:      8925bf59c4bb494ff51fdbf253af90a67994d362
2026-11-02T08:55:01.9253252Z Fingerprint: 8925bf59c4bb494ff51fdbf253af90a67994d362:Services/CategoryApi/Planora.Category.Infrastructure/DesignTime/CategoryDbContextFactory.cs:planora-postgres-connection-string-literal:18
2026-11-02T08:55:01.9259598Z RuleID:      planora-postgres-connection-string-literal
2026-11-02T08:55:01.9261375Z File:        Services/MessagingApi/Planora.Messaging.Api/Properties/launchSettings.json
2026-11-02T08:55:01.9262969Z Commit:      8925bf59c4bb494ff51fdbf253af90a67994d362
2026-11-02T08:55:01.9265675Z Fingerprint: 8925bf59c4bb494ff51fdbf253af90a67994d362:Services/MessagingApi/Planora.Messaging.Api/Properties/launchSettings.json:planora-postgres-connection-string-literal:12
2026-11-02T08:55:01.9322434Z RuleID:      planora-postgres-connection-string-literal
2026-11-02T08:55:01.9324454Z File:        Services/MessagingApi/Planora.Messaging.Api/Properties/launchSettings.json
2026-11-02T08:55:01.9325716Z Commit:      8925bf59c4bb494ff51fdbf253af90a67994d362
2026-11-02T08:55:01.9328527Z Fingerprint: 8925bf59c4bb494ff51fdbf253af90a67994d362:Services/MessagingApi/Planora.Messaging.Api/Properties/launchSettings.json:planora-postgres-connection-string-literal:30
2026-11-02T08:55:01.9335216Z RuleID:      planora-postgres-connection-string-literal
2026-11-02T08:55:01.9337193Z File:        Services/MessagingApi/Planora.Messaging.Infrastructure/DesignTime/MessagingDbContextFactory.cs
2026-11-02T08:55:01.9339034Z Commit:      8925bf59c4bb494ff51fdbf253af90a67994d362
2026-11-02T08:55:01.9342310Z Fingerprint: 8925bf59c4bb494ff51fdbf253af90a67994d362:Services/MessagingApi/Planora.Messaging.Infrastructure/DesignTime/MessagingDbContextFactory.cs:planora-postgres-connection-string-literal:15
2026-11-02T08:55:01.9349504Z RuleID:      planora-postgres-connection-string-literal
2026-11-02T08:55:01.9351266Z File:        Services/MessagingApi/Planora.Messaging.Api/appsettings.json
2026-11-02T08:55:01.9353152Z Commit:      8925bf59c4bb494ff51fdbf253af90a67994d362
2026-11-02T08:55:01.9357359Z Fingerprint: 8925bf59c4bb494ff51fdbf253af90a67994d362:Services/MessagingApi/Planora.Messaging.Api/appsettings.json:planora-postgres-connection-string-literal:12
2026-11-02T08:55:01.9413821Z RuleID:      planora-postgres-connection-string-literal
2026-11-02T08:55:01.9415501Z File:        Services/MessagingApi/Planora.Messaging.Api/appsettings.Docker.json
2026-11-02T08:55:01.9416656Z Commit:      8925bf59c4bb494ff51fdbf253af90a67994d362
2026-11-02T08:55:01.9419325Z Fingerprint: 8925bf59c4bb494ff51fdbf253af90a67994d362:Services/MessagingApi/Planora.Messaging.Api/appsettings.Docker.json:planora-postgres-connection-string-literal:11
2026-11-02T08:55:01.9425598Z RuleID:      planora-postgres-connection-string-literal
2026-11-02T08:55:01.9427179Z File:        Services/TodoApi/Planora.Todo.Api/appsettings.json
2026-11-02T08:55:01.9428183Z Commit:      8925bf59c4bb494ff51fdbf253af90a67994d362
2026-11-02T08:55:01.9430985Z Fingerprint: 8925bf59c4bb494ff51fdbf253af90a67994d362:Services/TodoApi/Planora.Todo.Api/appsettings.json:planora-postgres-connection-string-literal:11
2026-11-02T08:55:01.9466734Z RuleID:      planora-postgres-connection-string-literal
2026-11-02T08:55:01.9468440Z File:        Services/CategoryApi/Planora.Category.Infrastructure/DependencyInjection.cs
2026-11-02T08:55:01.9469600Z Commit:      8925bf59c4bb494ff51fdbf253af90a67994d362
2026-11-02T08:55:01.9472520Z Fingerprint: 8925bf59c4bb494ff51fdbf253af90a67994d362:Services/CategoryApi/Planora.Category.Infrastructure/DependencyInjection.cs:planora-postgres-connection-string-literal:18
2026-11-02T08:55:01.9478629Z RuleID:      planora-postgres-connection-string-literal
2026-11-02T08:55:01.9480263Z File:        Services/TodoApi/Planora.Todo.Api/appsettings.Docker.json
2026-11-02T08:55:01.9481314Z Commit:      8925bf59c4bb494ff51fdbf253af90a67994d362
2026-11-02T08:55:01.9484155Z Fingerprint: 8925bf59c4bb494ff51fdbf253af90a67994d362:Services/TodoApi/Planora.Todo.Api/appsettings.Docker.json:planora-postgres-connection-string-literal:11
2026-11-02T08:55:01.9489690Z RuleID:      planora-postgres-connection-string-literal
2026-11-02T08:55:01.9513421Z File:        Services/TodoApi/Planora.Todo.Api/Properties/launchSettings.json
2026-11-02T08:55:01.9514512Z Commit:      8925bf59c4bb494ff51fdbf253af90a67994d362
2026-11-02T08:55:01.9517061Z Fingerprint: 8925bf59c4bb494ff51fdbf253af90a67994d362:Services/TodoApi/Planora.Todo.Api/Properties/launchSettings.json:planora-postgres-connection-string-literal:12
2026-11-02T08:55:01.9523206Z RuleID:      planora-postgres-connection-string-literal
2026-11-02T08:55:01.9524814Z File:        Services/TodoApi/Planora.Todo.Api/Properties/launchSettings.json
2026-11-02T08:55:01.9525899Z Commit:      8925bf59c4bb494ff51fdbf253af90a67994d362
2026-11-02T08:55:01.9528549Z Fingerprint: 8925bf59c4bb494ff51fdbf253af90a67994d362:Services/TodoApi/Planora.Todo.Api/Properties/launchSettings.json:planora-postgres-connection-string-literal:30
2026-11-02T08:55:01.9534023Z RuleID:      planora-postgres-connection-string-literal
2026-11-02T08:55:01.9535917Z File:        Services/TodoApi/Planora.Todo.Infrastructure/DesignTime/TodoDbContextFactory.cs
2026-11-02T08:55:01.9537081Z Commit:      8925bf59c4bb494ff51fdbf253af90a67994d362
2026-11-02T08:55:01.9539735Z Fingerprint: 8925bf59c4bb494ff51fdbf253af90a67994d362:Services/TodoApi/Planora.Todo.Infrastructure/DesignTime/TodoDbContextFactory.cs:planora-postgres-connection-string-literal:16
2026-11-02T08:55:01.9575042Z RuleID:      planora-rabbit-password
2026-11-02T08:55:01.9576349Z File:        docs/getting-started.md
2026-11-02T08:55:01.9577183Z Commit:      8925bf59c4bb494ff51fdbf253af90a67994d362
2026-11-02T08:55:01.9579332Z Fingerprint: 8925bf59c4bb494ff51fdbf253af90a67994d362:docs/getting-started.md:planora-rabbit-password:34
2026-11-02T08:55:01.9935031Z RuleID:      generic-api-key
2026-11-02T08:55:01.9936079Z File:        frontend/src/test/lib/jwt.test.ts
2026-11-02T08:55:01.9937195Z Commit:      8925bf59c4bb494ff51fdbf253af90a67994d362
2026-11-02T08:55:01.9968175Z Fingerprint: 8925bf59c4bb494ff51fdbf253af90a67994d362:frontend/src/test/lib/jwt.test.ts:generic-api-key:7
2026-11-02T08:55:01.9974274Z RuleID:      planora-generic-secret-assignment
2026-11-02T08:55:01.9976177Z File:        frontend/src/test/lib/jwt.test.ts
2026-11-02T08:55:01.9977386Z Commit:      8925bf59c4bb494ff51fdbf253af90a67994d362
2026-11-02T08:55:01.9980235Z Fingerprint: 8925bf59c4bb494ff51fdbf253af90a67994d362:frontend/src/test/lib/jwt.test.ts:planora-generic-secret-assignment:7
2026-11-02T08:55:02.0841924Z RuleID:      planora-postgres-connection-string-literal
2026-11-02T08:55:02.0843720Z File:        tests/Planora.UnitTests/Services/Infrastructure/DesignTimeDbContextFactoryTests.cs
2026-11-02T08:55:02.0844492Z Commit:      8925bf59c4bb494ff51fdbf253af90a67994d362
2026-11-02T08:55:02.0847228Z Fingerprint: 8925bf59c4bb494ff51fdbf253af90a67994d362:tests/Planora.UnitTests/Services/Infrastructure/DesignTimeDbContextFactoryTests.cs:planora-postgres-connection-string-literal:91
2026-11-02T08:55:02.0955676Z RuleID:      generic-api-key
2026-11-02T08:55:02.0956509Z File:        tests/Planora.UnitTests/Services/AuthApi/Infrastructure/Authentication/TokenServiceTests.cs
2026-11-02T08:55:02.0957338Z Commit:      8925bf59c4bb494ff51fdbf253af90a67994d362
2026-11-02T08:55:02.0960201Z Fingerprint: 8925bf59c4bb494ff51fdbf253af90a67994d362:tests/Planora.UnitTests/Services/AuthApi/Infrastructure/Authentication/TokenServiceTests.cs:generic-api-key:93
2026-11-02T08:55:02.0965394Z RuleID:      planora-generic-secret-assignment
2026-11-02T08:55:02.0967416Z File:        tests/Planora.UnitTests/Services/AuthApi/Infrastructure/Authentication/TokenServiceTests.cs
2026-11-02T08:55:02.0968666Z Commit:      8925bf59c4bb494ff51fdbf253af90a67994d362
2026-11-02T08:55:02.0971359Z Fingerprint: 8925bf59c4bb494ff51fdbf253af90a67994d362:tests/Planora.UnitTests/Services/AuthApi/Infrastructure/Authentication/TokenServiceTests.cs:planora-generic-secret-assignment:93
2026-11-02T08:55:02.1025808Z RuleID:      planora-redis-password-in-conn
2026-11-02T08:55:02.1030822Z File:        tests/Planora.UnitTests/Services/Infrastructure/DependencyInjectionContractTests.cs
2026-11-02T08:55:02.1032764Z Commit:      8925bf59c4bb494ff51fdbf253af90a67994d362
2026-11-02T08:55:02.1034932Z Fingerprint: 8925bf59c4bb494ff51fdbf253af90a67994d362:tests/Planora.UnitTests/Services/Infrastructure/DependencyInjectionContractTests.cs:planora-redis-password-in-conn:85
2026-11-02T08:55:02.1038654Z RuleID:      planora-redis-password-in-conn
2026-11-02T08:55:02.1039989Z File:        tests/Planora.UnitTests/Services/Infrastructure/DependencyInjectionContractTests.cs
2026-11-02T08:55:02.1040919Z Commit:      8925bf59c4bb494ff51fdbf253af90a67994d362
2026-11-02T08:55:02.1043605Z Fingerprint: 8925bf59c4bb494ff51fdbf253af90a67994d362:tests/Planora.UnitTests/Services/Infrastructure/DependencyInjectionContractTests.cs:planora-redis-password-in-conn:129
2026-11-02T08:55:02.1046723Z RuleID:      planora-redis-password-in-conn
2026-11-02T08:55:02.1047692Z File:        tests/Planora.UnitTests/Services/Infrastructure/DependencyInjectionContractTests.cs
2026-11-02T08:55:02.1048394Z Commit:      8925bf59c4bb494ff51fdbf253af90a67994d362
2026-11-02T08:55:02.1050119Z Fingerprint: 8925bf59c4bb494ff51fdbf253af90a67994d362:tests/Planora.UnitTests/Services/Infrastructure/DependencyInjectionContractTests.cs:planora-redis-password-in-conn:162
2026-11-02T08:55:02.1053796Z RuleID:      planora-postgres-connection-string-literal
2026-11-02T08:55:02.1054829Z File:        tests/Planora.UnitTests/Services/Infrastructure/DependencyInjectionContractTests.cs
2026-11-02T08:55:02.1055530Z Commit:      8925bf59c4bb494ff51fdbf253af90a67994d362
2026-11-02T08:55:02.1057286Z Fingerprint: 8925bf59c4bb494ff51fdbf253af90a67994d362:tests/Planora.UnitTests/Services/Infrastructure/DependencyInjectionContractTests.cs:planora-postgres-connection-string-literal:84
2026-11-02T08:55:02.1060572Z RuleID:      planora-postgres-connection-string-literal
2026-11-02T08:55:02.1061849Z File:        tests/Planora.UnitTests/Services/Infrastructure/DependencyInjectionContractTests.cs
2026-11-02T08:55:02.1062567Z Commit:      8925bf59c4bb494ff51fdbf253af90a67994d362
2026-11-02T08:55:02.1064122Z Fingerprint: 8925bf59c4bb494ff51fdbf253af90a67994d362:tests/Planora.UnitTests/Services/Infrastructure/DependencyInjectionContractTests.cs:planora-postgres-connection-string-literal:183
2026-11-02T08:55:02.1067597Z RuleID:      planora-postgres-connection-string-literal
2026-11-02T08:55:02.1068598Z File:        tests/Planora.UnitTests/Services/Infrastructure/DependencyInjectionContractTests.cs
2026-11-02T08:55:02.1069279Z Commit:      8925bf59c4bb494ff51fdbf253af90a67994d362
2026-11-02T08:55:02.1070814Z Fingerprint: 8925bf59c4bb494ff51fdbf253af90a67994d362:tests/Planora.UnitTests/Services/Infrastructure/DependencyInjectionContractTests.cs:planora-postgres-connection-string-literal:210
2026-11-02T08:55:02.1074445Z RuleID:      planora-postgres-connection-string-literal
2026-11-02T08:55:02.1075962Z File:        tests/Planora.UnitTests/Services/Infrastructure/DependencyInjectionContractTests.cs
2026-11-02T08:55:02.1077332Z Commit:      8925bf59c4bb494ff51fdbf253af90a67994d362
2026-11-02T08:55:02.1079628Z Fingerprint: 8925bf59c4bb494ff51fdbf253af90a67994d362:tests/Planora.UnitTests/Services/Infrastructure/DependencyInjectionContractTests.cs:planora-postgres-connection-string-literal:241
2026-11-02T08:55:02.1083087Z RuleID:      planora-generic-secret-assignment
2026-11-02T08:55:02.1084080Z File:        tests/Planora.UnitTests/Services/AuthApi/Controllers/AuthenticationControllerTests.cs
2026-11-02T08:55:02.1084789Z Commit:      8925bf59c4bb494ff51fdbf253af90a67994d362
2026-11-02T08:55:02.1086309Z Fingerprint: 8925bf59c4bb494ff51fdbf253af90a67994d362:tests/Planora.UnitTests/Services/AuthApi/Controllers/AuthenticationControllerTests.cs:planora-generic-secret-assignment:37
2026-11-02T08:55:02.1089062Z RuleID:      planora-generic-secret-assignment
2026-11-02T08:55:02.1090023Z File:        tests/Planora.UnitTests/Services/AuthApi/Controllers/AuthenticationControllerTests.cs
2026-11-02T08:55:02.1090737Z Commit:      8925bf59c4bb494ff51fdbf253af90a67994d362
2026-11-02T08:55:02.1092559Z Fingerprint: 8925bf59c4bb494ff51fdbf253af90a67994d362:tests/Planora.UnitTests/Services/AuthApi/Controllers/AuthenticationControllerTests.cs:planora-generic-secret-assignment:146
2026-11-02T08:55:02.1095501Z RuleID:      planora-generic-secret-assignment
2026-11-02T08:55:02.1096471Z File:        tests/Planora.UnitTests/Services/AuthApi/Controllers/AuthenticationControllerTests.cs
2026-11-02T08:55:02.1097165Z Commit:      8925bf59c4bb494ff51fdbf253af90a67994d362
2026-11-02T08:55:02.1098720Z Fingerprint: 8925bf59c4bb494ff51fdbf253af90a67994d362:tests/Planora.UnitTests/Services/AuthApi/Controllers/AuthenticationControllerTests.cs:planora-generic-secret-assignment:181
2026-11-02T08:55:02.1101207Z 8:55AM INF 694 commits scanned.
2026-11-02T08:55:02.1134657Z 8:55AM WRN leaks found: 66
```

## E2E shard 6

Run [GitHub evidence](https://github.com/4Keyy/Planora/actions/runs/41368376503); job 125033430746. Five other shards succeeded. Retry-level errors below are not distinct bug counts.

```text
2026-11-02T01:35:07.3306507Z         at /home/runner/work/Planora/Planora/frontend/e2e/ui/motion-regressions.ui.spec.ts:282:3
2026-11-02T01:35:07.3307259Z     Error: pagination-desktop completed without a setup/action error
2026-11-02T01:35:07.3315038Z         at /home/runner/work/Planora/Planora/frontend/e2e/ui/motion-regressions.ui.spec.ts:261:141
2026-11-02T01:35:07.3315984Z         at run (/home/runner/work/Planora/Planora/frontend/e2e/ui/motion-regressions.ui.spec.ts:258:5)
2026-11-02T01:35:07.3316883Z         at /home/runner/work/Planora/Planora/frontend/e2e/ui/motion-regressions.ui.spec.ts:293:3
2026-11-02T01:35:07.3317606Z     Error: modal-normal completed without a setup/action error
2026-11-02T01:35:07.3324521Z         at /home/runner/work/Planora/Planora/frontend/e2e/ui/motion-regressions.ui.spec.ts:261:141
2026-11-02T01:35:07.3325417Z         at run (/home/runner/work/Planora/Planora/frontend/e2e/ui/motion-regressions.ui.spec.ts:258:5)
2026-11-02T01:35:07.3326262Z         at /home/runner/work/Planora/Planora/frontend/e2e/ui/motion-regressions.ui.spec.ts:298:5
2026-11-02T01:35:07.3327064Z     Error: modal-reduced completed without a setup/action error
2026-11-02T01:35:07.3334102Z         at /home/runner/work/Planora/Planora/frontend/e2e/ui/motion-regressions.ui.spec.ts:261:141
2026-11-02T01:35:07.3335113Z         at run (/home/runner/work/Planora/Planora/frontend/e2e/ui/motion-regressions.ui.spec.ts:258:5)
2026-11-02T01:35:07.3336012Z         at /home/runner/work/Planora/Planora/frontend/e2e/ui/motion-regressions.ui.spec.ts:298:5
2026-11-02T01:35:07.3336766Z     Error: height-reduced completed without a setup/action error
2026-11-02T01:35:07.3343636Z         at /home/runner/work/Planora/Planora/frontend/e2e/ui/motion-regressions.ui.spec.ts:261:141
2026-11-02T01:35:07.3344513Z         at run (/home/runner/work/Planora/Planora/frontend/e2e/ui/motion-regressions.ui.spec.ts:258:5)
2026-11-02T01:35:07.3345403Z         at /home/runner/work/Planora/Planora/frontend/e2e/ui/motion-regressions.ui.spec.ts:303:3
2026-11-02T01:35:07.3346173Z     Error: pagination-reduced completed without a setup/action error
2026-11-02T01:35:07.3352679Z         at /home/runner/work/Planora/Planora/frontend/e2e/ui/motion-regressions.ui.spec.ts:261:141
2026-11-02T01:35:07.3353572Z         at run (/home/runner/work/Planora/Planora/frontend/e2e/ui/motion-regressions.ui.spec.ts:258:5)
2026-11-02T01:35:07.3354453Z         at /home/runner/work/Planora/Planora/frontend/e2e/ui/motion-regressions.ui.spec.ts:316:3
2026-11-02T01:35:07.3355208Z     Error: keyboard-near-bottom completed without a setup/action error
2026-11-02T01:35:07.3362181Z         at /home/runner/work/Planora/Planora/frontend/e2e/ui/motion-regressions.ui.spec.ts:261:141
2026-11-02T01:35:07.3362811Z         at run (/home/runner/work/Planora/Planora/frontend/e2e/ui/motion-regressions.ui.spec.ts:258:5)
2026-11-02T01:35:07.3363436Z         at /home/runner/work/Planora/Planora/frontend/e2e/ui/motion-regressions.ui.spec.ts:320:3
2026-11-02T01:35:07.3524266Z   2) [ui] › e2e/ui/task-height-motion.ui.spec.ts:92:11 › real-service card height and layout motion › /tasks own/shared height follows the column on hide and show: own-tall-three-lines
2026-11-02T01:35:07.3525279Z     Error: following card tracks actual height
2026-11-02T01:35:07.3534723Z         at assertFrames (/home/runner/work/Planora/Planora/frontend/e2e/ui/task-height-motion.ui.spec.ts:81:162)
2026-11-02T01:35:07.3535426Z         at /home/runner/work/Planora/Planora/frontend/e2e/ui/task-height-motion.ui.spec.ts:117:11
2026-11-02T01:35:07.3550615Z     Error: following card tracks actual height
2026-11-02T01:35:07.3559792Z         at assertFrames (/home/runner/work/Planora/Planora/frontend/e2e/ui/task-height-motion.ui.spec.ts:81:162)
2026-11-02T01:35:07.3560692Z         at /home/runner/work/Planora/Planora/frontend/e2e/ui/task-height-motion.ui.spec.ts:117:11
2026-11-02T01:35:07.3576630Z     Error: following card tracks actual height
2026-11-02T01:35:07.3584271Z         at assertFrames (/home/runner/work/Planora/Planora/frontend/e2e/ui/task-height-motion.ui.spec.ts:81:162)
2026-11-02T01:35:07.3585188Z         at /home/runner/work/Planora/Planora/frontend/e2e/ui/task-height-motion.ui.spec.ts:117:11
2026-11-02T01:35:07.3600598Z   3) [ui] › e2e/ui/task-height-motion.ui.spec.ts:92:11 › real-service card height and layout motion › /tasks own/shared height follows the column on hide and show: friend-working
2026-11-02T01:35:07.3601315Z     Error: following card tracks actual height
2026-11-02T01:35:07.3610458Z         at assertFrames (/home/runner/work/Planora/Planora/frontend/e2e/ui/task-height-motion.ui.spec.ts:81:162)
2026-11-02T01:35:07.3611595Z         at /home/runner/work/Planora/Planora/frontend/e2e/ui/task-height-motion.ui.spec.ts:117:11
2026-11-02T01:35:07.3629364Z     Error: following card tracks actual height
2026-11-02T01:35:07.3639114Z         at assertFrames (/home/runner/work/Planora/Planora/frontend/e2e/ui/task-height-motion.ui.spec.ts:81:162)
2026-11-02T01:35:07.3640212Z         at /home/runner/work/Planora/Planora/frontend/e2e/ui/task-height-motion.ui.spec.ts:117:11
2026-11-02T01:35:07.3654384Z     Error: following card tracks actual height
2026-11-02T01:35:07.3662214Z         at assertFrames (/home/runner/work/Planora/Planora/frontend/e2e/ui/task-height-motion.ui.spec.ts:81:162)
2026-11-02T01:35:07.3662899Z         at /home/runner/work/Planora/Planora/frontend/e2e/ui/task-height-motion.ui.spec.ts:117:11
2026-11-02T01:35:07.3680185Z   4) [ui] › e2e/ui/task-height-motion.ui.spec.ts:92:11 › real-service card height and layout motion › /dashboard own/shared height follows the column on hide and show: own-tall-three-lines
2026-11-02T01:35:07.3681041Z     Error: following card tracks actual height
2026-11-02T01:35:07.3688804Z         at assertFrames (/home/runner/work/Planora/Planora/frontend/e2e/ui/task-height-motion.ui.spec.ts:81:162)
2026-11-02T01:35:07.3689695Z         at /home/runner/work/Planora/Planora/frontend/e2e/ui/task-height-motion.ui.spec.ts:117:11
2026-11-02T01:35:07.3704317Z     Error: following card tracks actual height
2026-11-02T01:35:07.3711731Z         at assertFrames (/home/runner/work/Planora/Planora/frontend/e2e/ui/task-height-motion.ui.spec.ts:81:162)
2026-11-02T01:35:07.3712654Z         at /home/runner/work/Planora/Planora/frontend/e2e/ui/task-height-motion.ui.spec.ts:117:11
2026-11-02T01:35:07.3727767Z     Error: following card tracks actual height
2026-11-02T01:35:07.3735785Z         at assertFrames (/home/runner/work/Planora/Planora/frontend/e2e/ui/task-height-motion.ui.spec.ts:81:162)
2026-11-02T01:35:07.3736725Z         at /home/runner/work/Planora/Planora/frontend/e2e/ui/task-height-motion.ui.spec.ts:117:11
2026-11-02T01:35:07.3751210Z   5) [ui] › e2e/ui/task-height-motion.ui.spec.ts:92:11 › real-service card height and layout motion › /dashboard own/shared height follows the column on hide and show: friend-working
2026-11-02T01:35:07.3752139Z     Error: following card tracks actual height
2026-11-02T01:35:07.3760268Z         at assertFrames (/home/runner/work/Planora/Planora/frontend/e2e/ui/task-height-motion.ui.spec.ts:81:162)
2026-11-02T01:35:07.3761702Z         at /home/runner/work/Planora/Planora/frontend/e2e/ui/task-height-motion.ui.spec.ts:117:11
2026-11-02T01:35:07.3776194Z     Error: following card tracks actual height
2026-11-02T01:35:07.3783526Z         at assertFrames (/home/runner/work/Planora/Planora/frontend/e2e/ui/task-height-motion.ui.spec.ts:81:162)
2026-11-02T01:35:07.3784405Z         at /home/runner/work/Planora/Planora/frontend/e2e/ui/task-height-motion.ui.spec.ts:117:11
2026-11-02T01:35:07.3799312Z     Error: following card tracks actual height
2026-11-02T01:35:07.3807042Z         at assertFrames (/home/runner/work/Planora/Planora/frontend/e2e/ui/task-height-motion.ui.spec.ts:81:162)
2026-11-02T01:35:07.3807732Z         at /home/runner/work/Planora/Planora/frontend/e2e/ui/task-height-motion.ui.spec.ts:117:11
2026-11-02T01:35:07.3824428Z   6) [ui] › e2e/ui/task-height-motion.ui.spec.ts:132:7 › real-service card height and layout motion › dashboard bottom card of its tallest column opens without a pager snap
2026-11-02T01:35:07.3825214Z     Test timeout of 180000ms exceeded.
2026-11-02T01:35:07.3825540Z     Error: locator.evaluate: Test ended.
2026-11-02T01:35:07.3830538Z         at collect (/home/runner/work/Planora/Planora/frontend/e2e/ui/task-height-motion.ui.spec.ts:21:17)
2026-11-02T01:35:07.3831423Z         at /home/runner/work/Planora/Planora/frontend/e2e/ui/task-height-motion.ui.spec.ts:183:28
2026-11-02T01:35:07.3842991Z     Test timeout of 180000ms exceeded.
2026-11-02T01:35:07.3843322Z     Error: locator.evaluate: Test ended.
2026-11-02T01:35:07.3848054Z         at collect (/home/runner/work/Planora/Planora/frontend/e2e/ui/task-height-motion.ui.spec.ts:21:17)
2026-11-02T01:35:07.3848738Z         at /home/runner/work/Planora/Planora/frontend/e2e/ui/task-height-motion.ui.spec.ts:183:28
2026-11-02T01:35:07.3860242Z     Test timeout of 180000ms exceeded.
2026-11-02T01:35:07.3860543Z     Error: locator.evaluate: Test ended.
2026-11-02T01:35:07.3865798Z         at collect (/home/runner/work/Planora/Planora/frontend/e2e/ui/task-height-motion.ui.spec.ts:21:17)
2026-11-02T01:35:07.3866492Z         at /home/runner/work/Planora/Planora/frontend/e2e/ui/task-height-motion.ui.spec.ts:183:28
2026-11-02T01:35:07.3876958Z   7) [ui] › e2e/ui/session-restore.ui.spec.ts:4:5 › restores a cold session after the real gateway Retry-After window
2026-11-02T01:35:07.3877517Z     Error: the disposable gateway auth bucket is limited
2026-11-02T01:35:07.3882519Z         at /home/runner/work/Planora/Planora/frontend/e2e/ui/session-restore.ui.spec.ts:15:68
2026-11-02T01:35:07.3887320Z   6 failed
2026-11-02T01:35:07.3887983Z     [ui] › e2e/ui/motion-regressions.ui.spec.ts:252:5 › real services satisfy the motion regression matrix
2026-11-02T01:35:07.3889382Z     [ui] › e2e/ui/task-height-motion.ui.spec.ts:92:11 › real-service card height and layout motion › /tasks own/shared height follows the column on hide and show: own-tall-three-lines
2026-11-02T01:35:07.3890780Z     [ui] › e2e/ui/task-height-motion.ui.spec.ts:92:11 › real-service card height and layout motion › /tasks own/shared height follows the column on hide and show: friend-working
2026-11-02T01:35:07.3891991Z     [ui] › e2e/ui/task-height-motion.ui.spec.ts:92:11 › real-service card height and layout motion › /dashboard own/shared height follows the column on hide and show: own-tall-three-lines
2026-11-02T01:35:07.3893188Z     [ui] › e2e/ui/task-height-motion.ui.spec.ts:92:11 › real-service card height and layout motion › /dashboard own/shared height follows the column on hide and show: friend-working
2026-11-02T01:35:07.3894440Z     [ui] › e2e/ui/task-height-motion.ui.spec.ts:132:7 › real-service card height and layout motion › dashboard bottom card of its tallest column opens without a pager snap
2026-11-02T01:35:07.3895687Z     [ui] › e2e/ui/session-restore.ui.spec.ts:4:5 › restores a cold session after the real gateway Retry-After window
2026-11-02T01:35:07.3896152Z   3 passed (48.2m)
```
