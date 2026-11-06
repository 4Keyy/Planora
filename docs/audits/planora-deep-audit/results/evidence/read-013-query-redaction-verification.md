# BE-035 — encoded query names в HTTP logs

**PASS_LOCAL.** На исходном middleware синтетическое значение попадало в log
при имени `%74oken` или `access%5Ftoken`, хотя ASP.NET query reader распознавал
его как sensitive параметр. Captured logger RED: 7 failed/2 passed.

`WebUtility.UrlDecode` применяется только к имени для case-insensitive
сравнения. Raw имя и обычные значения не переформатируются; общий Clean
сохранён. GREEN9/9 покрывает HTTP request/response, gRPC request, case,
повторные/пустые значения, ordinary query, plus и malformed escapes.
Независимый reviewer сверил TRX и source diff без блокирующих замечаний.

Полные команды, counters, source hashes и ограничения:
[JSON evidence](read-013-query-redaction-verification.json).
Общий backend: 1546 unit passed, 2 restart-only skips, 94 ErrorHandling passed.
Два restart facts уже выполнены отдельно; streaming/body и mapped-claims
находки имеют собственные gates. Реальная утечка действующего секрета
и содержимое production logs не исследовались и не утверждаются.
