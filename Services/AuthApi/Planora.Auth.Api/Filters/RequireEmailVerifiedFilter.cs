using Microsoft.AspNetCore.Mvc.Filters;

namespace Planora.Auth.Api.Filters
{
    public sealed class RequireEmailVerifiedFilter : IAsyncActionFilter
    {
        public async Task OnActionExecutionAsync(
            ActionExecutingContext context,
            ActionExecutionDelegate next)
        {
            var user = context.HttpContext.User;

            if (user?.Identity?.IsAuthenticated == true)
            {
                var emailVerifiedClaim = user.FindFirst("email_verified");

                if (emailVerifiedClaim == null || emailVerifiedClaim.Value != "true")
                {
                    context.Result = new ObjectResult(new
                    {
                        error = "EMAIL_NOT_VERIFIED",
                        message = "Email verification required"
                    })
                    {
                        StatusCode = StatusCodes.Status403Forbidden
                    };

                    return;
                }
            }

            await next();
        }
    }
}
