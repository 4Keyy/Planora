using System.Security.Claims;

namespace Planora.BuildingBlocks.Infrastructure.Context
{
    public sealed class CurrentUserContext : ICurrentUserContext
    {
        private readonly IHttpContextAccessor _httpContextAccessor;

        public CurrentUserContext(IHttpContextAccessor httpContextAccessor)
        {
            _httpContextAccessor = httpContextAccessor;
        }

        public Guid UserId
        {
            get
            {
                var httpContext = _httpContextAccessor.HttpContext;
                if (httpContext?.User == null)
                    return Guid.Empty;

                // Look for "sub" claim first (from JWT tokens), fallback to NameIdentifier
                var userIdClaim = httpContext.User.FindFirst("sub")?.Value 
                    ?? httpContext.User.FindFirst(ClaimTypes.NameIdentifier)?.Value;

                return Guid.TryParse(userIdClaim, out var userId) ? userId : Guid.Empty;
            }
        }

        public string? Email =>
            _httpContextAccessor.HttpContext?.User
                .FindFirst(ClaimTypes.Email)?.Value;

        public IReadOnlyList<string> Roles =>
            _httpContextAccessor.HttpContext?.User
                .FindAll(ClaimTypes.Role)
                .Select(c => c.Value)
                .ToList() ?? new List<string>();

        public bool IsAuthenticated =>
            _httpContextAccessor.HttpContext?.User.Identity?.IsAuthenticated ?? false;
    }
}
