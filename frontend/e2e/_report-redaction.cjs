/** Publish useful diagnostics without Auth fixture credentials or action-link tokens. */
exports.redact = (text) => text
  .replace(/([?&](?:token|resetToken|accessToken)=)[^&\s"'<>]+/gi, '$1[REDACTED]')
  .replace(/("(?:token|verificationToken|resetToken|accessToken|refreshToken|password|newPassword|confirmPassword|csrfToken)"\s*:\s*")(?:\\.|[^"\\])*"/gi, '$1[REDACTED]"')
  .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+/gi, 'Bearer [REDACTED]')
  .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[REDACTED JWT]')
  .replace(/E2e!Passw0rd123/g, '[REDACTED FIXTURE PASSWORD]');
